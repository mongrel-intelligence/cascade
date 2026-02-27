import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
	AlertCircle,
	Check,
	CheckCircle,
	ChevronDown,
	ChevronRight,
	Loader2,
	Mail,
	Plus,
	XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

// ============================================================================
// Types
// ============================================================================

interface CredentialOption {
	id: number;
	name: string;
	envVarKey: string;
	value: string;
}

type Provider = 'gmail' | 'imap';

interface WizardState {
	provider: Provider;
	gmailEmail: string | null;
	oauthComplete: boolean;
	imapHostCredentialId: number | null;
	imapPortCredentialId: number | null;
	smtpHostCredentialId: number | null;
	smtpPortCredentialId: number | null;
	usernameCredentialId: number | null;
	passwordCredentialId: number | null;
	verificationEmail: string | null;
	verifyError: string | null;
	isEditing: boolean;
}

type WizardAction =
	| { type: 'SET_PROVIDER'; provider: Provider }
	| { type: 'SET_GMAIL_EMAIL'; email: string | null }
	| { type: 'SET_OAUTH_COMPLETE'; complete: boolean }
	| { type: 'SET_IMAP_HOST_CRED'; id: number | null }
	| { type: 'SET_IMAP_PORT_CRED'; id: number | null }
	| { type: 'SET_SMTP_HOST_CRED'; id: number | null }
	| { type: 'SET_SMTP_PORT_CRED'; id: number | null }
	| { type: 'SET_USERNAME_CRED'; id: number | null }
	| { type: 'SET_PASSWORD_CRED'; id: number | null }
	| { type: 'SET_VERIFICATION'; email: string | null; error?: string | null }
	| { type: 'INIT_EDIT'; state: Partial<WizardState> };

function createInitialState(): WizardState {
	return {
		provider: 'gmail',
		gmailEmail: null,
		oauthComplete: false,
		imapHostCredentialId: null,
		imapPortCredentialId: null,
		smtpHostCredentialId: null,
		smtpPortCredentialId: null,
		usernameCredentialId: null,
		passwordCredentialId: null,
		verificationEmail: null,
		verifyError: null,
		isEditing: false,
	};
}

function wizardReducer(state: WizardState, action: WizardAction): WizardState {
	switch (action.type) {
		case 'SET_PROVIDER':
			return { ...createInitialState(), provider: action.provider };
		case 'SET_GMAIL_EMAIL':
			return { ...state, gmailEmail: action.email };
		case 'SET_OAUTH_COMPLETE':
			return { ...state, oauthComplete: action.complete };
		case 'SET_IMAP_HOST_CRED':
			return { ...state, imapHostCredentialId: action.id };
		case 'SET_IMAP_PORT_CRED':
			return { ...state, imapPortCredentialId: action.id };
		case 'SET_SMTP_HOST_CRED':
			return { ...state, smtpHostCredentialId: action.id };
		case 'SET_SMTP_PORT_CRED':
			return { ...state, smtpPortCredentialId: action.id };
		case 'SET_USERNAME_CRED':
			return { ...state, usernameCredentialId: action.id };
		case 'SET_PASSWORD_CRED':
			return { ...state, passwordCredentialId: action.id };
		case 'SET_VERIFICATION':
			return { ...state, verificationEmail: action.email, verifyError: action.error ?? null };
		case 'INIT_EDIT':
			return { ...state, ...action.state, isEditing: true };
		default:
			return state;
	}
}

// ============================================================================
// Wizard Step Shell
// ============================================================================

const STEP_TITLES = ['Provider', 'Connect', 'Verify', 'Save'] as const;

function WizardStep({
	stepNumber,
	title,
	status,
	isOpen,
	onToggle,
	children,
}: {
	stepNumber: number;
	title: string;
	status: 'pending' | 'complete' | 'active';
	isOpen: boolean;
	onToggle: () => void;
	children: React.ReactNode;
}) {
	const statusClasses =
		status === 'complete'
			? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
			: status === 'active'
				? 'bg-primary text-primary-foreground'
				: 'bg-muted text-muted-foreground';

	return (
		<div className="border rounded-lg overflow-hidden">
			<button
				type="button"
				onClick={onToggle}
				className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/50 transition-colors"
			>
				<div
					className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ${statusClasses}`}
				>
					{status === 'complete' ? <Check className="h-4 w-4" /> : stepNumber}
				</div>
				<span className="flex-1 text-sm font-medium">{title}</span>
				{isOpen ? (
					<ChevronDown className="h-4 w-4 text-muted-foreground" />
				) : (
					<ChevronRight className="h-4 w-4 text-muted-foreground" />
				)}
			</button>
			{isOpen && <div className="border-t px-4 py-4 space-y-4">{children}</div>}
		</div>
	);
}

// ============================================================================
// Inline Credential Creator
// ============================================================================

function InlineCredentialCreator({
	onCreated,
	suggestedKey,
}: {
	onCreated: (id: number) => void;
	suggestedKey?: string;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const [name, setName] = useState('');
	const [envVarKey, setEnvVarKey] = useState(suggestedKey ?? '');
	const [value, setValue] = useState('');
	const queryClient = useQueryClient();

	const createMutation = useMutation({
		mutationFn: () =>
			trpcClient.credentials.create.mutate({ name, envVarKey, value, isDefault: false }),
		onSuccess: async (result) => {
			await queryClient.invalidateQueries({
				queryKey: trpc.credentials.list.queryOptions().queryKey,
			});
			onCreated((result as { id: number }).id);
			setIsOpen(false);
			setName('');
			setEnvVarKey(suggestedKey ?? '');
			setValue('');
		},
	});

	if (!isOpen) {
		return (
			<button
				type="button"
				onClick={() => setIsOpen(true)}
				className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
			>
				<Plus className="h-3 w-3" /> Create new
			</button>
		);
	}

	return (
		<div className="rounded-md border border-dashed p-3 space-y-2">
			<div className="flex gap-2">
				<Input
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="Name"
					className="flex-1"
				/>
				<Input
					value={envVarKey}
					onChange={(e) => setEnvVarKey(e.target.value.toUpperCase())}
					placeholder="ENV_VAR_KEY"
					className="flex-1"
				/>
			</div>
			<Input
				value={value}
				onChange={(e) => setValue(e.target.value)}
				placeholder="Secret value"
				type="password"
			/>
			<div className="flex gap-2">
				<button
					type="button"
					onClick={() => createMutation.mutate()}
					disabled={!name || !envVarKey || !value || createMutation.isPending}
					className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
				>
					{createMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Create'}
				</button>
				<button
					type="button"
					onClick={() => setIsOpen(false)}
					className="inline-flex h-8 items-center rounded-md border px-3 text-xs hover:bg-accent"
				>
					Cancel
				</button>
			</div>
		</div>
	);
}

// ============================================================================
// Credential Select Component
// ============================================================================

function CredentialSelect({
	label,
	value,
	onChange,
	credentials,
	suggestedKey,
}: {
	label: string;
	value: number | null;
	onChange: (id: number | null) => void;
	credentials: CredentialOption[];
	suggestedKey: string;
}) {
	return (
		<div className="space-y-2">
			<Label>{label}</Label>
			<select
				value={value ?? ''}
				onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
				className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
			>
				<option value="">Select credential...</option>
				{credentials.map((c) => (
					<option key={c.id} value={c.id}>
						{c.name}
					</option>
				))}
			</select>
			<InlineCredentialCreator onCreated={onChange} suggestedKey={suggestedKey} />
		</div>
	);
}

// ============================================================================
// Step Content Components
// ============================================================================

function GmailConnectContent({
	hasGoogleOAuthCreds,
	oauthComplete,
	gmailEmail,
	onConnect,
	isConnecting,
	error,
}: {
	hasGoogleOAuthCreds: boolean;
	oauthComplete: boolean;
	gmailEmail: string | null;
	onConnect: () => void;
	isConnecting: boolean;
	error?: string | null;
}) {
	if (!hasGoogleOAuthCreds) {
		return (
			<div className="rounded-md border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-900/20">
				<div className="flex items-start gap-2">
					<AlertCircle className="h-4 w-4 text-amber-600 mt-0.5" />
					<div className="space-y-1">
						<p className="text-sm font-medium text-amber-700 dark:text-amber-400">
							Google OAuth not configured
						</p>
						<p className="text-xs text-amber-600 dark:text-amber-500">
							Add{' '}
							<code className="bg-amber-100 px-1 rounded dark:bg-amber-900">
								GOOGLE_OAUTH_CLIENT_ID
							</code>{' '}
							and{' '}
							<code className="bg-amber-100 px-1 rounded dark:bg-amber-900">
								GOOGLE_OAUTH_CLIENT_SECRET
							</code>{' '}
							credentials in Settings to enable Gmail OAuth.
						</p>
					</div>
				</div>
			</div>
		);
	}

	if (oauthComplete) {
		return (
			<div className="flex items-center gap-2 text-sm text-green-600">
				<CheckCircle className="h-4 w-4" />
				Connected as <span className="font-medium">{gmailEmail}</span>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<p className="text-sm text-muted-foreground">
				Click below to authorize CASCADE to access your Gmail account.
			</p>
			<button
				type="button"
				onClick={onConnect}
				disabled={isConnecting}
				className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
			>
				{isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
				Connect Gmail
			</button>
			{error && <p className="text-sm text-destructive">{error}</p>}
		</div>
	);
}

function ImapConnectContent({
	state,
	dispatch,
	credentials,
}: {
	state: WizardState;
	dispatch: React.Dispatch<WizardAction>;
	credentials: CredentialOption[];
}) {
	return (
		<div className="space-y-4">
			<p className="text-sm text-muted-foreground">
				Configure IMAP and SMTP credentials for email access.
			</p>
			<div className="grid grid-cols-2 gap-4">
				<CredentialSelect
					label="IMAP Host"
					value={state.imapHostCredentialId}
					onChange={(id) => dispatch({ type: 'SET_IMAP_HOST_CRED', id })}
					credentials={credentials}
					suggestedKey="EMAIL_IMAP_HOST"
				/>
				<CredentialSelect
					label="IMAP Port"
					value={state.imapPortCredentialId}
					onChange={(id) => dispatch({ type: 'SET_IMAP_PORT_CRED', id })}
					credentials={credentials}
					suggestedKey="EMAIL_IMAP_PORT"
				/>
				<CredentialSelect
					label="SMTP Host"
					value={state.smtpHostCredentialId}
					onChange={(id) => dispatch({ type: 'SET_SMTP_HOST_CRED', id })}
					credentials={credentials}
					suggestedKey="EMAIL_SMTP_HOST"
				/>
				<CredentialSelect
					label="SMTP Port"
					value={state.smtpPortCredentialId}
					onChange={(id) => dispatch({ type: 'SET_SMTP_PORT_CRED', id })}
					credentials={credentials}
					suggestedKey="EMAIL_SMTP_PORT"
				/>
				<CredentialSelect
					label="Username/Email"
					value={state.usernameCredentialId}
					onChange={(id) => dispatch({ type: 'SET_USERNAME_CRED', id })}
					credentials={credentials}
					suggestedKey="EMAIL_USERNAME"
				/>
				<CredentialSelect
					label="Password/App Password"
					value={state.passwordCredentialId}
					onChange={(id) => dispatch({ type: 'SET_PASSWORD_CRED', id })}
					credentials={credentials}
					suggestedKey="EMAIL_PASSWORD"
				/>
			</div>
		</div>
	);
}

function GmailVerifyContent({
	oauthComplete,
	gmailEmail,
	verificationEmail,
	onConfirm,
}: {
	oauthComplete: boolean;
	gmailEmail: string | null;
	verificationEmail: string | null;
	onConfirm: () => void;
}) {
	if (!oauthComplete) {
		return (
			<p className="text-sm text-muted-foreground">
				Complete Gmail OAuth in the previous step first.
			</p>
		);
	}

	return (
		<>
			<div className="flex items-center gap-2 text-sm text-green-600">
				<CheckCircle className="h-4 w-4" />
				Gmail connection verified for <span className="font-medium">{gmailEmail}</span>
			</div>
			{!verificationEmail && (
				<button
					type="button"
					onClick={onConfirm}
					className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
				>
					<CheckCircle className="h-4 w-4" />
					Confirm
				</button>
			)}
		</>
	);
}

function ImapVerifyContent({
	verificationEmail,
	verifyError,
	imapCredsReady,
	isVerifying,
	onVerify,
}: {
	verificationEmail: string | null;
	verifyError: string | null;
	imapCredsReady: boolean;
	isVerifying: boolean;
	onVerify: () => void;
}) {
	return (
		<div className="space-y-4">
			{verificationEmail ? (
				<div className="flex items-center gap-2 text-sm text-green-600">
					<CheckCircle className="h-4 w-4" />
					IMAP connection verified for <span className="font-medium">{verificationEmail}</span>
				</div>
			) : (
				<>
					<p className="text-sm text-muted-foreground">
						Test the IMAP connection to verify credentials work.
					</p>
					<button
						type="button"
						onClick={onVerify}
						disabled={!imapCredsReady || isVerifying}
						className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
					>
						{isVerifying ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Mail className="h-4 w-4" />
						)}
						Verify Connection
					</button>
				</>
			)}
			{verifyError && (
				<div className="flex items-center gap-2 text-sm text-destructive">
					<XCircle className="h-4 w-4" />
					{verifyError}
				</div>
			)}
		</div>
	);
}

// ============================================================================
// Main EmailWizard Component
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
	const queryClient = useQueryClient();
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

	// Gmail OAuth
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

	// OAuth popup timeout (5 minutes)
	const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

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
	}, [getOAuthUrlMutation, advanceToStep]);

	// IMAP Verification
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

	// Save
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

// ============================================================================
// Extracted Step Components
// ============================================================================

function ProviderStep({
	state,
	dispatch,
	advanceToStep,
}: {
	state: WizardState;
	dispatch: React.Dispatch<WizardAction>;
	advanceToStep: (step: number) => void;
}) {
	const baseButtonClass =
		'flex-1 rounded-md border px-4 py-3 text-sm font-medium transition-colors';
	const activeClass = 'border-primary bg-primary/5 text-foreground';
	const inactiveClass =
		'border-input text-muted-foreground hover:text-foreground hover:bg-accent/50';
	const disabledClass = state.isEditing ? 'cursor-not-allowed opacity-60' : '';

	return (
		<div className="space-y-2">
			<Label>Email Provider</Label>
			<div className="flex gap-2">
				<button
					type="button"
					disabled={state.isEditing}
					onClick={() => {
						dispatch({ type: 'SET_PROVIDER', provider: 'gmail' });
						advanceToStep(2);
					}}
					className={`${baseButtonClass} ${state.provider === 'gmail' ? activeClass : inactiveClass} ${disabledClass}`}
				>
					<Mail className="h-4 w-4 inline-block mr-2" />
					Gmail (OAuth)
				</button>
				<button
					type="button"
					disabled={state.isEditing}
					onClick={() => {
						dispatch({ type: 'SET_PROVIDER', provider: 'imap' });
						advanceToStep(2);
					}}
					className={`${baseButtonClass} ${state.provider === 'imap' ? activeClass : inactiveClass} ${disabledClass}`}
				>
					IMAP / SMTP
				</button>
			</div>
			<p className="text-xs text-muted-foreground">
				{state.provider === 'gmail'
					? 'Connect with Google OAuth. No app password required.'
					: 'Use IMAP/SMTP credentials (works with any email provider).'}
			</p>
		</div>
	);
}

function SaveStep({
	state,
	saveMutation,
	step3Complete,
}: {
	state: WizardState;
	saveMutation: ReturnType<typeof useMutation<{ success: boolean }, Error, void>>;
	step3Complete: boolean;
}) {
	return (
		<div className="space-y-4">
			<div className="rounded-md bg-muted/50 p-4 space-y-2 text-sm">
				<div className="flex justify-between">
					<span className="text-muted-foreground">Provider</span>
					<span className="font-medium">
						{state.provider === 'gmail' ? 'Gmail (OAuth)' : 'IMAP/SMTP'}
					</span>
				</div>
				{state.verificationEmail && (
					<div className="flex justify-between">
						<span className="text-muted-foreground">Email</span>
						<span className="font-medium">{state.verificationEmail}</span>
					</div>
				)}
			</div>
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={() => saveMutation.mutate()}
					disabled={!step3Complete || saveMutation.isPending}
					className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
				>
					{saveMutation.isPending
						? 'Saving...'
						: state.isEditing
							? 'Update Integration'
							: 'Save Integration'}
				</button>
				{saveMutation.isSuccess && (
					<span className="text-sm text-green-600">Integration saved successfully.</span>
				)}
				{saveMutation.isError && (
					<span className="text-sm text-destructive">{saveMutation.error.message}</span>
				)}
			</div>
		</div>
	);
}

// ============================================================================
// Email Joke Agent Configuration
// ============================================================================

export function EmailJokeConfig({ projectId }: { projectId: string }) {
	const [senderEmail, setSenderEmail] = useState('');
	const [savedEmail, setSavedEmail] = useState<string | null>(null);
	const [initialized, setInitialized] = useState(false);
	const [emailError, setEmailError] = useState<string | null>(null);
	const queryClient = useQueryClient();

	// Fetch current triggers config
	const integrationsQuery = useQuery(trpc.projects.integrations.list.queryOptions({ projectId }));

	// Initialize from existing config (only once)
	useEffect(() => {
		if (initialized || !integrationsQuery.data) return;
		const emailIntegration = (
			integrationsQuery.data as unknown as Array<{ category: string; triggers: unknown }>
		).find((i) => i.category === 'email');
		if (emailIntegration?.triggers) {
			const t = emailIntegration.triggers as { senderEmail?: string | null };
			if (t.senderEmail) {
				setSenderEmail(t.senderEmail);
				setSavedEmail(t.senderEmail);
			}
		}
		setInitialized(true);
	}, [integrationsQuery.data, initialized]);

	// Show error state if query failed
	if (integrationsQuery.isError) {
		return (
			<div className="rounded-lg border border-destructive/50 p-4">
				<p className="text-sm text-destructive">
					Failed to load integration config: {integrationsQuery.error.message}
				</p>
			</div>
		);
	}

	const updateMutation = useMutation({
		mutationFn: async (email: string | null) => {
			await trpcClient.projects.integrations.updateTriggers.mutate({
				projectId,
				category: 'email',
				triggers: { senderEmail: email },
			});
		},
		onSuccess: () => {
			setSavedEmail(senderEmail || null);
			queryClient.invalidateQueries({
				queryKey: trpc.projects.integrations.list.queryOptions({ projectId }).queryKey,
			});
		},
	});

	const hasChanges = senderEmail !== (savedEmail ?? '');

	// Validate email format on blur
	const validateEmail = (email: string) => {
		if (!email) {
			setEmailError(null);
			return true;
		}
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(email)) {
			setEmailError('Please enter a valid email address');
			return false;
		}
		setEmailError(null);
		return true;
	};

	const handleSave = () => {
		if (senderEmail && !validateEmail(senderEmail)) {
			return;
		}
		updateMutation.mutate(senderEmail || null);
	};

	return (
		<div className="rounded-lg border p-4 space-y-4">
			<div>
				<h3 className="text-sm font-medium">Email Joke Agent</h3>
				<p className="text-xs text-muted-foreground mt-1">
					Configure which emails the joke agent will respond to.
				</p>
			</div>
			<div className="space-y-2">
				<Label htmlFor="sender-email-filter">Sender Email Filter</Label>
				<div className="flex gap-2">
					<Input
						id="sender-email-filter"
						type="email"
						placeholder="friend@example.com"
						value={senderEmail}
						onChange={(e) => {
							setSenderEmail(e.target.value);
							if (emailError) setEmailError(null);
						}}
						onBlur={(e) => validateEmail(e.target.value)}
						className={`flex-1 ${emailError ? 'border-destructive' : ''}`}
					/>
					<button
						type="button"
						onClick={handleSave}
						disabled={!hasChanges || updateMutation.isPending || !!emailError}
						className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
					>
						{updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
					</button>
					{savedEmail && (
						<button
							type="button"
							onClick={() => {
								setSenderEmail('');
								setEmailError(null);
								updateMutation.mutate(null);
							}}
							disabled={updateMutation.isPending}
							className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-accent"
						>
							Clear
						</button>
					)}
				</div>
				{emailError && <p className="text-xs text-destructive">{emailError}</p>}
				<p className="text-xs text-muted-foreground">
					{savedEmail
						? `Currently filtering emails from: ${savedEmail}`
						: 'No filter set. The agent will process all unread emails.'}
				</p>
			</div>
			{updateMutation.isSuccess && <p className="text-sm text-green-600">Configuration saved.</p>}
			{updateMutation.isError && (
				<p className="text-sm text-destructive">{updateMutation.error.message}</p>
			)}
		</div>
	);
}
