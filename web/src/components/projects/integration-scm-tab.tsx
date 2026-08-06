/**
 * SCM (GitHub/GitLab) integration tab components.
 * Contains: GitHubCredentialSlots, GitLabCredentialSlots,
 * GitHubWebhookSection, GitLabWebhookSection, SCMTab.
 * `CopyButton` lives at `@/components/ui/copy-button.js` (extracted during
 * PM wizard styling restoration).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
	AlertCircle,
	AlertTriangle,
	ExternalLink,
	Info,
	Loader2,
	RefreshCw,
	Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { CopyButton } from '@/components/ui/copy-button.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { API_URL } from '@/lib/api.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { ProjectSecretField } from './project-secret-field.js';

type SCMProvider = 'github' | 'gitlab';

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
			const result = await trpcClient.integrationsDiscovery.verifyGithubToken.mutate({
				token: rawValue,
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
			<ProjectSecretField
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
			<ProjectSecretField
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
// GitLab Credential Slots
// ============================================================================

function GitLabCredentialSlots({ projectId }: { projectId: string }) {
	const credentialsQuery = useQuery(trpc.projects.credentials.list.queryOptions({ projectId }));

	const credentials = credentialsQuery.data ?? [];
	const implementerCred = credentials.find((c) => c.envVarKey === 'GITLAB_TOKEN_IMPLEMENTER');
	const reviewerCred = credentials.find((c) => c.envVarKey === 'GITLAB_TOKEN_REVIEWER');

	return (
		<div className="space-y-4">
			<Label className="text-sm font-medium">Credentials</Label>
			<ProjectSecretField
				projectId={projectId}
				envVarKey="GITLAB_TOKEN_IMPLEMENTER"
				label="Implementer Token"
				description="GitLab PAT for the bot that writes code, creates MRs, and responds to reviews."
				placeholder="glpat-..."
				credential={implementerCred}
			/>
			<ProjectSecretField
				projectId={projectId}
				envVarKey="GITLAB_TOKEN_REVIEWER"
				label="Reviewer Token"
				description="GitLab PAT for the bot that reviews MRs. Must be a different account."
				placeholder="glpat-..."
				credential={reviewerCred}
			/>
		</div>
	);
}

// ============================================================================
// GitHub Webhook Management
// ============================================================================

/**
 * Build the manual `curl` command an operator can run to register the GitHub
 * webhook by hand.
 *
 * Extracted as a pure function (no React Query / tRPC providers required) so it
 * can be unit-tested in isolation — see `tests/unit/web/scm-github-webhook.test.ts`.
 *
 * The `secret` field is always the literal placeholder `<YOUR_WEBHOOK_SECRET>`;
 * plaintext secrets are NEVER interpolated here or returned to the browser. The
 * operator substitutes the real value (the same one saved in the Webhook Signing
 * Secret field) before running the command, or uses the dashboard's create-webhook
 * button, which injects it server-side from the stored credential.
 */
export function buildGithubWebhookCurl(webhookCallbackUrl: string): string {
	return [
		'curl -X POST "https://api.github.com/repos/<OWNER>/<REPO>/hooks" \\',
		'  -H "Authorization: Bearer <YOUR_GITHUB_TOKEN>" \\',
		'  -H "Content-Type: application/json" \\',
		"  -d '{",
		'    "name": "web",',
		'    "active": true,',
		'    "events": ["push", "pull_request", "pull_request_review", "pull_request_review_comment", "check_suite", "issue_comment"],',
		'    "config": {',
		`      "url": "${webhookCallbackUrl}",`,
		'      "content_type": "json",',
		'      "secret": "<YOUR_WEBHOOK_SECRET>"',
		'    }',
		"  }'",
	].join('\n');
}

function GitHubWebhookSection({ projectId }: { projectId: string }) {
	const queryClient = useQueryClient();

	const credentialsQuery = useQuery(trpc.projects.credentials.list.queryOptions({ projectId }));
	const webhookSecretCred = (credentialsQuery.data ?? []).find(
		(c) => c.envVarKey === 'GITHUB_WEBHOOK_SECRET',
	);

	const callbackBaseUrl =
		API_URL ||
		(typeof window !== 'undefined' ? window.location.origin.replace(':5173', ':3000') : '');

	const webhooksQuery = useQuery(trpc.webhooks.list.queryOptions({ projectId }));

	const createGithubWebhookMutation = useMutation({
		mutationFn: () =>
			trpcClient.webhooks.create.mutate({
				projectId,
				callbackBaseUrl,
				githubOnly: true,
			}),
		onSuccess: () => {
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

	const webhookCallbackUrl = callbackBaseUrl
		? `${callbackBaseUrl}/github/webhook`
		: '<YOUR_CALLBACK_URL>/github/webhook';
	const githubCurlCommand = buildGithubWebhookCurl(webhookCallbackUrl);

	return (
		<div className="space-y-4">
			<div>
				<Label>GitHub Webhooks</Label>
				<p className="text-xs text-muted-foreground mt-1">
					Manage GitHub webhooks for receiving push events, PR updates, and CI status notifications.
				</p>
			</div>

			{/* Webhook signing secret (optional HMAC verification) */}
			<ProjectSecretField
				projectId={projectId}
				envVarKey="GITHUB_WEBHOOK_SECRET"
				label="Webhook Signing Secret (optional)"
				description="CASCADE verifies HMAC-SHA256 on every incoming GitHub webhook when this is set; verification is skipped if left blank. Set the same value as the secret in your GitHub webhook configuration."
				placeholder="Your webhook signing secret"
				credential={webhookSecretCred}
			/>

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

			{/* curl instructions for manual GitHub webhook creation (collapsible) */}
			<details className="rounded-md border border-blue-200 bg-blue-50 px-3 py-3 dark:border-blue-900/50 dark:bg-blue-900/20">
				<summary className="flex items-start gap-2 cursor-pointer list-none">
					<Info className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
					<p className="text-xs text-blue-700 dark:text-blue-300 font-medium">
						Manual webhook creation (alternative: if the button below doesn't work)
					</p>
				</summary>
				<div className="space-y-2 mt-2">
					<p className="text-xs text-blue-600 dark:text-blue-400 pl-6">
						Use the following curl command to create the GitHub webhook manually. Requires a token
						with <code>admin:repo_hook</code> scope.
					</p>
					<div className="relative rounded-md bg-muted border pl-6">
						<div className="absolute top-2 right-2">
							<CopyButton text={githubCurlCommand} />
						</div>
						<pre className="text-xs font-mono whitespace-pre-wrap break-all py-2 pr-16 overflow-x-auto">
							{githubCurlCommand}
						</pre>
					</div>
					<p className="text-xs text-blue-600 dark:text-blue-400 pl-6">
						Replace <code>&lt;YOUR_WEBHOOK_SECRET&gt;</code> with the same value you saved in the{' '}
						<strong>Webhook Signing Secret</strong> field above — it enables HMAC-SHA256 signature
						verification on every delivery. The <strong>Create GitHub Webhook</strong> button
						injects this secret automatically once it's saved (the server resolves it from your
						stored credentials), so manual substitution is only needed for this curl fallback. CLI
						equivalent:{' '}
						<code className="break-all">
							cascade projects credentials-set &lt;id&gt; --key GITHUB_WEBHOOK_SECRET --value
							&lt;secret&gt;
						</code>
						.
					</p>
				</div>
			</details>

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
		</div>
	);
}

// ============================================================================
// GitLab Webhook Management
// ============================================================================

function GitLabWebhookSection({ projectId }: { projectId: string }) {
	const callbackBaseUrl =
		API_URL ||
		(typeof window !== 'undefined' ? window.location.origin.replace(':5173', ':3000') : '');

	const webhookCallbackUrl = callbackBaseUrl
		? `${callbackBaseUrl}/gitlab/webhook`
		: '<YOUR_CALLBACK_URL>/gitlab/webhook';

	return (
		<div className="space-y-4">
			<div>
				<Label>GitLab Webhooks</Label>
				<p className="text-xs text-muted-foreground mt-1">
					Configure GitLab webhooks for receiving push events, MR updates, and pipeline
					notifications.
				</p>
			</div>

			<div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-3 dark:border-blue-900/50 dark:bg-blue-900/20">
				<div className="flex items-start gap-2">
					<Info className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
					<div className="space-y-2">
						<p className="text-xs text-blue-700 dark:text-blue-300 font-medium">
							GitLab webhook setup
						</p>
						<p className="text-xs text-blue-600 dark:text-blue-400">
							Configure the webhook in your GitLab project under Settings &gt; Webhooks. Use the URL
							below and enable the following triggers: Push events, Merge request events, Pipeline
							events.
						</p>
						<div className="flex items-center gap-2">
							<code className="text-xs font-mono bg-muted px-2 py-1 rounded border break-all">
								{webhookCallbackUrl}
							</code>
							<CopyButton text={webhookCallbackUrl} />
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

// ============================================================================
// SCM Provider Selector
// ============================================================================

function SCMProviderSelector({
	value,
	onChange,
}: {
	value: SCMProvider;
	onChange: (provider: SCMProvider) => void;
}) {
	return (
		<div className="space-y-2">
			<Label className="text-sm font-medium">SCM Provider</Label>
			<div className="flex gap-2">
				<button
					type="button"
					onClick={() => onChange('github')}
					className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
						value === 'github'
							? 'border-primary bg-primary/5 text-foreground'
							: 'border-input text-muted-foreground hover:text-foreground hover:border-foreground/30'
					}`}
				>
					GitHub
				</button>
				<button
					type="button"
					onClick={() => onChange('gitlab')}
					className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
						value === 'gitlab'
							? 'border-primary bg-primary/5 text-foreground'
							: 'border-input text-muted-foreground hover:text-foreground hover:border-foreground/30'
					}`}
				>
					GitLab
				</button>
			</div>
		</div>
	);
}

// ============================================================================
// SCM Tab (GitHub / GitLab)
// ============================================================================

interface SCMTabProject {
	repo?: string | null;
	baseBranch?: string | null;
	branchPrefix?: string | null;
}

export function SCMTab({
	projectId,
	project,
	initialProvider = 'github',
}: {
	projectId: string;
	project?: SCMTabProject;
	initialProvider?: SCMProvider;
}) {
	const queryClient = useQueryClient();

	const [scmProvider, setScmProvider] = useState<SCMProvider>(initialProvider);

	// Project-level SCM fields
	const [repo, setRepo] = useState(project?.repo ?? '');
	const [baseBranch, setBaseBranch] = useState(project?.baseBranch ?? 'main');
	const [branchPrefix, setBranchPrefix] = useState(project?.branchPrefix ?? 'feature/');

	useEffect(() => {
		setRepo(project?.repo ?? '');
		setBaseBranch(project?.baseBranch ?? 'main');
		setBranchPrefix(project?.branchPrefix ?? 'feature/');
	}, [project?.repo, project?.baseBranch, project?.branchPrefix]);

	useEffect(() => {
		setScmProvider(initialProvider);
	}, [initialProvider]);

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
				provider: scmProvider,
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

	const repoPlaceholder = scmProvider === 'gitlab' ? 'group/subgroup/repo' : 'owner/repo';
	const providerLabel = scmProvider === 'gitlab' ? 'GitLab' : 'GitHub';

	return (
		<div className="space-y-6">
			<SCMProviderSelector value={scmProvider} onChange={setScmProvider} />

			<hr className="border-border" />

			{/* Repository Settings */}
			<div className="space-y-4">
				<Label className="text-sm font-medium">Repository Settings</Label>
				<div className="space-y-2">
					<Label htmlFor="scm-repo">Repository (optional)</Label>
					<Input
						id="scm-repo"
						value={repo}
						onChange={(e) => setRepo(e.target.value)}
						placeholder={repoPlaceholder}
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
				CASCADE uses two separate {providerLabel} bot accounts to prevent feedback loops. The{' '}
				<strong>implementer</strong> writes code and creates{' '}
				{scmProvider === 'gitlab' ? 'MRs' : 'PRs'}. The <strong>reviewer</strong> reviews{' '}
				{scmProvider === 'gitlab' ? 'MRs' : 'PRs'} and can approve or request changes.
			</p>

			{scmProvider === 'github' ? (
				<GitHubCredentialSlots projectId={projectId} />
			) : (
				<GitLabCredentialSlots projectId={projectId} />
			)}

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

			{scmProvider === 'github' ? (
				<GitHubWebhookSection projectId={projectId} />
			) : (
				<GitLabWebhookSection projectId={projectId} />
			)}
		</div>
	);
}
