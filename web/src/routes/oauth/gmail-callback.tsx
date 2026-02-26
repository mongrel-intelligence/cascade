import { trpc, trpcClient } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';
import { createRoute, useSearch } from '@tanstack/react-router';
import { CheckCircle, Loader2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { rootRoute } from '../__root.js';

interface CallbackSearch {
	code?: string;
	state?: string;
	error?: string;
}

function GmailCallbackPage() {
	const search = useSearch({ from: '/oauth/gmail/callback' }) as CallbackSearch;
	const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
	const [message, setMessage] = useState('Processing...');
	const [email, setEmail] = useState<string | null>(null);

	// Get org credentials for OAuth
	const credentialsQuery = useQuery(trpc.credentials.list.queryOptions());
	const credentials = credentialsQuery.data ?? [];
	const googleClientIdCred = credentials.find(
		(c: { envVarKey: string }) => c.envVarKey === 'GOOGLE_OAUTH_CLIENT_ID',
	);
	const googleClientSecretCred = credentials.find(
		(c: { envVarKey: string }) => c.envVarKey === 'GOOGLE_OAUTH_CLIENT_SECRET',
	);

	useEffect(() => {
		if (search.error) {
			setStatus('error');
			setMessage(`Authorization failed: ${search.error}`);
			// Notify parent window
			if (window.opener) {
				window.opener.postMessage(
					{ type: 'gmail-oauth-error', error: search.error },
					window.location.origin,
				);
			}
			return;
		}

		if (!search.code || !search.state) {
			setStatus('error');
			setMessage('Missing authorization code or state');
			return;
		}

		// Wait for credentials to load
		if (credentialsQuery.isLoading) {
			return;
		}

		if (!googleClientIdCred || !googleClientSecretCred) {
			setStatus('error');
			setMessage('Google OAuth credentials not configured');
			return;
		}

		// Exchange code for tokens - state validation is done server-side
		const authCode = search.code; // Already validated above
		const stateParam = search.state; // Pass to server for CSRF validation
		const exchangeCode = async () => {
			try {
				const redirectUri = `${window.location.origin}/oauth/gmail/callback`;
				const result = await trpcClient.integrationsDiscovery.gmailOAuthCallback.mutate({
					clientIdCredentialId: (googleClientIdCred as { id: number }).id,
					clientSecretCredentialId: (googleClientSecretCred as { id: number }).id,
					code: authCode,
					redirectUri,
					state: stateParam,
				});

				setStatus('success');
				setEmail(result.email);
				setMessage(`Connected as ${result.email}`);

				// Notify parent window
				if (window.opener) {
					window.opener.postMessage(
						{ type: 'gmail-oauth-complete', email: result.email },
						window.location.origin,
					);
				}
			} catch (err) {
				setStatus('error');
				const errorMessage = err instanceof Error ? err.message : String(err);
				setMessage(`Failed to complete authorization: ${errorMessage}`);

				// Notify parent window
				if (window.opener) {
					window.opener.postMessage(
						{ type: 'gmail-oauth-error', error: errorMessage },
						window.location.origin,
					);
				}
			}
		};

		exchangeCode();
	}, [
		search.code,
		search.state,
		search.error,
		credentialsQuery.isLoading,
		googleClientIdCred,
		googleClientSecretCred,
	]);

	return (
		<div className="flex min-h-screen items-center justify-center bg-background">
			<div className="w-full max-w-sm space-y-6 rounded-lg border border-border p-8 text-center">
				{status === 'loading' && (
					<>
						<Loader2 className="h-12 w-12 mx-auto animate-spin text-primary" />
						<div className="space-y-2">
							<h1 className="text-xl font-semibold">Connecting Gmail</h1>
							<p className="text-sm text-muted-foreground">{message}</p>
						</div>
					</>
				)}

				{status === 'success' && (
					<>
						<CheckCircle className="h-12 w-12 mx-auto text-green-600" />
						<div className="space-y-2">
							<h1 className="text-xl font-semibold text-green-600">Connected!</h1>
							<p className="text-sm text-muted-foreground">{message}</p>
						</div>
						<p className="text-xs text-muted-foreground">You can close this window now.</p>
					</>
				)}

				{status === 'error' && (
					<>
						<XCircle className="h-12 w-12 mx-auto text-destructive" />
						<div className="space-y-2">
							<h1 className="text-xl font-semibold text-destructive">Error</h1>
							<p className="text-sm text-muted-foreground">{message}</p>
						</div>
						<button
							type="button"
							onClick={() => window.close()}
							className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
						>
							Close Window
						</button>
					</>
				)}
			</div>
		</div>
	);
}

export const gmailCallbackRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/oauth/gmail/callback',
	component: GmailCallbackPage,
	validateSearch: (search: Record<string, unknown>): CallbackSearch => ({
		code: search.code as string | undefined,
		state: search.state as string | undefined,
		error: search.error as string | undefined,
	}),
});
