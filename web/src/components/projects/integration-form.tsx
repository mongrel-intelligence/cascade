import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
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

type IntegrationType = 'trello' | 'jira';

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

export function IntegrationForm({ projectId }: { projectId: string }) {
	const integrationsQuery = useQuery(trpc.projects.integrations.list.queryOptions({ projectId }));

	// Determine active integration type from existing data
	const trelloConfig = integrationsQuery.data?.find((i) => i.type === 'trello');
	const jiraConfig = integrationsQuery.data?.find((i) => i.type === 'jira');

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
		</div>
	);
}
