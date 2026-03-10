/**
 * Custom hooks for Email Wizard mutations and side-effects.
 * Each hook encapsulates one concern to keep the main orchestrator thin.
 */
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { WizardAction, WizardState } from './email-wizard-state.js';
import type { CredentialOption } from './wizard-shared.js';

// ============================================================================
// Gmail OAuth
// ============================================================================

// OAuth popup timeout (5 minutes)
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

export function useGmailOAuth(
	projectId: string,
	googleClientIdCred: CredentialOption | undefined,
	dispatch: React.Dispatch<WizardAction>,
	advanceToStep: (step: number) => void,
) {
	const getOAuthUrlMutation = useMutation({
		mutationFn: async () => {
			if (!googleClientIdCred) throw new Error('Google OAuth Client ID not configured');
			const redirectUri = `${window.location.origin}/oauth/gmail/callback`;
			return trpcClient.integrationsDiscovery.gmailOAuthUrl.mutate({
				clientIdCredentialId: googleClientIdCred.id,
				redirectUri,
				projectId,
			});
		},
	});

	const handleGmailConnect = useCallback(async () => {
		try {
			const result = await getOAuthUrlMutation.mutateAsync();
			const popup = window.open(result.url, 'gmail-oauth', 'width=500,height=600,popup=yes');

			// Check if popup was blocked
			if (!popup || popup.closed) {
				dispatch({
					type: 'SET_VERIFICATION',
					email: null,
					error: 'Popup blocked. Please allow popups and try again.',
				});
				return;
			}

			let timeoutId: ReturnType<typeof setTimeout> | null = null;
			let messageHandler: ((event: MessageEvent) => void) | null = null;

			const cleanup = () => {
				if (messageHandler) {
					window.removeEventListener('message', messageHandler);
					messageHandler = null;
				}
				if (timeoutId) {
					clearTimeout(timeoutId);
					timeoutId = null;
				}
			};

			messageHandler = (event: MessageEvent) => {
				if (event.origin !== window.location.origin) return;
				if (event.data?.type === 'gmail-oauth-complete') {
					dispatch({ type: 'SET_GMAIL_EMAIL', email: event.data.email });
					dispatch({ type: 'SET_OAUTH_COMPLETE', complete: true });
					advanceToStep(3);
					cleanup();
					popup?.close();
				} else if (event.data?.type === 'gmail-oauth-error') {
					dispatch({ type: 'SET_VERIFICATION', email: null, error: event.data.error });
					cleanup();
					popup?.close();
				}
			};

			window.addEventListener('message', messageHandler);

			// Set timeout for abandoned OAuth flows
			timeoutId = setTimeout(() => {
				cleanup();
				if (popup && !popup.closed) {
					popup.close();
				}
				dispatch({
					type: 'SET_VERIFICATION',
					email: null,
					error: 'OAuth timed out. Please try again.',
				});
			}, OAUTH_TIMEOUT_MS);
		} catch {
			// Error handled by mutation
		}
	}, [getOAuthUrlMutation, dispatch, advanceToStep]);

	return { getOAuthUrlMutation, handleGmailConnect };
}

// ============================================================================
// IMAP Verification
// ============================================================================

export function useImapVerification(
	state: WizardState,
	dispatch: React.Dispatch<WizardAction>,
	advanceToStep: (step: number) => void,
) {
	const verifyImapMutation = useMutation({
		mutationFn: async () => {
			if (
				!state.imapHostCredentialId ||
				!state.imapPortCredentialId ||
				!state.usernameCredentialId ||
				!state.passwordCredentialId
			) {
				throw new Error('All IMAP credentials are required');
			}
			return trpcClient.integrationsDiscovery.verifyImap.mutate({
				hostCredentialId: state.imapHostCredentialId,
				portCredentialId: state.imapPortCredentialId,
				usernameCredentialId: state.usernameCredentialId,
				passwordCredentialId: state.passwordCredentialId,
			});
		},
		onSuccess: (result) => {
			dispatch({ type: 'SET_VERIFICATION', email: result.email });
			advanceToStep(4);
		},
		onError: (err) => {
			dispatch({
				type: 'SET_VERIFICATION',
				email: null,
				error: err instanceof Error ? err.message : String(err),
			});
		},
	});

	return { verifyImapMutation };
}

// ============================================================================
// Email Integration Save
// ============================================================================

export function useEmailIntegrationSave(projectId: string, state: WizardState) {
	const queryClient = useQueryClient();

	const saveMutation = useMutation({
		mutationFn: async () => {
			await trpcClient.projects.integrations.upsert.mutate({
				projectId,
				category: 'email',
				provider: state.provider,
				config: {},
			});
			if (state.provider === 'imap') {
				const credPairs = [
					{ role: 'imap_host', credentialId: state.imapHostCredentialId },
					{ role: 'imap_port', credentialId: state.imapPortCredentialId },
					{ role: 'smtp_host', credentialId: state.smtpHostCredentialId },
					{ role: 'smtp_port', credentialId: state.smtpPortCredentialId },
					{ role: 'username', credentialId: state.usernameCredentialId },
					{ role: 'password', credentialId: state.passwordCredentialId },
				].filter((p): p is { role: string; credentialId: number } => p.credentialId !== null);
				for (const { role, credentialId } of credPairs) {
					await trpcClient.projects.integrationCredentials.set.mutate({
						projectId,
						category: 'email',
						role,
						credentialId,
					});
				}
			}
			return { success: true };
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.projects.integrations.list.queryOptions({ projectId }).queryKey,
			});
			queryClient.invalidateQueries({
				queryKey: trpc.projects.integrationCredentials.list.queryOptions({
					projectId,
					category: 'email',
				}).queryKey,
			});
		},
	});

	return { saveMutation };
}
