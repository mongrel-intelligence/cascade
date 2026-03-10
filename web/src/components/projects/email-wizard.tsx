/**
 * Email Wizard orchestrator — composes state, hooks, and step components
 * into the four-step wizard flow (Provider → Connect → Verify → Save).
 *
 * Individual concerns live in dedicated files:
 *   - email-wizard-state.ts     — WizardState, WizardAction, reducer
 *   - email-wizard-hooks.ts     — useGmailOAuth, useImapVerification, useEmailIntegrationSave
 *   - email-wizard-gmail-steps.tsx  — GmailConnectContent, GmailVerifyContent
 *   - email-wizard-imap-steps.tsx   — ImapConnectContent, ImapVerifyContent, CredentialSelect
 *   - email-wizard-common-steps.tsx — ProviderStep, SaveStep, STEP_TITLES
 */
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ProviderStep, STEP_TITLES, SaveStep } from './email-wizard-common-steps.js';
import { GmailConnectContent, GmailVerifyContent } from './email-wizard-gmail-steps.js';
import {
	useEmailIntegrationSave,
	useGmailOAuth,
	useImapVerification,
} from './email-wizard-hooks.js';
import { ImapConnectContent, ImapVerifyContent } from './email-wizard-imap-steps.js';
import { createInitialState, wizardReducer } from './email-wizard-state.js';
import type { Provider, WizardState } from './email-wizard-state.js';
import { WizardStep } from './wizard-shared.js';
import type { CredentialOption } from './wizard-shared.js';

// ============================================================================
// EmailWizard
// ============================================================================

export function EmailWizard({
	projectId,
	initialProvider,
	initialCredentials,
}: {
	projectId: string;
	initialProvider?: string;
	initialCredentials?: Map<string, number>;
}) {
	const credentialsQuery = useQuery(trpc.credentials.list.queryOptions());
	const orgCredentials = (credentialsQuery.data ?? []) as CredentialOption[];

	const [state, dispatch] = useReducer(wizardReducer, undefined, createInitialState);
	const [openSteps, setOpenSteps] = useState<Set<number>>(new Set([1]));
	const initDoneRef = useRef(false);

	const googleClientIdCred = orgCredentials.find((c) => c.envVarKey === 'GOOGLE_OAUTH_CLIENT_ID');
	const googleClientSecretCred = orgCredentials.find(
		(c) => c.envVarKey === 'GOOGLE_OAUTH_CLIENT_SECRET',
	);
	const hasGoogleOAuthCreds = !!(googleClientIdCred && googleClientSecretCred);

	// Initialize from existing integration.
	// For Gmail: wait until orgCredentials has loaded so we can resolve the email
	// address from the credential name and pre-confirm the verify step.
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: multi-provider initialization requires coordinating several async conditions and credential lookups in a single effect
	useEffect(() => {
		if (initDoneRef.current || !initialProvider || !initialCredentials) return;
		if (initialProvider === 'gmail' && orgCredentials.length === 0) return;

		initDoneRef.current = true;
		const editState: Partial<WizardState> = { provider: initialProvider as Provider };

		if (initialProvider === 'gmail') {
			editState.oauthComplete = true;
			const gmailEmailCredId = initialCredentials.get('gmail_email');
			if (gmailEmailCredId) {
				const emailCred = orgCredentials.find((c) => c.id === gmailEmailCredId);
				if (emailCred) {
					// Credential name is stored as "Gmail: user@example.com"
					const email = emailCred.name.replace(/^Gmail:\s*/, '');
					editState.gmailEmail = email;
					editState.verificationEmail = email;
				}
			}
		} else if (initialProvider === 'imap') {
			editState.imapHostCredentialId = initialCredentials.get('imap_host') ?? null;
			editState.imapPortCredentialId = initialCredentials.get('imap_port') ?? null;
			editState.smtpHostCredentialId = initialCredentials.get('smtp_host') ?? null;
			editState.smtpPortCredentialId = initialCredentials.get('smtp_port') ?? null;
			editState.usernameCredentialId = initialCredentials.get('username') ?? null;
			editState.passwordCredentialId = initialCredentials.get('password') ?? null;
		}

		dispatch({ type: 'INIT_EDIT', state: editState });
		setOpenSteps(new Set([1, 2, 3, 4]));
	}, [initialProvider, initialCredentials, orgCredentials]);

	const toggleStep = (step: number) => {
		setOpenSteps((prev) => {
			const next = new Set(prev);
			if (next.has(step)) next.delete(step);
			else next.add(step);
			return next;
		});
	};

	const advanceToStep = useCallback((step: number) => {
		setOpenSteps((prev) => new Set([...prev, step]));
	}, []);

	// Step status
	const step1Complete = !!state.provider;
	const imapCredsReady =
		state.provider === 'imap' &&
		!!state.imapHostCredentialId &&
		!!state.imapPortCredentialId &&
		!!state.smtpHostCredentialId &&
		!!state.smtpPortCredentialId &&
		!!state.usernameCredentialId &&
		!!state.passwordCredentialId;
	const step2Complete = (state.provider === 'gmail' && state.oauthComplete) || imapCredsReady;
	const step3Complete = !!state.verificationEmail;

	const getStatus = (stepNum: number, complete: boolean): 'pending' | 'complete' | 'active' => {
		if (complete) return 'complete';
		if (openSteps.has(stepNum)) return 'active';
		return 'pending';
	};

	// Hooks
	const { getOAuthUrlMutation, handleGmailConnect } = useGmailOAuth(
		projectId,
		googleClientIdCred,
		dispatch,
		advanceToStep,
	);
	const { verifyImapMutation } = useImapVerification(state, dispatch, advanceToStep);
	const { saveMutation } = useEmailIntegrationSave(projectId, state);

	return (
		<div className="space-y-3">
			{/* Step 1: Provider */}
			<WizardStep
				stepNumber={1}
				title={STEP_TITLES[0]}
				status={getStatus(1, step1Complete)}
				isOpen={openSteps.has(1)}
				onToggle={() => toggleStep(1)}
			>
				<ProviderStep state={state} dispatch={dispatch} advanceToStep={advanceToStep} />
			</WizardStep>

			{/* Step 2: Connect */}
			<WizardStep
				stepNumber={2}
				title={STEP_TITLES[1]}
				status={getStatus(2, step2Complete)}
				isOpen={openSteps.has(2)}
				onToggle={() => toggleStep(2)}
			>
				{state.provider === 'gmail' ? (
					<GmailConnectContent
						hasGoogleOAuthCreds={hasGoogleOAuthCreds}
						oauthComplete={state.oauthComplete}
						gmailEmail={state.gmailEmail}
						onConnect={handleGmailConnect}
						isConnecting={getOAuthUrlMutation.isPending}
						error={getOAuthUrlMutation.isError ? getOAuthUrlMutation.error.message : null}
					/>
				) : (
					<ImapConnectContent state={state} dispatch={dispatch} credentials={orgCredentials} />
				)}
			</WizardStep>

			{/* Step 3: Verify */}
			<WizardStep
				stepNumber={3}
				title={STEP_TITLES[2]}
				status={getStatus(3, step3Complete)}
				isOpen={openSteps.has(3)}
				onToggle={() => toggleStep(3)}
			>
				{state.provider === 'gmail' ? (
					<GmailVerifyContent
						oauthComplete={state.oauthComplete}
						gmailEmail={state.gmailEmail}
						verificationEmail={state.verificationEmail}
						onConfirm={() => {
							dispatch({ type: 'SET_VERIFICATION', email: state.gmailEmail });
							advanceToStep(4);
						}}
					/>
				) : (
					<ImapVerifyContent
						verificationEmail={state.verificationEmail}
						verifyError={state.verifyError}
						imapCredsReady={imapCredsReady}
						isVerifying={verifyImapMutation.isPending}
						onVerify={() => verifyImapMutation.mutate()}
					/>
				)}
			</WizardStep>

			{/* Step 4: Save */}
			<WizardStep
				stepNumber={4}
				title={STEP_TITLES[3]}
				status={getStatus(4, saveMutation.isSuccess)}
				isOpen={openSteps.has(4)}
				onToggle={() => toggleStep(4)}
			>
				<SaveStep state={state} saveMutation={saveMutation} step3Complete={step3Complete} />
			</WizardStep>
		</div>
	);
}
