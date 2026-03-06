import { AgentDefinitionEditor } from '@/components/settings/agent-definition-editor.js';
import { AgentDefinitionsTable } from '@/components/settings/agent-definition-table.js';
import type { DefinitionRow } from '@/components/settings/agent-definition-table.js';
import { PromptEditor } from '@/components/settings/prompt-editor.js';
import { Badge } from '@/components/ui/badge.js';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { rootRoute } from '../__root.js';

type Tab = 'definitions' | 'partials';
type EditTarget =
	| { type: 'definition'; existing?: DefinitionRow }
	| { type: 'partial'; name: string };

function AgentDefinitionsPage() {
	const [tab, setTab] = useState<Tab>('definitions');
	const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

	const definitionsQuery = useQuery(trpc.agentDefinitions.list.queryOptions());

	// When editing a definition or partial, show the editor full-width
	if (editTarget) {
		if (editTarget.type === 'definition') {
			return (
				<div className="space-y-4">
					<button
						type="button"
						onClick={() => setEditTarget(null)}
						className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
					>
						<ArrowLeft className="h-4 w-4" /> Back
					</button>
					<AgentDefinitionEditor
						existing={editTarget.existing}
						onClose={() => setEditTarget(null)}
					/>
				</div>
			);
		}

		// type === 'partial'
		return (
			<div className="space-y-4">
				<button
					type="button"
					onClick={() => setEditTarget(null)}
					className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
				>
					<ArrowLeft className="h-4 w-4" /> Back
				</button>
				<PromptEditor target={{ name: editTarget.name }} onClose={() => setEditTarget(null)} />
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Agent Definitions</h1>
					<p className="text-sm text-muted-foreground">
						View and edit agent definitions, system prompts, and reusable partials.
					</p>
				</div>
				{tab === 'definitions' && (
					<button
						type="button"
						onClick={() => setEditTarget({ type: 'definition' })}
						className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
					>
						New Definition
					</button>
				)}
			</div>

			{/* Tab bar */}
			<div className="flex gap-2 border-b border-border">
				{(['definitions', 'partials'] as Tab[]).map((t) => (
					<button
						key={t}
						type="button"
						onClick={() => setTab(t)}
						className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${
							tab === t
								? 'border-primary text-foreground'
								: 'border-transparent text-muted-foreground hover:text-foreground'
						}`}
					>
						{t === 'definitions' ? 'Definitions' : 'Partials'}
					</button>
				))}
			</div>

			{tab === 'definitions' && (
				<>
					{definitionsQuery.isLoading && (
						<div className="py-8 text-center text-muted-foreground">
							Loading agent definitions...
						</div>
					)}

					{definitionsQuery.isError && (
						<div className="py-8 text-center text-destructive">
							Failed to load agent definitions: {definitionsQuery.error.message}
						</div>
					)}

					{definitionsQuery.data && (
						<AgentDefinitionsTable
							definitions={definitionsQuery.data}
							onEdit={(def) => setEditTarget({ type: 'definition', existing: def })}
						/>
					)}
				</>
			)}

			{tab === 'partials' && (
				<PartialsTab onEdit={(name) => setEditTarget({ type: 'partial', name })} />
			)}
		</div>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Partials tab
// ─────────────────────────────────────────────────────────────────────────────

function PartialsTab({ onEdit }: { onEdit: (name: string) => void }) {
	const queryClient = useQueryClient();
	const partialsQuery = useQuery(trpc.prompts.listPartials.queryOptions());

	const deleteMutation = useMutation({
		mutationFn: (id: number) => trpcClient.prompts.deletePartial.mutate({ id }),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.prompts.listPartials.queryOptions().queryKey,
			});
		},
	});

	if (partialsQuery.isLoading) {
		return <div className="py-4 text-muted-foreground">Loading...</div>;
	}

	const partials = partialsQuery.data ?? [];

	return (
		<div className="overflow-hidden rounded-lg border border-border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Name</TableHead>
						<TableHead>Source</TableHead>
						<TableHead>Lines</TableHead>
						<TableHead className="w-20" />
					</TableRow>
				</TableHeader>
				<TableBody>
					{partials.length === 0 && (
						<TableRow>
							<TableCell colSpan={4} className="text-center text-muted-foreground py-8">
								No partials found
							</TableCell>
						</TableRow>
					)}
					{partials.map((p) => (
						<TableRow key={p.name}>
							<TableCell className="font-medium">{p.name}</TableCell>
							<TableCell>
								{p.source === 'db' ? <Badge>custom</Badge> : <Badge variant="outline">disk</Badge>}
							</TableCell>
							<TableCell>{p.lines}</TableCell>
							<TableCell>
								<div className="flex gap-1">
									<button
										type="button"
										onClick={() => onEdit(p.name)}
										className="p-1 text-muted-foreground hover:text-foreground"
									>
										<Pencil className="h-4 w-4" />
									</button>
									{p.source === 'db' && p.id != null && (
										<button
											type="button"
											onClick={() => deleteMutation.mutate(p.id as number)}
											className="p-1 text-muted-foreground hover:text-destructive"
										>
											<Trash2 className="h-4 w-4" />
										</button>
									)}
								</div>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

export const settingsDefinitionsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/settings/definitions',
	component: AgentDefinitionsPage,
});
