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
// Known key constants for constrained editors
// ============================================================================

interface KeyOption {
	value: string;
	label: string;
}

const TRELLO_LIST_KEYS: KeyOption[] = [
	{ value: 'briefing', label: 'briefing' },
	{ value: 'stories', label: 'stories' },
	{ value: 'planning', label: 'planning' },
	{ value: 'todo', label: 'todo' },
	{ value: 'inProgress', label: 'inProgress' },
	{ value: 'inReview', label: 'inReview' },
	{ value: 'done', label: 'done' },
	{ value: 'merged', label: 'merged' },
	{ value: 'debug', label: 'debug' },
];

const TRELLO_LABEL_KEYS: KeyOption[] = [
	{ value: 'readyToProcess', label: 'readyToProcess' },
	{ value: 'processing', label: 'processing' },
	{ value: 'processed', label: 'processed' },
	{ value: 'error', label: 'error' },
];

const JIRA_STATUS_KEYS: KeyOption[] = [
	{ value: 'briefing', label: 'briefing' },
	{ value: 'planning', label: 'planning' },
	{ value: 'todo', label: 'todo' },
	{ value: 'inProgress', label: 'inProgress' },
	{ value: 'inReview', label: 'inReview' },
	{ value: 'done', label: 'done' },
	{ value: 'merged', label: 'merged' },
];

const JIRA_LABEL_KEYS: KeyOption[] = [
	{ value: 'processing', label: 'processing' },
	{ value: 'processed', label: 'processed' },
	{ value: 'error', label: 'error' },
	{ value: 'readyToProcess', label: 'readyToProcess' },
];

// ============================================================================
// ConstrainedKeyValueEditor — key column is a dropdown of allowed keys
// ============================================================================

function ConstrainedKeyValueEditor({
	label,
	pairs,
	onChange,
	allowedKeys,
	valuePlaceholder,
}: {
	label: string;
	pairs: KVPair[];
	onChange: (pairs: KVPair[]) => void;
	allowedKeys: KeyOption[];
	valuePlaceholder?: string;
}) {
	const usedKeys = new Set(pairs.map((p) => p.key));
	const availableKeys = allowedKeys.filter((k) => !usedKeys.has(k.value));
	const allUsed = availableKeys.length === 0;

	const handleAdd = () => {
		// Pick the first unused allowed key, or empty string if all used
		const firstAvailable = availableKeys[0]?.value ?? '';
		onChange([...pairs, { key: firstAvailable, value: '' }]);
	};

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<Label>{label}</Label>
				<button
					type="button"
					onClick={handleAdd}
					disabled={allUsed}
					className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
				>
					<Plus className="h-3 w-3" /> Add
				</button>
			</div>
			{pairs.map((pair, i) => {
				// Keys available for this row: allowed keys not used by OTHER rows
				const otherUsedKeys = new Set(pairs.filter((_, j) => j !== i).map((p) => p.key));
				// Build options: all allowed keys not used elsewhere + current key if it's custom
				const rowOptions = allowedKeys.filter((k) => !otherUsedKeys.has(k.value));
				const isCustomKey = pair.key !== '' && !allowedKeys.some((k) => k.value === pair.key);

				return (
					<div key={`${pair.key}-${i}`} className="flex gap-2">
						<select
							value={pair.key}
							onChange={(e) => {
								const next = [...pairs];
								next[i] = { ...next[i], key: e.target.value };
								onChange(next);
							}}
							className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
						>
							{isCustomKey && <option value={pair.key}>{pair.key} (custom)</option>}
							{rowOptions.map((k) => (
								<option key={k.value} value={k.value}>
									{k.label}
								</option>
							))}
						</select>
						<Input
							value={pair.value}
							onChange={(e) => {
								const next = [...pairs];
								next[i] = { ...next[i], value: e.target.value };
								onChange(next);
							}}
							placeholder={valuePlaceholder ?? 'Value'}
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
				);
			})}
			{pairs.length === 0 && <p className="text-xs text-muted-foreground">No entries</p>}
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

function PMTab({
	projectId,
	initialProvider,
	initialConfig,
	initialCredentials,
}: {
	projectId: string;
	initialProvider: string;
	initialConfig?: Record<string, unknown>;
	initialCredentials: Map<string, number>;
}) {
	const queryClient = useQueryClient();

	const credentialsQuery = useQuery(trpc.credentials.list.queryOptions());
	const orgCredentials = (credentialsQuery.data ?? []) as CredentialOption[];

	const [provider, setProvider] = useState(initialProvider || 'trello');
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

			// Note: triggers are intentionally omitted — they are managed via the Agent Configs tab
			const result = await trpcClient.projects.integrations.upsert.mutate({
				projectId,
				category: 'pm',
				provider,
				config,
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
					<ConstrainedKeyValueEditor
						label="Lists"
						pairs={lists}
						onChange={setLists}
						allowedKeys={TRELLO_LIST_KEYS}
						valuePlaceholder="Trello List ID"
					/>
					<ConstrainedKeyValueEditor
						label="Labels"
						pairs={labels}
						onChange={setLabels}
						allowedKeys={TRELLO_LABEL_KEYS}
						valuePlaceholder="Trello Label ID"
					/>
					<div className="space-y-2">
						<Label htmlFor="costField">Custom Field: Cost</Label>
						<Input
							id="costField"
							value={costField}
							onChange={(e) => setCostField(e.target.value)}
							placeholder="Custom field ID for cost tracking"
						/>
					</div>
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
					<ConstrainedKeyValueEditor
						label="Status Mappings"
						pairs={statuses}
						onChange={setStatuses}
						allowedKeys={JIRA_STATUS_KEYS}
						valuePlaceholder="JIRA Status Name"
					/>
					<p className="text-xs text-muted-foreground -mt-1">
						Map each CASCADE status key to the corresponding JIRA status name.
					</p>
					<KeyValueEditor
						label="Issue Types (optional)"
						pairs={issueTypes}
						onChange={setIssueTypes}
					/>
					<ConstrainedKeyValueEditor
						label="Labels"
						pairs={jiraLabels}
						onChange={setJiraLabels}
						allowedKeys={JIRA_LABEL_KEYS}
						valuePlaceholder="JIRA Label Name"
					/>
					<p className="text-xs text-muted-foreground -mt-1">
						Map each CASCADE label key to the corresponding JIRA label name.
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
				</>
			)}

			<p className="text-xs text-muted-foreground">
				Trigger configuration has moved to the <strong>Agent Configs</strong> tab.
			</p>

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
		</div>
	);
}
