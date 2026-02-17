import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Loader2, Plus, Trash2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

interface KVPair {
	key: string;
	value: string;
}

function KeyValueEditor({
	label,
	pairs,
	onChange,
}: {
	label: string;
	pairs: KVPair[];
	onChange: (pairs: KVPair[]) => void;
}) {
	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<Label>{label}</Label>
				<button
					type="button"
					onClick={() => onChange([...pairs, { key: '', value: '' }])}
					className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
				>
					<Plus className="h-3 w-3" /> Add
				</button>
			</div>
			{pairs.map((pair, i) => (
				<div key={`${pair.key}-${i}`} className="flex gap-2">
					<Input
						value={pair.key}
						onChange={(e) => {
							const next = [...pairs];
							next[i] = { ...next[i], key: e.target.value };
							onChange(next);
						}}
						placeholder="Key"
						className="flex-1"
					/>
					<Input
						value={pair.value}
						onChange={(e) => {
							const next = [...pairs];
							next[i] = { ...next[i], value: e.target.value };
							onChange(next);
						}}
						placeholder="Value"
						className="flex-1"
					/>
					<button
						type="button"
						onClick={() => onChange(pairs.filter((_, j) => j !== i))}
						className="p-2 text-muted-foreground hover:text-destructive"
					>
						<Trash2 className="h-4 w-4" />
					</button>
				</div>
			))}
			{pairs.length === 0 && <p className="text-xs text-muted-foreground">No entries</p>}
		</div>
	);
}

function toKVPairs(obj: Record<string, string> | undefined): KVPair[] {
	if (!obj) return [];
	return Object.entries(obj).map(([key, value]) => ({ key, value }));
}

function fromKVPairs(pairs: KVPair[]): Record<string, string> {
	const result: Record<string, string> = {};
	for (const pair of pairs) {
		if (pair.key.trim()) {
			result[pair.key.trim()] = pair.value;
		}
	}
	return result;
}

type IntegrationType = 'trello' | 'jira' | 'github';

function TrelloForm({
	projectId,
	initialConfig,
}: {
	projectId: string;
	initialConfig?: Record<string, unknown>;
}) {
	const queryClient = useQueryClient();

	const [boardId, setBoardId] = useState('');
	const [lists, setLists] = useState<KVPair[]>([]);
	const [labels, setLabels] = useState<KVPair[]>([]);
	const [costField, setCostField] = useState('');

	useEffect(() => {
		if (initialConfig) {
			setBoardId((initialConfig.boardId as string) ?? '');
			setLists(toKVPairs(initialConfig.lists as Record<string, string>));
			setLabels(toKVPairs(initialConfig.labels as Record<string, string>));
			const cf = initialConfig.customFields as Record<string, string> | undefined;
			setCostField(cf?.cost ?? '');
		}
	}, [initialConfig]);

	const upsertMutation = useMutation({
		mutationFn: () =>
			trpcClient.projects.integrations.upsert.mutate({
				projectId,
				type: 'trello',
				config: {
					boardId,
					lists: fromKVPairs(lists),
					labels: fromKVPairs(labels),
					...(costField ? { customFields: { cost: costField } } : {}),
				},
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.projects.integrations.list.queryOptions({ projectId }).queryKey,
			});
		},
	});

	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<Label htmlFor="boardId">Board ID</Label>
				<Input
					id="boardId"
					value={boardId}
					onChange={(e) => setBoardId(e.target.value)}
					placeholder="Trello board ID"
				/>
			</div>

			<KeyValueEditor label="Lists" pairs={lists} onChange={setLists} />
			<KeyValueEditor label="Labels" pairs={labels} onChange={setLabels} />

			<div className="space-y-2">
				<Label htmlFor="costField">Custom Field: Cost</Label>
				<Input
					id="costField"
					value={costField}
					onChange={(e) => setCostField(e.target.value)}
					placeholder="Custom field ID for cost tracking"
				/>
			</div>

			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={() => upsertMutation.mutate()}
					disabled={upsertMutation.isPending}
					className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
				>
					{upsertMutation.isPending ? 'Saving...' : 'Save Integration'}
				</button>
				{upsertMutation.isSuccess && <span className="text-sm text-muted-foreground">Saved</span>}
				{upsertMutation.isError && (
					<span className="text-sm text-destructive">{upsertMutation.error.message}</span>
				)}
			</div>
		</div>
	);
}

function JiraForm({
	projectId,
	initialConfig,
}: {
	projectId: string;
	initialConfig?: Record<string, unknown>;
}) {
	const queryClient = useQueryClient();

	const [jiraProjectKey, setJiraProjectKey] = useState('');
	const [baseUrl, setBaseUrl] = useState('');
	const [statuses, setStatuses] = useState<KVPair[]>([]);
	const [issueTypes, setIssueTypes] = useState<KVPair[]>([]);
	const [costField, setCostField] = useState('');

	useEffect(() => {
		if (initialConfig) {
			setJiraProjectKey((initialConfig.projectKey as string) ?? '');
			setBaseUrl((initialConfig.baseUrl as string) ?? '');
			setStatuses(toKVPairs(initialConfig.statuses as Record<string, string>));
			setIssueTypes(toKVPairs(initialConfig.issueTypes as Record<string, string>));
			const cf = initialConfig.customFields as Record<string, string> | undefined;
			setCostField(cf?.cost ?? '');
		}
	}, [initialConfig]);

	const upsertMutation = useMutation({
		mutationFn: () =>
			trpcClient.projects.integrations.upsert.mutate({
				projectId,
				type: 'jira',
				config: {
					projectKey: jiraProjectKey,
					baseUrl,
					statuses: fromKVPairs(statuses),
					...(issueTypes.length > 0 ? { issueTypes: fromKVPairs(issueTypes) } : {}),
					...(costField ? { customFields: { cost: costField } } : {}),
				},
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.projects.integrations.list.queryOptions({ projectId }).queryKey,
			});
		},
	});

	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<Label htmlFor="jiraProjectKey">Project Key</Label>
				<Input
					id="jiraProjectKey"
					value={jiraProjectKey}
					onChange={(e) => setJiraProjectKey(e.target.value)}
					placeholder="e.g., PROJ"
				/>
			</div>

			<div className="space-y-2">
				<Label htmlFor="jiraBaseUrl">Base URL</Label>
				<Input
					id="jiraBaseUrl"
					value={baseUrl}
					onChange={(e) => setBaseUrl(e.target.value)}
					placeholder="https://your-instance.atlassian.net"
				/>
			</div>

			<KeyValueEditor label="Status Mappings" pairs={statuses} onChange={setStatuses} />
			<p className="text-xs text-muted-foreground -mt-1">
				Map CASCADE statuses (briefing, planning, todo, inProgress, inReview, done, merged) to JIRA
				status names.
			</p>

			<KeyValueEditor label="Issue Types (optional)" pairs={issueTypes} onChange={setIssueTypes} />

			<div className="space-y-2">
				<Label htmlFor="jiraCostField">Custom Field: Cost</Label>
				<Input
					id="jiraCostField"
					value={costField}
					onChange={(e) => setCostField(e.target.value)}
					placeholder="e.g., customfield_10042"
				/>
			</div>

			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={() => upsertMutation.mutate()}
					disabled={upsertMutation.isPending}
					className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
				>
					{upsertMutation.isPending ? 'Saving...' : 'Save Integration'}
				</button>
				{upsertMutation.isSuccess && <span className="text-sm text-muted-foreground">Saved</span>}
				{upsertMutation.isError && (
					<span className="text-sm text-destructive">{upsertMutation.error.message}</span>
				)}
			</div>
		</div>
	);
}

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
	verifiedLogin: string | null;
	onVerify: () => void;
	isVerifying: boolean;
	verifyError: string | null;
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
							{c.name} ({c.envVarKey}) — {c.value}
						</option>
					))}
				</select>
				<button
					type="button"
					onClick={onVerify}
					disabled={!selectedId || isVerifying}
					className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
				>
					{isVerifying ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify'}
				</button>
			</div>
			{verifiedLogin && (
				<div className="flex items-center gap-1.5 text-sm text-green-600">
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

function GitHubForm({
	projectId,
	initialConfig,
}: {
	projectId: string;
	initialConfig?: Record<string, unknown>;
}) {
	const queryClient = useQueryClient();

	const credentialsQuery = useQuery(trpc.credentials.list.queryOptions());
	const credentials = (credentialsQuery.data ?? []) as CredentialOption[];

	const [implementerCredId, setImplementerCredId] = useState<number | null>(null);
	const [reviewerCredId, setReviewerCredId] = useState<number | null>(null);

	const [implementerLogin, setImplementerLogin] = useState<string | null>(null);
	const [reviewerLogin, setReviewerLogin] = useState<string | null>(null);

	const [implementerError, setImplementerError] = useState<string | null>(null);
	const [reviewerError, setReviewerError] = useState<string | null>(null);

	useEffect(() => {
		if (initialConfig) {
			setImplementerCredId((initialConfig.implementerCredentialId as number) ?? null);
			setReviewerCredId((initialConfig.reviewerCredentialId as number) ?? null);
		}
	}, [initialConfig]);

	const verifyImplementer = useMutation({
		mutationFn: () =>
			trpcClient.credentials.verifyGithubIdentity.mutate({
				credentialId: implementerCredId as number,
			}),
		onSuccess: (data) => {
			setImplementerLogin(data.login);
			setImplementerError(null);
		},
		onError: (err) => {
			setImplementerLogin(null);
			setImplementerError(err.message);
		},
	});

	const verifyReviewer = useMutation({
		mutationFn: () =>
			trpcClient.credentials.verifyGithubIdentity.mutate({
				credentialId: reviewerCredId as number,
			}),
		onSuccess: (data) => {
			setReviewerLogin(data.login);
			setReviewerError(null);
		},
		onError: (err) => {
			setReviewerLogin(null);
			setReviewerError(err.message);
		},
	});

	const saveMutation = useMutation({
		mutationFn: async () => {
			if (!implementerCredId || !reviewerCredId) {
				throw new Error('Both persona credentials are required');
			}

			// Save as GitHub integration
			await trpcClient.projects.integrations.upsert.mutate({
				projectId,
				type: 'github',
				config: {
					implementerCredentialId: implementerCredId,
					reviewerCredentialId: reviewerCredId,
				},
			});

			// Set project-wide credential overrides for the persona token keys
			await trpcClient.projects.credentialOverrides.set.mutate({
				projectId,
				envVarKey: 'GITHUB_TOKEN_IMPLEMENTER',
				credentialId: implementerCredId,
			});

			await trpcClient.projects.credentialOverrides.set.mutate({
				projectId,
				envVarKey: 'GITHUB_TOKEN_REVIEWER',
				credentialId: reviewerCredId,
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.projects.integrations.list.queryOptions({ projectId }).queryKey,
			});
			queryClient.invalidateQueries({
				queryKey: trpc.projects.credentialOverrides.list.queryOptions({ projectId }).queryKey,
			});
		},
	});

	return (
		<div className="space-y-6">
			<p className="text-sm text-muted-foreground">
				CASCADE uses two separate GitHub bot accounts to prevent feedback loops. The{' '}
				<strong>implementer</strong> writes code and creates PRs. The <strong>reviewer</strong>{' '}
				reviews PRs and can approve or request changes.
			</p>

			<CredentialSelector
				label="Implementer Token"
				description="GitHub PAT for the bot that writes code, creates PRs, and responds to review comments."
				credentials={credentials}
				selectedId={implementerCredId}
				onChange={(id) => {
					setImplementerCredId(id);
					setImplementerLogin(null);
					setImplementerError(null);
				}}
				verifiedLogin={implementerLogin}
				onVerify={() => verifyImplementer.mutate()}
				isVerifying={verifyImplementer.isPending}
				verifyError={implementerError}
			/>

			<CredentialSelector
				label="Reviewer Token"
				description="GitHub PAT for the bot that reviews PRs. Must be a different account from the implementer."
				credentials={credentials}
				selectedId={reviewerCredId}
				onChange={(id) => {
					setReviewerCredId(id);
					setReviewerLogin(null);
					setReviewerError(null);
				}}
				verifiedLogin={reviewerLogin}
				onVerify={() => verifyReviewer.mutate()}
				isVerifying={verifyReviewer.isPending}
				verifyError={reviewerError}
			/>

			{implementerLogin && reviewerLogin && implementerLogin === reviewerLogin && (
				<p className="text-sm text-destructive">
					Both tokens resolve to the same GitHub user ({implementerLogin}). They must be different
					accounts for loop prevention to work.
				</p>
			)}

			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={() => saveMutation.mutate()}
					disabled={saveMutation.isPending || !implementerCredId || !reviewerCredId}
					className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
				>
					{saveMutation.isPending ? 'Saving...' : 'Save Integration'}
				</button>
				{saveMutation.isSuccess && <span className="text-sm text-muted-foreground">Saved</span>}
				{saveMutation.isError && (
					<span className="text-sm text-destructive">{saveMutation.error.message}</span>
				)}
			</div>
		</div>
	);
}

export function IntegrationForm({ projectId }: { projectId: string }) {
	const integrationsQuery = useQuery(trpc.projects.integrations.list.queryOptions({ projectId }));

	// Determine active integration type from existing data
	const trelloConfig = integrationsQuery.data?.find((i) => i.type === 'trello');
	const jiraConfig = integrationsQuery.data?.find((i) => i.type === 'jira');
	const githubConfig = integrationsQuery.data?.find((i) => i.type === 'github');

	const defaultTab: IntegrationType = jiraConfig && !trelloConfig ? 'jira' : 'trello';
	const [activeTab, setActiveTab] = useState<IntegrationType>(defaultTab);

	// Sync default tab when data loads
	useEffect(() => {
		if (jiraConfig && !trelloConfig) {
			setActiveTab('jira');
		}
	}, [jiraConfig, trelloConfig]);

	if (integrationsQuery.isLoading) {
		return <div className="py-4 text-muted-foreground">Loading integrations...</div>;
	}

	return (
		<div className="max-w-2xl space-y-6">
			<div className="flex gap-1 rounded-lg bg-muted p-1">
				<button
					type="button"
					onClick={() => setActiveTab('trello')}
					className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
						activeTab === 'trello'
							? 'bg-background text-foreground shadow-sm'
							: 'text-muted-foreground hover:text-foreground'
					}`}
				>
					Trello
				</button>
				<button
					type="button"
					onClick={() => setActiveTab('jira')}
					className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
						activeTab === 'jira'
							? 'bg-background text-foreground shadow-sm'
							: 'text-muted-foreground hover:text-foreground'
					}`}
				>
					JIRA
				</button>
				<button
					type="button"
					onClick={() => setActiveTab('github')}
					className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
						activeTab === 'github'
							? 'bg-background text-foreground shadow-sm'
							: 'text-muted-foreground hover:text-foreground'
					}`}
				>
					GitHub
				</button>
			</div>

			{activeTab === 'trello' && (
				<TrelloForm
					projectId={projectId}
					initialConfig={trelloConfig?.config as Record<string, unknown>}
				/>
			)}

			{activeTab === 'jira' && (
				<JiraForm
					projectId={projectId}
					initialConfig={jiraConfig?.config as Record<string, unknown>}
				/>
			)}

			{activeTab === 'github' && (
				<GitHubForm
					projectId={projectId}
					initialConfig={githubConfig?.config as Record<string, unknown>}
				/>
			)}
		</div>
	);
}
