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

export function IntegrationForm({ projectId }: { projectId: string }) {
	const queryClient = useQueryClient();
	const integrationsQuery = useQuery(trpc.projects.integrations.list.queryOptions({ projectId }));

	const [boardId, setBoardId] = useState('');
	const [lists, setLists] = useState<KVPair[]>([]);
	const [labels, setLabels] = useState<KVPair[]>([]);
	const [costField, setCostField] = useState('');

	useEffect(() => {
		if (integrationsQuery.data) {
			const trello = integrationsQuery.data.find((i) => i.type === 'trello');
			if (trello) {
				const config = trello.config as Record<string, unknown>;
				setBoardId((config.boardId as string) ?? '');
				setLists(toKVPairs(config.lists as Record<string, string>));
				setLabels(toKVPairs(config.labels as Record<string, string>));
				const cf = config.customFields as Record<string, string> | undefined;
				setCostField(cf?.cost ?? '');
			}
		}
	}, [integrationsQuery.data]);

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

	if (integrationsQuery.isLoading) {
		return <div className="py-4 text-muted-foreground">Loading integrations...</div>;
	}

	return (
		<div className="max-w-2xl space-y-6">
			<h3 className="text-base font-semibold">Trello Integration</h3>

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
