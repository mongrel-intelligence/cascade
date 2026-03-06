import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { API_URL } from '@/lib/api.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
	AlertCircle,
	AlertTriangle,
	CheckCircle,
	ChevronDown,
	ChevronRight,
	ExternalLink,
	KeyRound,
	Loader2,
	RefreshCw,
	Trash2,
	XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { EmailWizard } from './email-wizard.js';
import { PMWizard } from './pm-wizard.js';
import { TwilioWizard } from './twilio-wizard.js';

type IntegrationCategory = 'pm' | 'scm' | 'email' | 'sms';

interface CredentialOption {
	id: number;
	name: string;
	envVarKey: string;
	value: string;
}

function CredentialSelector({
	label,
	description,
	credentials,
	selectedId,
	onChange,
	verifiedLogin,
	onVerify,
	isVerifying,
	verifyError,
}: {
	label: string;
	description: string;
	credentials: CredentialOption[];
	selectedId: number | null;
	onChange: (id: number | null) => void;
	verifiedLogin?: string | null;
	onVerify?: () => void;
	isVerifying?: boolean;
	verifyError?: string | null;
}) {
	return (
		<div className="space-y-2">
			<Label>{label}</Label>
			<p className="text-xs text-muted-foreground">{description}</p>
			<div className="flex gap-2">
				<select
					value={selectedId ?? ''}
					onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
					className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
				>
					<option value="">Select a credential...</option>
					{credentials.map((c) => (
						<option key={c.id} value={c.id}>
							{c.name} ({c.envVarKey})
						</option>
					))}
				</select>
				{onVerify && (
					<button
						type="button"
						onClick={onVerify}
						disabled={!selectedId || isVerifying}
						className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
					>
						{isVerifying ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify'}
					</button>
				)}
			</div>
			{verifiedLogin && (
				<div className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
					<CheckCircle className="h-4 w-4" />
					Resolved: <span className="font-medium">{verifiedLogin}</span>
				</div>
			)}
			{verifyError && (
				<div className="flex items-center gap-1.5 text-sm text-destructive">
					<XCircle className="h-4 w-4" />
					{verifyError}
				</div>
			)}
		</div>
	);
}

// ============================================================================
// Provider-specific credential role definitions
// ============================================================================

interface CredentialRoleDef {
	role: string;
	label: string;
	description: string;
	hasVerify?: boolean;
}

const SCM_CREDENTIAL_ROLES: Record<string, CredentialRoleDef[]> = {
	github: [
		{
			role: 'implementer_token',
			label: 'Implementer Token',
			description: 'GitHub PAT for the bot that writes code, creates PRs, and responds to reviews.',
			hasVerify: true,
		},
		{
			role: 'reviewer_token',
			label: 'Reviewer Token',
			description: 'GitHub PAT for the bot that reviews PRs. Must be a different account.',
			hasVerify: true,
		},
	],
};

// ============================================================================
// Integration credential slot component
// ============================================================================

function IntegrationCredentialSlots({
	projectId,
	category,
	roles,
	credentials,
	existingCredentials,
	onCredentialsChange,
}: {
	projectId: string;
	category: IntegrationCategory;
	roles: CredentialRoleDef[];
	credentials: CredentialOption[];
	existingCredentials: Map<string, number>;
	onCredentialsChange: (role: string, credentialId: number | null) => void;
}) {
	const [verifiedLogins, setVerifiedLogins] = useState<Record<string, string | null>>({});
	const [verifyErrors, setVerifyErrors] = useState<Record<string, string | null>>({});
	const [verifyingRoles, setVerifyingRoles] = useState<Record<string, boolean>>({});

	const handleVerify = async (role: string, credentialId: number) => {
		setVerifyingRoles((prev) => ({ ...prev, [role]: true }));
		try {
			const result = await trpcClient.credentials.verifyGithubIdentity.mutate({
				credentialId,
			});
			setVerifiedLogins((prev) => ({ ...prev, [role]: result.login }));
			setVerifyErrors((prev) => ({ ...prev, [role]: null }));
		} catch (err) {
			setVerifiedLogins((prev) => ({ ...prev, [role]: null }));
			setVerifyErrors((prev) => ({
				...prev,
				[role]: err instanceof Error ? err.message : String(err),
			}));
		} finally {
			setVerifyingRoles((prev) => ({ ...prev, [role]: false }));
		}
	};

	return (
		<div className="space-y-4">
			<Label className="text-sm font-medium">Credentials</Label>
			{roles.map((roleDef) => (
				<CredentialSelector
					key={roleDef.role}
					label={roleDef.label}
					description={roleDef.description}
					credentials={credentials}
					selectedId={existingCredentials.get(roleDef.role) ?? null}
					onChange={(id) => {
						onCredentialsChange(roleDef.role, id);
						setVerifiedLogins((prev) => ({ ...prev, [roleDef.role]: null }));
						setVerifyErrors((prev) => ({ ...prev, [roleDef.role]: null }));
					}}
					verifiedLogin={roleDef.hasVerify ? verifiedLogins[roleDef.role] : undefined}
					onVerify={
						roleDef.hasVerify
							? () => {
									const credId = existingCredentials.get(roleDef.role);
									if (credId) handleVerify(roleDef.role, credId);
								}
							: undefined
					}
					isVerifying={roleDef.hasVerify ? verifyingRoles[roleDef.role] : undefined}
					verifyError={roleDef.hasVerify ? verifyErrors[roleDef.role] : undefined}
				/>
			))}
		</div>
	);
}

// ============================================================================
// GitHub Webhook Management
// ============================================================================

function GitHubWebhookSection({ projectId }: { projectId: string }) {
	const queryClient = useQueryClient();

	const callbackBaseUrl =
		API_URL ||
		(typeof window !== 'undefined' ? window.location.origin.replace(':5173', ':3000') : '');

	const [adminTokensOpen, setAdminTokensOpen] = useState(false);
	const [oneTimeGithubToken, setOneTimeGithubToken] = useState('');

	const buildOneTimeTokens = () => {
		if (oneTimeGithubToken) return { github: oneTimeGithubToken };
		return undefined;
	};

	const webhooksQuery = useQuery(trpc.webhooks.list.queryOptions({ projectId }));

	const createGithubWebhookMutation = useMutation({
		mutationFn: () =>
			trpcClient.webhooks.create.mutate({
				projectId,
				callbackBaseUrl,
				githubOnly: true,
				oneTimeTokens: buildOneTimeTokens(),
			}),
		onSuccess: () => {
			setOneTimeGithubToken('');
			queryClient.invalidateQueries({
				queryKey: trpc.webhooks.list.queryOptions({ projectId }).queryKey,
			});
		},
	});

	const deleteGithubWebhookMutation = useMutation({
		mutationFn: (deleteCallbackBaseUrl: string) =>
			trpcClient.webhooks.delete.mutate({
				projectId,
				callbackBaseUrl: deleteCallbackBaseUrl,
				githubOnly: true,
				oneTimeTokens: buildOneTimeTokens(),
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.webhooks.list.queryOptions({ projectId }).queryKey,
			});
		},
	});

	const activeGithubWebhooks = (webhooksQuery.data?.github ?? []).map((w) => ({
		id: String(w.id),
		url: w.config.url ?? '',
		active: w.active,
	}));

	return (
		<div className="space-y-4">
			<div>
				<Label>GitHub Webhooks</Label>
				<p className="text-xs text-muted-foreground mt-1">
					Manage GitHub webhooks for receiving push events, PR updates, and CI status notifications.
				</p>
			</div>

			{/* GitHub-specific error */}
			{webhooksQuery.data?.errors?.github && (
				<div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-900/20">
					<AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
					<div className="flex-1 text-sm">
						<span className="font-medium text-amber-700 dark:text-amber-400">GitHub</span>
						<span className="text-amber-600 dark:text-amber-500">
							: {String(webhooksQuery.data.errors.github)}
						</span>
					</div>
					<button
						type="button"
						onClick={() => webhooksQuery.refetch()}
						className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 shrink-0"
					>
						<RefreshCw className="h-3 w-3" /> Retry
					</button>
				</div>
			)}

			{/* Active webhooks list */}
			{webhooksQuery.isLoading ? (
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 className="h-4 w-4 animate-spin" /> Loading webhooks...
				</div>
			) : activeGithubWebhooks.length > 0 ? (
				<div className="space-y-2">
					{activeGithubWebhooks.map((w) => (
						<div
							key={w.id}
							className="flex items-center justify-between rounded-md border px-3 py-2"
						>
							<div className="flex items-center gap-2 text-sm">
								<span
									className={`inline-block h-2 w-2 rounded-full ${w.active ? 'bg-green-500 dark:bg-green-400' : 'bg-amber-500 dark:bg-amber-400'}`}
								/>
								<span className="font-mono text-xs">{w.url}</span>
							</div>
							<button
								type="button"
								onClick={() => {
									const base = w.url.replace(/\/github\/webhook$/, '');
									deleteGithubWebhookMutation.mutate(base);
								}}
								disabled={deleteGithubWebhookMutation.isPending}
								className="p-1 text-muted-foreground hover:text-destructive"
							>
								<Trash2 className="h-4 w-4" />
							</button>
						</div>
					))}
				</div>
			) : (
				<div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
					<AlertCircle className="h-4 w-4" />
					No GitHub webhooks configured for this project.
				</div>
			)}

			{/* Create webhook button */}
			<div className="space-y-2">
				<button
					type="button"
					onClick={() => createGithubWebhookMutation.mutate()}
					disabled={!callbackBaseUrl || createGithubWebhookMutation.isPending}
					className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 shrink-0"
				>
					{createGithubWebhookMutation.isPending ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<ExternalLink className="h-4 w-4" />
					)}
					Create GitHub Webhook
				</button>
				{createGithubWebhookMutation.isError && (
					<p className="text-sm text-destructive">{createGithubWebhookMutation.error.message}</p>
				)}
				{createGithubWebhookMutation.isSuccess && (
					<p className="text-sm text-green-600 dark:text-green-400">
						GitHub webhook created successfully.
					</p>
				)}
			</div>

			{/* One-time admin credentials */}
			<div className="border rounded-md">
				<button
					type="button"
					onClick={() => setAdminTokensOpen((prev) => !prev)}
					className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground hover:text-foreground transition-colors"
				>
					<KeyRound className="h-4 w-4" />
					<span className="flex-1">Use admin credentials (one-time)</span>
					{adminTokensOpen ? (
						<ChevronDown className="h-4 w-4" />
					) : (
						<ChevronRight className="h-4 w-4" />
					)}
				</button>
				{adminTokensOpen && (
					<div className="border-t px-3 py-3 space-y-3">
						<p className="text-xs text-muted-foreground">
							Provide a token with elevated permissions for webhook management. This is used once
							and never saved.
						</p>
						<div className="space-y-1">
							<Label className="text-xs">
								GitHub PAT{' '}
								<span className="text-muted-foreground font-normal">(admin:repo_hook scope)</span>
							</Label>
							<Input
								value={oneTimeGithubToken}
								onChange={(e) => setOneTimeGithubToken(e.target.value)}
								placeholder="ghp_... — used once, not saved"
								type="password"
								className="h-8 text-sm"
							/>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

// ============================================================================
// SCM Tab (GitHub)
// ============================================================================

function SCMTab({
	projectId,
	initialProvider,
	initialCredentials,
}: {
	projectId: string;
	initialProvider: string;
	initialCredentials: Map<string, number>;
}) {
	const queryClient = useQueryClient();

	const credentialsQuery = useQuery(trpc.credentials.list.queryOptions());
	const orgCredentials = (credentialsQuery.data ?? []) as CredentialOption[];

	const [provider] = useState(initialProvider || 'github');
	const [credentialMap, setCredentialMap] = useState<Map<string, number>>(initialCredentials);

	useEffect(() => {
		setCredentialMap(initialCredentials);
	}, [initialCredentials]);

	const saveMutation = useMutation({
		mutationFn: async () => {
			// Note: triggers are intentionally omitted — they are managed via the Agent Configs tab
			const result = await trpcClient.projects.integrations.upsert.mutate({
				projectId,
				category: 'scm',
				provider,
				config: {},
			});

			// Set integration credentials
			for (const [role, credentialId] of credentialMap) {
				await trpcClient.projects.integrationCredentials.set.mutate({
					projectId,
					category: 'scm',
					role,
					credentialId,
				});
			}

			return result;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.projects.integrations.list.queryOptions({ projectId }).queryKey,
			});
			queryClient.invalidateQueries({
				queryKey: trpc.projects.integrationCredentials.list.queryOptions({
					projectId,
					category: 'scm',
				}).queryKey,
			});
		},
	});

	const credentialRoles = SCM_CREDENTIAL_ROLES[provider] ?? [];

	return (
		<div className="space-y-6">
			<p className="text-sm text-muted-foreground">
				CASCADE uses two separate GitHub bot accounts to prevent feedback loops. The{' '}
				<strong>implementer</strong> writes code and creates PRs. The <strong>reviewer</strong>{' '}
				reviews PRs and can approve or request changes.
			</p>

			<IntegrationCredentialSlots
				projectId={projectId}
				category="scm"
				roles={credentialRoles}
				credentials={orgCredentials}
				existingCredentials={credentialMap}
				onCredentialsChange={(role, id) => {
					setCredentialMap((prev) => {
						const next = new Map(prev);
						if (id) {
							next.set(role, id);
						} else {
							next.delete(role);
						}
						return next;
					});
				}}
			/>

			<p className="text-xs text-muted-foreground">
				Trigger configuration has moved to the <strong>Agent Configs</strong> tab.
			</p>

			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={() => saveMutation.mutate()}
					disabled={saveMutation.isPending}
					className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
				>
					{saveMutation.isPending ? 'Saving...' : 'Save Integration'}
				</button>
				{saveMutation.isSuccess && <span className="text-sm text-muted-foreground">Saved</span>}
				{saveMutation.isError && (
					<span className="text-sm text-destructive">{saveMutation.error.message}</span>
				)}
			</div>

			<hr className="border-border" />

			<GitHubWebhookSection projectId={projectId} />
		</div>
	);
}

// ============================================================================
// Helpers
// ============================================================================

function buildCredentialMap(
	data: Array<{ role: string; credentialId: number }> | undefined,
): Map<string, number> {
	const map = new Map<string, number>();
	for (const c of data ?? []) {
		map.set(c.role, c.credentialId);
	}
	return map;
}

function findIntegrationByCategory(
	integrations: unknown[],
	category: string,
): Record<string, unknown> | undefined {
	return integrations.find((i) => (i as Record<string, unknown>).category === category) as
		| Record<string, unknown>
		| undefined;
}

function TabButton({
	label,
	tab,
	activeTab,
	onClick,
}: {
	label: string;
	tab: IntegrationCategory;
	activeTab: IntegrationCategory;
	onClick: () => void;
}) {
	const isActive = activeTab === tab;
	return (
		<button
			type="button"
			onClick={onClick}
			className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
				isActive
					? 'bg-background text-foreground shadow-sm'
					: 'text-muted-foreground hover:text-foreground'
			}`}
		>
			{label}
		</button>
	);
}

// ============================================================================
// Main Integration Form
// ============================================================================

export function IntegrationForm({ projectId }: { projectId: string }) {
	const integrationsQuery = useQuery(trpc.projects.integrations.list.queryOptions({ projectId }));
	const pmCredsQuery = useQuery(
		trpc.projects.integrationCredentials.list.queryOptions({ projectId, category: 'pm' }),
	);
	const scmCredsQuery = useQuery(
		trpc.projects.integrationCredentials.list.queryOptions({ projectId, category: 'scm' }),
	);
	const emailCredsQuery = useQuery(
		trpc.projects.integrationCredentials.list.queryOptions({ projectId, category: 'email' }),
	);
	const smsCredsQuery = useQuery(
		trpc.projects.integrationCredentials.list.queryOptions({ projectId, category: 'sms' }),
	);

	const [activeTab, setActiveTab] = useState<IntegrationCategory>('pm');

	if (integrationsQuery.isLoading) {
		return <div className="py-4 text-muted-foreground">Loading integrations...</div>;
	}

	const integrations = integrationsQuery.data ?? [];
	const pmIntegration = findIntegrationByCategory(integrations, 'pm');
	const scmIntegration = findIntegrationByCategory(integrations, 'scm');
	const emailIntegration = findIntegrationByCategory(integrations, 'email');

	const pmProvider = (pmIntegration?.provider as string) ?? 'trello';
	const scmProvider = (scmIntegration?.provider as string) ?? 'github';
	const emailProvider = (emailIntegration?.provider as string) ?? '';

	const pmCredMap = buildCredentialMap(
		pmCredsQuery.data as Array<{ role: string; credentialId: number }>,
	);
	const scmCredMap = buildCredentialMap(
		scmCredsQuery.data as Array<{ role: string; credentialId: number }>,
	);
	const emailCredMap = buildCredentialMap(
		emailCredsQuery.data as Array<{ role: string; credentialId: number }>,
	);
	const smsCredMap = buildCredentialMap(
		smsCredsQuery.data as Array<{ role: string; credentialId: number }>,
	);

	return (
		<div className="max-w-2xl space-y-6">
			<div className="flex gap-1 rounded-lg bg-muted p-1">
				<TabButton
					label="Project Management"
					tab="pm"
					activeTab={activeTab}
					onClick={() => setActiveTab('pm')}
				/>
				<TabButton
					label="Source Control"
					tab="scm"
					activeTab={activeTab}
					onClick={() => setActiveTab('scm')}
				/>
				<TabButton
					label="Email"
					tab="email"
					activeTab={activeTab}
					onClick={() => setActiveTab('email')}
				/>
				<TabButton
					label="SMS"
					tab="sms"
					activeTab={activeTab}
					onClick={() => setActiveTab('sms')}
				/>
			</div>

			{activeTab === 'pm' && (
				<PMWizard
					projectId={projectId}
					initialProvider={pmProvider}
					initialConfig={pmIntegration?.config as Record<string, unknown>}
					initialCredentials={pmCredMap}
				/>
			)}

			{activeTab === 'scm' && (
				<SCMTab
					projectId={projectId}
					initialProvider={scmProvider}
					initialCredentials={scmCredMap}
				/>
			)}

			{activeTab === 'email' && (
				<EmailWizard
					projectId={projectId}
					initialProvider={emailProvider}
					initialCredentials={emailCredMap}
				/>
			)}

			{activeTab === 'sms' && (
				<TwilioWizard projectId={projectId} initialCredentials={smsCredMap} />
			)}
		</div>
	);
}
