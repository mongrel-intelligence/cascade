import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
	Check,
	CheckCircle,
	ChevronDown,
	ChevronRight,
	Copy,
	Loader2,
	MessageSquare,
	Plus,
	XCircle,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

// ============================================================================
// Types
// ============================================================================

interface CredentialOption {
	id: number;
	name: string;
	envVarKey: string;
	value: string;
}

interface WizardState {
	accountSidCredentialId: number | null;
	authTokenCredentialId: number | null;
	phoneNumberCredentialId: number | null;
	verifiedName: string | null;
	verifyError: string | null;
}

// ============================================================================
// Wizard Step Shell
// ============================================================================

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
// Credential Select
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
// Webhook URL Panel
// ============================================================================

function WebhookUrlPanel({ projectId }: { projectId: string }) {
	const url = `${window.location.origin}/twilio/webhook/${projectId}`;
	const [copied, setCopied] = useState(false);

	const handleCopy = () => {
		void navigator.clipboard.writeText(url);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className="rounded-md border p-3 space-y-2 text-sm">
			<p className="font-medium">Webhook URL</p>
			<p className="text-xs text-muted-foreground">
				Configure this URL in your Twilio console under{' '}
				<strong>
					Phone Numbers → Manage → Active Numbers → [your number] → Messaging → A Message Comes In
				</strong>
				.
			</p>
			<div className="flex items-center gap-2">
				<code className="flex-1 rounded bg-muted px-2 py-1 text-xs break-all">{url}</code>
				<button
					type="button"
					onClick={handleCopy}
					className="shrink-0 inline-flex h-7 items-center gap-1 rounded px-2 text-xs border hover:bg-accent"
				>
					{copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
					{copied ? 'Copied' : 'Copy'}
				</button>
			</div>
		</div>
	);
}

// ============================================================================
// Main TwilioWizard Component
// ============================================================================

export function TwilioWizard({
	projectId,
	initialCredentials,
}: {
	projectId: string;
	initialCredentials?: Map<string, number>;
}) {
	const queryClient = useQueryClient();
	const credentialsQuery = useQuery(trpc.credentials.list.queryOptions());
	const orgCredentials = (credentialsQuery.data ?? []) as CredentialOption[];

	const [state, setState] = useState<WizardState>({
		accountSidCredentialId: null,
		authTokenCredentialId: null,
		phoneNumberCredentialId: null,
		verifiedName: null,
		verifyError: null,
	});
	const [openSteps, setOpenSteps] = useState<Set<number>>(new Set([1]));
	const initDoneRef = useRef(false);

	// Initialize from existing integration
	useEffect(() => {
		if (initDoneRef.current || !initialCredentials || initialCredentials.size === 0) return;
		initDoneRef.current = true;
		setState((prev) => ({
			...prev,
			accountSidCredentialId: initialCredentials.get('account_sid') ?? null,
			authTokenCredentialId: initialCredentials.get('auth_token') ?? null,
			phoneNumberCredentialId: initialCredentials.get('phone_number') ?? null,
			verifiedName: '(existing integration)',
		}));
		setOpenSteps(new Set([1, 2, 3]));
	}, [initialCredentials]);

	const toggleStep = (step: number) => {
		setOpenSteps((prev) => {
			const next = new Set(prev);
			if (next.has(step)) next.delete(step);
			else next.add(step);
			return next;
		});
	};

	const step1Complete =
		!!state.accountSidCredentialId &&
		!!state.authTokenCredentialId &&
		!!state.phoneNumberCredentialId;
	const step2Complete = !!state.verifiedName;

	const getStatus = (stepNum: number, complete: boolean): 'pending' | 'complete' | 'active' => {
		if (complete) return 'complete';
		if (openSteps.has(stepNum)) return 'active';
		return 'pending';
	};

	// Verify Twilio credentials
	const verifyMutation = useMutation({
		mutationFn: async () => {
			if (!state.accountSidCredentialId || !state.authTokenCredentialId) {
				throw new Error('Account SID and Auth Token are required');
			}
			return trpcClient.integrationsDiscovery.verifyTwilio.mutate({
				accountSidCredentialId: state.accountSidCredentialId,
				authTokenCredentialId: state.authTokenCredentialId,
			});
		},
		onSuccess: (result) => {
			setState((prev) => ({
				...prev,
				verifiedName: result.friendlyName,
				verifyError: null,
			}));
			setOpenSteps((prev) => new Set([...prev, 3]));
		},
		onError: (err) => {
			setState((prev) => ({
				...prev,
				verifiedName: null,
				verifyError: err instanceof Error ? err.message : String(err),
			}));
		},
	});

	// Save integration
	const saveMutation = useMutation({
		mutationFn: async () => {
			await trpcClient.projects.integrations.upsert.mutate({
				projectId,
				category: 'sms',
				provider: 'twilio',
				config: {},
			});

			const credPairs = [
				{ role: 'account_sid', credentialId: state.accountSidCredentialId },
				{ role: 'auth_token', credentialId: state.authTokenCredentialId },
				{ role: 'phone_number', credentialId: state.phoneNumberCredentialId },
			].filter((p): p is { role: string; credentialId: number } => p.credentialId !== null);

			for (const { role, credentialId } of credPairs) {
				await trpcClient.projects.integrationCredentials.set.mutate({
					projectId,
					category: 'sms',
					role,
					credentialId,
				});
			}
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.projects.integrations.list.queryOptions({ projectId }).queryKey,
			});
			queryClient.invalidateQueries({
				queryKey: trpc.projects.integrationCredentials.list.queryOptions({
					projectId,
					category: 'sms',
				}).queryKey,
			});
		},
	});

	return (
		<div className="space-y-3">
			<p className="text-sm text-muted-foreground">
				Configure Twilio to send and receive SMS messages. You'll need a Twilio account with a
				purchased phone number.
			</p>

			{/* Step 1: Credentials */}
			<WizardStep
				stepNumber={1}
				title="Credentials"
				status={getStatus(1, step1Complete)}
				isOpen={openSteps.has(1)}
				onToggle={() => toggleStep(1)}
			>
				<div className="space-y-4">
					<CredentialSelect
						label="Account SID"
						value={state.accountSidCredentialId}
						onChange={(id) => setState((prev) => ({ ...prev, accountSidCredentialId: id }))}
						credentials={orgCredentials}
						suggestedKey="TWILIO_ACCOUNT_SID"
					/>
					<CredentialSelect
						label="Auth Token"
						value={state.authTokenCredentialId}
						onChange={(id) => setState((prev) => ({ ...prev, authTokenCredentialId: id }))}
						credentials={orgCredentials}
						suggestedKey="TWILIO_AUTH_TOKEN"
					/>
					<CredentialSelect
						label="Phone Number"
						value={state.phoneNumberCredentialId}
						onChange={(id) => setState((prev) => ({ ...prev, phoneNumberCredentialId: id }))}
						credentials={orgCredentials}
						suggestedKey="TWILIO_PHONE_NUMBER"
					/>
					{step1Complete && (
						<button
							type="button"
							onClick={() => setOpenSteps((prev) => new Set([...prev, 2]))}
							className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
						>
							Continue
						</button>
					)}
				</div>
			</WizardStep>

			{/* Step 2: Verify */}
			<WizardStep
				stepNumber={2}
				title="Verify Connection"
				status={getStatus(2, step2Complete)}
				isOpen={openSteps.has(2)}
				onToggle={() => toggleStep(2)}
			>
				<div className="space-y-4">
					{step2Complete ? (
						<div className="flex items-center gap-2 text-sm text-green-600">
							<CheckCircle className="h-4 w-4" />
							Verified: <span className="font-medium">{state.verifiedName}</span>
						</div>
					) : (
						<>
							<p className="text-sm text-muted-foreground">
								Test the Twilio credentials by fetching your account details.
							</p>
							<button
								type="button"
								onClick={() => verifyMutation.mutate()}
								disabled={!step1Complete || verifyMutation.isPending}
								className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
							>
								{verifyMutation.isPending ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : (
									<MessageSquare className="h-4 w-4" />
								)}
								Verify Connection
							</button>
						</>
					)}
					{state.verifyError && (
						<div className="flex items-center gap-2 text-sm text-destructive">
							<XCircle className="h-4 w-4" />
							{state.verifyError}
						</div>
					)}
				</div>
			</WizardStep>

			{/* Step 3: Save */}
			<WizardStep
				stepNumber={3}
				title="Save"
				status={getStatus(3, saveMutation.isSuccess)}
				isOpen={openSteps.has(3)}
				onToggle={() => toggleStep(3)}
			>
				<div className="space-y-4">
					<div className="rounded-md bg-muted/50 p-4 space-y-2 text-sm">
						<div className="flex justify-between">
							<span className="text-muted-foreground">Provider</span>
							<span className="font-medium">Twilio</span>
						</div>
						{state.verifiedName && (
							<div className="flex justify-between">
								<span className="text-muted-foreground">Account</span>
								<span className="font-medium">{state.verifiedName}</span>
							</div>
						)}
					</div>
					{/* Webhook URL — shown after save (and on re-edit) */}
					{(saveMutation.isSuccess || step1Complete) && <WebhookUrlPanel projectId={projectId} />}
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => saveMutation.mutate()}
							disabled={!step1Complete || saveMutation.isPending}
							className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
						>
							{saveMutation.isPending ? 'Saving...' : 'Save Integration'}
						</button>
						{saveMutation.isSuccess && (
							<span className="text-sm text-green-600">Integration saved successfully.</span>
						)}
						{saveMutation.isError && (
							<span className="text-sm text-destructive">{saveMutation.error.message}</span>
						)}
					</div>
				</div>
			</WizardStep>
		</div>
	);
}
