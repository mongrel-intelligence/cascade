import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import type { inferRouterOutputs } from '@trpc/server';
import { ArrowLeft, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { AppRouter } from '@/../../src/api/router.js';
import { AgentDefinitionEditor } from '@/components/settings/agent-definition-editor.js';
import type { DefinitionRow } from '@/components/settings/agent-definition-table.js';
import { AgentDefinitionsTable } from '@/components/settings/agent-definition-table.js';
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
import { rootRoute } from '../__root.js';
import { AGENT_DEFINITIONS_TABS, type AgentDefinitionsTab } from './definitions-tabs.js';
import { getStatusDispatchAgentTypes } from './definitions-utils.js';

type Tab = AgentDefinitionsTab;
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
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Agent Definitions</h1>
					<p className="text-sm text-muted-foreground">
						View and edit agent definitions, system prompts, reusable partials, and workflow
						statuses.
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
			<div className="flex gap-2 overflow-x-auto border-b border-border">
				{AGENT_DEFINITIONS_TABS.map((t) => (
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
						{t === 'definitions'
							? 'Definitions'
							: t === 'partials'
								? 'Partials'
								: 'Workflow Statuses'}
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

			{tab === 'workflow-statuses' && <WorkflowStatusesTab />}
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
		<div className="overflow-x-auto rounded-lg border border-border">
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

// ─────────────────────────────────────────────────────────────────────────────
// Workflow statuses tab
// ─────────────────────────────────────────────────────────────────────────────

type RouterOutput = inferRouterOutputs<AppRouter>;
type WorkflowStatusRow = RouterOutput['workflowStatuses']['list'][number];

function WorkflowStatusesTab() {
	const queryClient = useQueryClient();
	const statusesQuery = useQuery(trpc.workflowStatuses.list.queryOptions());
	const agentDefinitionsQuery = useQuery(trpc.agentDefinitions.list.queryOptions());
	const queryKey = trpc.workflowStatuses.list.queryOptions().queryKey;

	const [draft, setDraft] = useState({
		key: '',
		label: '',
		agentType: '',
		sortOrder: 1000,
	});
	const [editingKey, setEditingKey] = useState<string | null>(null);
	const [editDraft, setEditDraft] = useState({
		label: '',
		agentType: '',
		sortOrder: 1000,
	});

	const createMutation = useMutation({
		mutationFn: () =>
			trpcClient.workflowStatuses.create.mutate({
				key: draft.key,
				label: draft.label,
				agentType: draft.agentType || null,
				sortOrder: draft.sortOrder,
			}),
		onSuccess: () => {
			setDraft({ key: '', label: '', agentType: '', sortOrder: 1000 });
			queryClient.invalidateQueries({ queryKey });
		},
	});

	const updateMutation = useMutation({
		mutationFn: (key: string) =>
			trpcClient.workflowStatuses.update.mutate({
				key,
				label: editDraft.label,
				agentType: editDraft.agentType || null,
				sortOrder: editDraft.sortOrder,
			}),
		onSuccess: () => {
			setEditingKey(null);
			queryClient.invalidateQueries({ queryKey });
		},
	});

	const deleteMutation = useMutation({
		mutationFn: (key: string) => trpcClient.workflowStatuses.delete.mutate({ key }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey });
		},
	});

	const agentTypes = getStatusDispatchAgentTypes(agentDefinitionsQuery.data ?? []);
	const statuses = statusesQuery.data ?? [];

	function beginEdit(row: WorkflowStatusRow) {
		setEditingKey(row.key);
		setEditDraft({
			label: row.label,
			agentType: row.agentType ?? '',
			sortOrder: row.sortOrder,
		});
	}

	return (
		<div className="space-y-4">
			<div className="overflow-x-auto rounded-lg border border-border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Key</TableHead>
							<TableHead>Label</TableHead>
							<TableHead>Agent</TableHead>
							<TableHead className="w-28">Order</TableHead>
							<TableHead>Type</TableHead>
							<TableHead className="w-28" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{statusesQuery.isLoading && (
							<TableRow>
								<TableCell colSpan={6} className="text-center text-muted-foreground py-8">
									Loading workflow statuses...
								</TableCell>
							</TableRow>
						)}
						{statuses.map((row) => {
							const isEditing = editingKey === row.key;
							return (
								<TableRow key={row.key}>
									<TableCell className="font-mono text-sm">{row.key}</TableCell>
									<TableCell>
										{isEditing ? (
											<input
												value={editDraft.label}
												onChange={(e) =>
													setEditDraft((prev) => ({ ...prev, label: e.target.value }))
												}
												className="h-8 w-full rounded-md border border-input bg-background px-2"
											/>
										) : (
											row.label
										)}
									</TableCell>
									<TableCell>
										{isEditing ? (
											<select
												value={editDraft.agentType}
												onChange={(e) =>
													setEditDraft((prev) => ({ ...prev, agentType: e.target.value }))
												}
												className="h-8 w-full rounded-md border border-input bg-background px-2"
											>
												<option value="">No dispatch</option>
												{agentTypes.map((agentType) => (
													<option key={agentType} value={agentType}>
														{agentType}
													</option>
												))}
											</select>
										) : (
											<span className="font-mono text-sm">{row.agentType ?? 'none'}</span>
										)}
									</TableCell>
									<TableCell>
										{isEditing ? (
											<input
												type="number"
												value={editDraft.sortOrder}
												onChange={(e) =>
													setEditDraft((prev) => ({
														...prev,
														sortOrder: Number(e.target.value),
													}))
												}
												className="h-8 w-full rounded-md border border-input bg-background px-2"
											/>
										) : (
											row.sortOrder
										)}
									</TableCell>
									<TableCell>
										{row.isBuiltin ? (
											<Badge>Built-in</Badge>
										) : (
											<Badge variant="outline">Custom</Badge>
										)}
									</TableCell>
									<TableCell>
										{!row.isBuiltin && (
											<div className="flex gap-1">
												{isEditing ? (
													<>
														<button
															type="button"
															onClick={() => updateMutation.mutate(row.key)}
															className="p-1 text-muted-foreground hover:text-foreground"
															title="Save workflow status"
														>
															<Save className="h-4 w-4" />
														</button>
														<button
															type="button"
															onClick={() => setEditingKey(null)}
															className="p-1 text-muted-foreground hover:text-foreground"
															title="Cancel"
														>
															<X className="h-4 w-4" />
														</button>
													</>
												) : (
													<>
														<button
															type="button"
															onClick={() => beginEdit(row)}
															className="p-1 text-muted-foreground hover:text-foreground"
															title="Edit workflow status"
														>
															<Pencil className="h-4 w-4" />
														</button>
														<button
															type="button"
															onClick={() => {
																if (confirm(`Delete workflow status "${row.key}"?`)) {
																	deleteMutation.mutate(row.key);
																}
															}}
															className="p-1 text-muted-foreground hover:text-destructive"
															title="Delete workflow status"
														>
															<Trash2 className="h-4 w-4" />
														</button>
													</>
												)}
											</div>
										)}
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			</div>

			<div className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[1fr_1fr_1fr_8rem_auto]">
				<input
					value={draft.key}
					onChange={(e) => setDraft((prev) => ({ ...prev, key: e.target.value }))}
					placeholder="status-key"
					className="h-9 rounded-md border border-input bg-background px-3"
				/>
				<input
					value={draft.label}
					onChange={(e) => setDraft((prev) => ({ ...prev, label: e.target.value }))}
					placeholder="Status label"
					className="h-9 rounded-md border border-input bg-background px-3"
				/>
				<select
					value={draft.agentType}
					onChange={(e) => setDraft((prev) => ({ ...prev, agentType: e.target.value }))}
					className="h-9 rounded-md border border-input bg-background px-3"
				>
					<option value="">No dispatch</option>
					{agentTypes.map((agentType) => (
						<option key={agentType} value={agentType}>
							{agentType}
						</option>
					))}
				</select>
				<input
					type="number"
					value={draft.sortOrder}
					onChange={(e) => setDraft((prev) => ({ ...prev, sortOrder: Number(e.target.value) }))}
					className="h-9 rounded-md border border-input bg-background px-3"
				/>
				<button
					type="button"
					onClick={() => createMutation.mutate()}
					className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
				>
					<Plus className="h-4 w-4" />
					Add
				</button>
			</div>
		</div>
	);
}

export const globalDefinitionsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/global/definitions',
	component: AgentDefinitionsPage,
});
