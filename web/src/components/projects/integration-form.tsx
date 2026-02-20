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

interface TriggerToggleItem {
	key: string;
	label: string;
	description: string;
	defaultValue: boolean;
}

function TriggerToggles({
	title,
	items,
	values,
	onChange,
}: {
	title: string;
	items: TriggerToggleItem[];
	values: Record<string, boolean>;
	onChange: (values: Record<string, boolean>) => void;
}) {
	return (
		<div className="space-y-3">
			<Label className="text-sm font-medium">{title}</Label>
			{items.map((item) => {
				const value = item.key in values ? values[item.key] : item.defaultValue;
				return (
					<div key={item.key} className="flex items-start gap-3">
						<input
							type="checkbox"
							id={`trigger-${item.key}`}
							checked={value}
							onChange={(e) => onChange({ ...values, [item.key]: e.target.checked })}
							className="mt-0.5 h-4 w-4 rounded border-input"
						/>
						<div>
							<label htmlFor={`trigger-${item.key}`} className="text-sm font-medium cursor-pointer">
								{item.label}
							</label>
							<p className="text-xs text-muted-foreground">{item.description}</p>
						</div>
					</div>
				);
			})}
		</div>
	);
}

type IntegrationCategory = 'pm' | 'scm';

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
							{c.name} ({c.envVarKey}) — {c.value}
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

// ============================================================================
// Provider-specific credential role definitions
// ============================================================================

interface CredentialRoleDef {
	role: string;
	label: string;
	description: string;
	hasVerify?: boolean;
}

const PM_CREDENTIAL_ROLES: Record<string, CredentialRoleDef[]> = {
	trello: [
		{ role: 'api_key', label: 'API Key', description: 'Trello API Key for authentication.' },
		{ role: 'token', label: 'Token', description: 'Trello token for authorization.' },
	],
	jira: [
		{ role: 'email', label: 'Email', description: 'JIRA account email for authentication.' },
		{ role: 'api_token', label: 'API Token', description: 'JIRA API token for authorization.' },
	],
};

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
// PM Tab (Trello / JIRA)
// ============================================================================

const TRELLO_TRIGGERS: TriggerToggleItem[] = [
	{
		key: 'cardMovedToBriefing',
		label: 'Card moved to Briefing',
		description: 'Trigger briefing agent when card is moved to the briefing list.',
		defaultValue: true,
	},
	{
		key: 'cardMovedToPlanning',
		label: 'Card moved to Planning',
		description: 'Trigger planning agent when card is moved to the planning list.',
		defaultValue: true,
	},
	{
		key: 'cardMovedToTodo',
		label: 'Card moved to Todo',
		description: 'Trigger implementation agent when card is moved to the todo list.',
		defaultValue: true,
	},
	{
		key: 'readyToProcessLabel',
		label: 'Ready to Process label',
		description: 'Trigger agent when the "Ready to Process" label is added.',
		defaultValue: true,
	},
	{
		key: 'commentMention',
		label: 'Comment @mention',
		description: 'Trigger respond-to-planning-comment when the bot is @mentioned in a comment.',
		defaultValue: true,
	},
];

const JIRA_TRIGGERS: TriggerToggleItem[] = [
	{
		key: 'issueTransitioned',
		label: 'Issue transitioned',
		description: 'Trigger agent when an issue transitions to a configured status.',
		defaultValue: true,
	},
	{
		key: 'readyToProcessLabel',
		label: 'Ready to Process label',
		description: 'Trigger agent when the ready-to-process label is added.',
		defaultValue: true,
	},
	{
		key: 'commentMention',
		label: 'Comment @mention',
		description: 'Trigger respond-to-planning-comment when the bot is @mentioned in a comment.',
		defaultValue: true,
	},
];

function PMTab({
	projectId,
	initialProvider,
	initialConfig,
	initialTriggers,
	initialCredentials,
}: {
	projectId: string;
	initialProvider: string;
	initialConfig?: Record<string, unknown>;
	initialTriggers?: Record<string, boolean>;
	initialCredentials: Map<string, number>;
}) {
	const queryClient = useQueryClient();

	const credentialsQuery = useQuery(trpc.credentials.list.queryOptions());
	const orgCredentials = (credentialsQuery.data ?? []) as CredentialOption[];

	const [provider, setProvider] = useState(initialProvider || 'trello');
	const [triggers, setTriggers] = useState<Record<string, boolean>>(initialTriggers ?? {});
	const [credentialMap, setCredentialMap] = useState<Map<string, number>>(initialCredentials);

	// Trello fields
	const [boardId, setBoardId] = useState('');
	const [lists, setLists] = useState<KVPair[]>([]);
	const [labels, setLabels] = useState<KVPair[]>([]);
	const [costField, setCostField] = useState('');

	// Jira fields
	const [jiraProjectKey, setJiraProjectKey] = useState('');
	const [baseUrl, setBaseUrl] = useState('');
	const [statuses, setStatuses] = useState<KVPair[]>([]);
	const [issueTypes, setIssueTypes] = useState<KVPair[]>([]);
	const [jiraLabels, setJiraLabels] = useState<KVPair[]>([
		{ key: 'processing', value: 'cascade-processing' },
		{ key: 'processed', value: 'cascade-processed' },
		{ key: 'error', value: 'cascade-error' },
		{ key: 'readyToProcess', value: 'cascade-ready' },
	]);
	const [jiraCostField, setJiraCostField] = useState('');

	useEffect(() => {
		if (initialConfig && initialProvider === 'trello') {
			setBoardId((initialConfig.boardId as string) ?? '');
			setLists(toKVPairs(initialConfig.lists as Record<string, string>));
			setLabels(toKVPairs(initialConfig.labels as Record<string, string>));
			const cf = initialConfig.customFields as Record<string, string> | undefined;
			setCostField(cf?.cost ?? '');
		} else if (initialConfig && initialProvider === 'jira') {
			setJiraProjectKey((initialConfig.projectKey as string) ?? '');
			setBaseUrl((initialConfig.baseUrl as string) ?? '');
			setStatuses(toKVPairs(initialConfig.statuses as Record<string, string>));
			setIssueTypes(toKVPairs(initialConfig.issueTypes as Record<string, string>));
			const jl = initialConfig.labels as Record<string, string> | undefined;
			if (jl) setJiraLabels(toKVPairs(jl));
			const cf = initialConfig.customFields as Record<string, string> | undefined;
			setJiraCostField(cf?.cost ?? '');
		}
	}, [initialConfig, initialProvider]);

	useEffect(() => {
		setTriggers(initialTriggers ?? {});
	}, [initialTriggers]);

	useEffect(() => {
		setCredentialMap(initialCredentials);
	}, [initialCredentials]);

	const saveMutation = useMutation({
		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: handles multiple provider types + credential linking
		mutationFn: async () => {
			let config: Record<string, unknown>;
			if (provider === 'trello') {
				config = {
					boardId,
					lists: fromKVPairs(lists),
					labels: fromKVPairs(labels),
					...(costField ? { customFields: { cost: costField } } : {}),
				};
			} else {
				config = {
					projectKey: jiraProjectKey,
					baseUrl,
					statuses: fromKVPairs(statuses),
					...(issueTypes.length > 0 ? { issueTypes: fromKVPairs(issueTypes) } : {}),
					...(jiraLabels.length > 0 ? { labels: fromKVPairs(jiraLabels) } : {}),
					...(jiraCostField ? { customFields: { cost: jiraCostField } } : {}),
				};
			}

			const result = await trpcClient.projects.integrations.upsert.mutate({
				projectId,
				category: 'pm',
				provider,
				config,
				triggers,
			});

			// Set integration credentials
			for (const [role, credentialId] of credentialMap) {
				await trpcClient.projects.integrationCredentials.set.mutate({
					projectId,
					category: 'pm',
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
					category: 'pm',
				}).queryKey,
			});
		},
	});

	const credentialRoles = PM_CREDENTIAL_ROLES[provider] ?? [];

	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<Label>Provider</Label>
				<select
					value={provider}
					onChange={(e) => {
						setProvider(e.target.value);
						setTriggers({});
						setCredentialMap(new Map());
					}}
					className="flex h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm"
				>
					<option value="trello">Trello</option>
					<option value="jira">JIRA</option>
				</select>
			</div>

			{provider === 'trello' && (
				<>
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
					<TriggerToggles
						title="Trigger Configuration"
						items={TRELLO_TRIGGERS}
						values={triggers}
						onChange={setTriggers}
					/>
				</>
			)}

			{provider === 'jira' && (
				<>
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
						Map CASCADE statuses (briefing, planning, todo, inProgress, inReview, done, merged) to
						JIRA status names.
					</p>
					<KeyValueEditor
						label="Issue Types (optional)"
						pairs={issueTypes}
						onChange={setIssueTypes}
					/>
					<KeyValueEditor label="Labels" pairs={jiraLabels} onChange={setJiraLabels} />
					<p className="text-xs text-muted-foreground -mt-1">
						JIRA label names used by CASCADE. Keys: processing, processed, error, readyToProcess.
					</p>
					<div className="space-y-2">
						<Label htmlFor="jiraCostField">Custom Field: Cost</Label>
						<Input
							id="jiraCostField"
							value={jiraCostField}
							onChange={(e) => setJiraCostField(e.target.value)}
							placeholder="e.g., customfield_10042"
						/>
					</div>
					<TriggerToggles
						title="Trigger Configuration"
						items={JIRA_TRIGGERS}
						values={triggers}
						onChange={setTriggers}
					/>
				</>
			)}

			<IntegrationCredentialSlots
				projectId={projectId}
				category="pm"
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
		</div>
	);
}

// ============================================================================
// SCM Tab (GitHub)
// ============================================================================

const GITHUB_TRIGGERS: TriggerToggleItem[] = [
	{
		key: 'checkSuiteSuccess',
		label: 'Check Suite Success',
		description: 'Trigger review agent when all CI checks pass.',
		defaultValue: true,
	},
	{
		key: 'checkSuiteFailure',
		label: 'Check Suite Failure',
		description: 'Trigger respond-to-ci agent when CI checks fail.',
		defaultValue: true,
	},
	{
		key: 'prReviewSubmitted',
		label: 'PR Review Submitted',
		description: 'Trigger respond-to-review when a review with changes requested is submitted.',
		defaultValue: true,
	},
	{
		key: 'prCommentMention',
		label: 'PR Comment @mention',
		description:
			'Trigger respond-to-pr-comment when the implementer bot is @mentioned in a comment.',
		defaultValue: true,
	},
	{
		key: 'prReadyToMerge',
		label: 'PR Ready to Merge',
		description: 'Auto-move card to DONE when PR is approved and checks pass.',
		defaultValue: true,
	},
	{
		key: 'prMerged',
		label: 'PR Merged',
		description: 'Auto-move card to MERGED when PR is merged.',
		defaultValue: true,
	},
	{
		key: 'reviewRequested',
		label: 'Review Requested (opt-in)',
		description:
			'Trigger review agent when review is requested from a CASCADE persona. Default disabled.',
		defaultValue: false,
	},
	{
		key: 'prOpened',
		label: 'PR Opened (opt-in)',
		description: 'Trigger respond-to-review when a new PR is opened. Default disabled.',
		defaultValue: false,
	},
];

function SCMTab({
	projectId,
	initialProvider,
	initialTriggers,
	initialCredentials,
}: {
	projectId: string;
	initialProvider: string;
	initialTriggers?: Record<string, boolean>;
	initialCredentials: Map<string, number>;
}) {
	const queryClient = useQueryClient();

	const credentialsQuery = useQuery(trpc.credentials.list.queryOptions());
	const orgCredentials = (credentialsQuery.data ?? []) as CredentialOption[];

	const [provider] = useState(initialProvider || 'github');
	const [triggers, setTriggers] = useState<Record<string, boolean>>(initialTriggers ?? {});
	const [credentialMap, setCredentialMap] = useState<Map<string, number>>(initialCredentials);

	useEffect(() => {
		setTriggers(initialTriggers ?? {});
	}, [initialTriggers]);

	useEffect(() => {
		setCredentialMap(initialCredentials);
	}, [initialCredentials]);

	const saveMutation = useMutation({
		mutationFn: async () => {
			const result = await trpcClient.projects.integrations.upsert.mutate({
				projectId,
				category: 'scm',
				provider,
				config: {},
				triggers,
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

			<TriggerToggles
				title="Trigger Configuration"
				items={GITHUB_TRIGGERS}
				values={triggers}
				onChange={setTriggers}
			/>

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
		</div>
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

	const integrations = integrationsQuery.data ?? [];
	const pmIntegration = integrations.find(
		(i) => (i as Record<string, unknown>).category === 'pm',
	) as Record<string, unknown> | undefined;
	const scmIntegration = integrations.find(
		(i) => (i as Record<string, unknown>).category === 'scm',
	) as Record<string, unknown> | undefined;

	const pmProvider = (pmIntegration?.provider as string) ?? 'trello';
	const scmProvider = (scmIntegration?.provider as string) ?? 'github';

	const pmCredMap = new Map<string, number>();
	for (const c of (pmCredsQuery.data ?? []) as Array<{ role: string; credentialId: number }>) {
		pmCredMap.set(c.role, c.credentialId);
	}

	const scmCredMap = new Map<string, number>();
	for (const c of (scmCredsQuery.data ?? []) as Array<{ role: string; credentialId: number }>) {
		scmCredMap.set(c.role, c.credentialId);
	}

	const [activeTab, setActiveTab] = useState<IntegrationCategory>('pm');

	if (integrationsQuery.isLoading) {
		return <div className="py-4 text-muted-foreground">Loading integrations...</div>;
	}

	return (
		<div className="max-w-2xl space-y-6">
			<div className="flex gap-1 rounded-lg bg-muted p-1">
				<button
					type="button"
					onClick={() => setActiveTab('pm')}
					className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
						activeTab === 'pm'
							? 'bg-background text-foreground shadow-sm'
							: 'text-muted-foreground hover:text-foreground'
					}`}
				>
					Project Management
				</button>
				<button
					type="button"
					onClick={() => setActiveTab('scm')}
					className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
						activeTab === 'scm'
							? 'bg-background text-foreground shadow-sm'
							: 'text-muted-foreground hover:text-foreground'
					}`}
				>
					Source Control
				</button>
			</div>

			{activeTab === 'pm' && (
				<PMTab
					projectId={projectId}
					initialProvider={pmProvider}
					initialConfig={pmIntegration?.config as Record<string, unknown>}
					initialTriggers={pmIntegration?.triggers as Record<string, boolean>}
					initialCredentials={pmCredMap}
				/>
			)}

			{activeTab === 'scm' && (
				<SCMTab
					projectId={projectId}
					initialProvider={scmProvider}
					initialTriggers={scmIntegration?.triggers as Record<string, boolean>}
					initialCredentials={scmCredMap}
				/>
			)}
		</div>
	);
}
