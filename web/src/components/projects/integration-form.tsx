import { Badge } from '@/components/ui/badge.js';
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
import { PMWizard } from './pm-wizard.js';

type IntegrationCategory = 'pm' | 'scm';

// ============================================================================
// Project Credential Input — write-only, shows "Configured" badge when set
// ============================================================================

interface ProjectCredentialMeta {
	envVarKey: string;
	name: string | null;
	isConfigured: boolean;
	maskedValue: string;
}

function ProjectSecretInput({
	projectId,
	envVarKey,
	label,
	description,
	placeholder,
	credential,
	onSaved,
	onCleared,
	verifiedLogin,
	onVerify,
	isVerifying,
	verifyError,
}: {
	projectId: string;
	envVarKey: string;
	label: string;
	description?: string;
	placeholder?: string;
	credential?: ProjectCredentialMeta;
	onSaved?: () => void;
	onCleared?: () => void;
	verifiedLogin?: string | null;
	onVerify?: (rawValue: string) => void;
	isVerifying?: boolean;
	verifyError?: string | null;
}) {
	const [value, setValue] = useState('');
	const queryClient = useQueryClient();

	const saveMutation = useMutation({
		mutationFn: () =>
			trpcClient.projects.credentials.set.mutate({
				projectId,
				envVarKey,
				value,
				name: label,
			}),
		onSuccess: () => {
			setValue('');
			queryClient.invalidateQueries({
				queryKey: trpc.projects.credentials.list.queryOptions({ projectId }).queryKey,
			});
			onSaved?.();
		},
	});

	const deleteMutation = useMutation({
		mutationFn: () => trpcClient.projects.credentials.delete.mutate({ projectId, envVarKey }),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.projects.credentials.list.queryOptions({ projectId }).queryKey,
			});
			onCleared?.();
		},
	});

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<Label>{label}</Label>
				{credential?.isConfigured && (
					<Badge variant="secondary" className="text-xs font-mono">
						{credential.maskedValue}
					</Badge>
				)}
			</div>
			{description && <p className="text-xs text-muted-foreground">{description}</p>}
			<div className="flex gap-2">
				<Input
					type="password"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					placeholder={credential?.isConfigured ? 'Enter new value to update...' : placeholder}
					autoComplete="off"
					className="flex-1"
				/>
				<button
					type="button"
					onClick={() => saveMutation.mutate()}
					disabled={!value || saveMutation.isPending}
					className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 shrink-0"
				>
					{saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
				</button>
				{onVerify && (
					<button
						type="button"
						onClick={() => onVerify(value || '')}
						disabled={(!value && !credential?.isConfigured) || isVerifying}
						className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm font-medium hover:bg-accent disabled:opacity-50 shrink-0"
					>
						{isVerifying ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify'}
					</button>
				)}
				{credential?.isConfigured && (
					<button
						type="button"
						onClick={() => deleteMutation.mutate()}
						disabled={deleteMutation.isPending}
						className="p-2 text-muted-foreground hover:text-destructive disabled:opacity-50"
						title="Clear credential"
					>
						{deleteMutation.isPending ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Trash2 className="h-4 w-4" />
						)}
					</button>
				)}
			</div>
			{saveMutation.isError && (
				<p className="text-xs text-destructive">{saveMutation.error.message}</p>
			)}
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
// GitHub Credential Slots (replaces the old CredentialSelector dropdowns)
// ============================================================================

function GitHubCredentialSlots({ projectId }: { projectId: string }) {
	const credentialsQuery = useQuery(trpc.projects.credentials.list.queryOptions({ projectId }));

	const [verifiedLogins, setVerifiedLogins] = useState<Record<string, string | null>>({});
	const [verifyErrors, setVerifyErrors] = useState<Record<string, string | null>>({});
	const [verifyingRoles, setVerifyingRoles] = useState<Record<string, boolean>>({});

	const credentials = credentialsQuery.data ?? [];
	const implementerCred = credentials.find((c) => c.envVarKey === 'GITHUB_TOKEN_IMPLEMENTER');
	const reviewerCred = credentials.find((c) => c.envVarKey === 'GITHUB_TOKEN_REVIEWER');

	const handleVerify = async (role: string, rawValue: string) => {
		// If no new value entered, we can't verify (we never return plaintext to browser)
		if (!rawValue) {
			setVerifyErrors((prev) => ({
				...prev,
				[role]: 'Enter the token value to verify it',
			}));
			return;
		}
		setVerifyingRoles((prev) => ({ ...prev, [role]: true }));
		try {
			const result = await trpcClient.credentials.verifyGithubToken.mutate({ token: rawValue });
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
			<ProjectSecretInput
				projectId={projectId}
				envVarKey="GITHUB_TOKEN_IMPLEMENTER"
				label="Implementer Token"
				description="GitHub PAT for the bot that writes code, creates PRs, and responds to reviews."
				placeholder="ghp_..."
				credential={implementerCred}
				verifiedLogin={verifiedLogins.implementer}
				onVerify={(val) => handleVerify('implementer', val)}
				isVerifying={verifyingRoles.implementer}
				verifyError={verifyErrors.implementer}
			/>
			<ProjectSecretInput
				projectId={projectId}
				envVarKey="GITHUB_TOKEN_REVIEWER"
				label="Reviewer Token"
				description="GitHub PAT for the bot that reviews PRs. Must be a different account."
				placeholder="ghp_..."
				credential={reviewerCred}
				verifiedLogin={verifiedLogins.reviewer}
				onVerify={(val) => handleVerify('reviewer', val)}
				isVerifying={verifyingRoles.reviewer}
				verifyError={verifyErrors.reviewer}
			/>
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

interface SCMTabProject {
	repo?: string | null;
	baseBranch?: string | null;
	branchPrefix?: string | null;
}

function SCMTab({
	projectId,
	project,
}: {
	projectId: string;
	project?: SCMTabProject;
}) {
	const queryClient = useQueryClient();

	// Project-level SCM fields
	const [repo, setRepo] = useState(project?.repo ?? '');
	const [baseBranch, setBaseBranch] = useState(project?.baseBranch ?? 'main');
	const [branchPrefix, setBranchPrefix] = useState(project?.branchPrefix ?? 'feature/');

	useEffect(() => {
		setRepo(project?.repo ?? '');
		setBaseBranch(project?.baseBranch ?? 'main');
		setBranchPrefix(project?.branchPrefix ?? 'feature/');
	}, [project?.repo, project?.baseBranch, project?.branchPrefix]);

	const saveMutation = useMutation({
		mutationFn: async () => {
			// Save project-level SCM fields
			await trpcClient.projects.update.mutate({
				id: projectId,
				repo: repo || undefined,
				baseBranch,
				branchPrefix,
			});

			// Note: triggers are intentionally omitted — they are managed via the Agent Configs tab
			const result = await trpcClient.projects.integrations.upsert.mutate({
				projectId,
				category: 'scm',
				provider: 'github',
				config: {},
			});

			return result;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.projects.getById.queryOptions({ id: projectId }).queryKey,
			});
			queryClient.invalidateQueries({
				queryKey: trpc.projects.listFull.queryOptions().queryKey,
			});
			queryClient.invalidateQueries({
				queryKey: trpc.projects.integrations.list.queryOptions({ projectId }).queryKey,
			});
		},
	});

	return (
		<div className="space-y-6">
			{/* Repository Settings */}
			<div className="space-y-4">
				<Label className="text-sm font-medium">Repository Settings</Label>
				<div className="space-y-2">
					<Label htmlFor="scm-repo">Repository (optional)</Label>
					<Input
						id="scm-repo"
						value={repo}
						onChange={(e) => setRepo(e.target.value)}
						placeholder="owner/repo"
					/>
				</div>
				<div className="grid grid-cols-2 gap-4">
					<div className="space-y-2">
						<Label htmlFor="scm-baseBranch">Base Branch</Label>
						<Input
							id="scm-baseBranch"
							value={baseBranch}
							onChange={(e) => setBaseBranch(e.target.value)}
							placeholder="main"
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="scm-branchPrefix">Branch Prefix</Label>
						<Input
							id="scm-branchPrefix"
							value={branchPrefix}
							onChange={(e) => setBranchPrefix(e.target.value)}
							placeholder="feature/"
						/>
					</div>
				</div>
			</div>

			<hr className="border-border" />

			<p className="text-sm text-muted-foreground">
				CASCADE uses two separate GitHub bot accounts to prevent feedback loops. The{' '}
				<strong>implementer</strong> writes code and creates PRs. The <strong>reviewer</strong>{' '}
				reviews PRs and can approve or request changes.
			</p>

			<GitHubCredentialSlots projectId={projectId} />

			<p className="text-xs text-muted-foreground">
				Trigger configuration has moved to the <strong>Agents</strong> tab.
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
			className={`flex-1 min-w-fit whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
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
	const projectQuery = useQuery(trpc.projects.getById.queryOptions({ id: projectId }));
	const [activeTab, setActiveTab] = useState<IntegrationCategory>('pm');

	if (integrationsQuery.isLoading) {
		return <div className="py-4 text-muted-foreground">Loading integrations...</div>;
	}

	const integrations = integrationsQuery.data ?? [];
	const pmIntegration = findIntegrationByCategory(integrations, 'pm');
	const pmProvider = (pmIntegration?.provider as string) ?? 'trello';

	const pmCredMap = buildCredentialMap(
		pmCredsQuery.data as Array<{ role: string; credentialId: number }>,
	);

	return (
		<div className="max-w-2xl space-y-6">
			<div className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1">
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
			</div>

			{activeTab === 'pm' && (
				<PMWizard
					projectId={projectId}
					initialProvider={pmProvider}
					initialConfig={pmIntegration?.config as Record<string, unknown>}
					initialCredentials={pmCredMap}
				/>
			)}

			{activeTab === 'scm' && <SCMTab projectId={projectId} project={projectQuery.data} />}
		</div>
	);
}
