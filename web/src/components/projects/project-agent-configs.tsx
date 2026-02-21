import { ModelField } from '@/components/settings/model-field.js';
import { TriggerToggles } from '@/components/shared/trigger-toggles.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select.js';
import {
	ALL_AGENT_TYPES,
	LIFECYCLE_TRIGGERS,
	getTriggersForAgent,
} from '@/lib/trigger-agent-mapping.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

interface AgentConfig {
	id: number;
	agentType: string;
	model: string | null;
	maxIterations: number | null;
	agentBackend: string | null;
	prompt: string | null;
}

/** Friendly labels for known agent types */
const AGENT_LABELS: Record<string, string> = {
	briefing: 'Briefing',
	planning: 'Planning',
	implementation: 'Implementation',
	review: 'Review',
	'respond-to-review': 'Respond to Review',
	'respond-to-ci': 'Respond to CI',
	'respond-to-pr-comment': 'Respond to PR Comment',
	'respond-to-planning-comment': 'Respond to Planning Comment',
};

function AgentConfigBadge({ config }: { config: AgentConfig | null }) {
	if (!config) {
		return <span className="text-xs text-muted-foreground">Using defaults</span>;
	}
	const parts: string[] = [];
	if (config.model) parts.push(config.model);
	if (config.maxIterations) parts.push(`${config.maxIterations} iterations`);
	if (config.agentBackend) parts.push(config.agentBackend);
	if (parts.length === 0) return <span className="text-xs text-muted-foreground">Configured</span>;
	return <span className="text-xs text-muted-foreground">{parts.join(' · ')}</span>;
}

/**
 * Extract only the trigger keys relevant to the given trigger definitions
 * from the full triggers record. Handles nested dot-notation keys.
 */
function extractRelevantTriggers(
	triggerDefs: ReturnType<typeof getTriggersForAgent>,
	allTriggers: Record<string, unknown>,
): Record<string, unknown> {
	const relevant: Record<string, unknown> = {};
	for (const t of triggerDefs) {
		const parts = t.key.split('.');
		if (parts.length > 1) {
			const [parent, child] = parts;
			if (!(parent in relevant)) {
				relevant[parent] = {};
			}
			const parentObj =
				typeof allTriggers[parent] === 'object' && allTriggers[parent] !== null
					? allTriggers[parent]
					: {};
			(relevant[parent] as Record<string, unknown>)[child] =
				((parentObj as Record<string, unknown>)[child] as boolean) ?? t.defaultValue;
		} else {
			relevant[t.key] = allTriggers[t.key] ?? t.defaultValue;
		}
	}
	return relevant;
}

function AgentSection({
	agentType,
	config,
	pmTriggers,
	scmTriggers,
	pmProvider,
	onEditConfig,
	onDeleteConfig,
	onSaveTriggers,
}: {
	agentType: string;
	config: AgentConfig | null;
	pmTriggers: Record<string, unknown>;
	scmTriggers: Record<string, unknown>;
	pmProvider: string;
	onEditConfig: (config: AgentConfig | null, agentType: string) => void;
	onDeleteConfig: (id: number) => void;
	onSaveTriggers: (
		category: 'pm' | 'scm',
		triggers: Record<string, unknown>,
		agentType: string,
	) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const [localPmTriggers, setLocalPmTriggers] = useState<Record<string, unknown>>(pmTriggers);
	const [localScmTriggers, setLocalScmTriggers] = useState<Record<string, unknown>>(scmTriggers);
	const [pmSaving, setPmSaving] = useState(false);
	const [scmSaving, setScmSaving] = useState(false);
	const [pmSaved, setPmSaved] = useState(false);
	const [scmSaved, setScmSaved] = useState(false);

	const agentPmTriggers = getTriggersForAgent(agentType, pmProvider);
	const agentScmTriggers = getTriggersForAgent(agentType).filter((t) => t.category === 'scm');

	const hasTriggers = agentPmTriggers.length > 0 || agentScmTriggers.length > 0;

	// Sync local state when props change (e.g., after another agent section saves shared triggers)
	useEffect(() => {
		setLocalPmTriggers(pmTriggers);
	}, [pmTriggers]);

	useEffect(() => {
		setLocalScmTriggers(scmTriggers);
	}, [scmTriggers]);

	const handleSavePm = async () => {
		setPmSaving(true);
		try {
			const relevant = extractRelevantTriggers(agentPmTriggers, localPmTriggers);
			await onSaveTriggers('pm', relevant, agentType);
			setPmSaved(true);
			setTimeout(() => setPmSaved(false), 2000);
		} finally {
			setPmSaving(false);
		}
	};

	const handleSaveScm = async () => {
		setScmSaving(true);
		try {
			const relevant: Record<string, unknown> = {};
			for (const t of agentScmTriggers) {
				relevant[t.key] = localScmTriggers[t.key] ?? t.defaultValue;
			}
			await onSaveTriggers('scm', relevant, agentType);
			setScmSaved(true);
			setTimeout(() => setScmSaved(false), 2000);
		} finally {
			setScmSaving(false);
		}
	};

	return (
		<div className="rounded-lg border border-border overflow-hidden">
			{/* Header */}
			<button
				type="button"
				onClick={() => setExpanded((v) => !v)}
				className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
			>
				<div className="flex items-center gap-3">
					{expanded ? (
						<ChevronDown className="h-4 w-4 text-muted-foreground" />
					) : (
						<ChevronRight className="h-4 w-4 text-muted-foreground" />
					)}
					<span className="font-medium text-sm">{AGENT_LABELS[agentType] ?? agentType}</span>
					<AgentConfigBadge config={config} />
				</div>
				<div className="flex items-center gap-1">
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onEditConfig(config, agentType);
						}}
						className="inline-flex h-7 items-center gap-1 rounded-md border border-input px-2 text-xs hover:bg-accent"
					>
						<Pencil className="h-3 w-3" />
						{config ? 'Edit Config' : 'Add Config'}
					</button>
					{config && (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onDeleteConfig(config.id);
							}}
							className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-accent"
						>
							<Trash2 className="h-3.5 w-3.5" />
						</button>
					)}
				</div>
			</button>

			{/* Expanded content */}
			{expanded && (
				<div className="border-t border-border px-4 py-4 space-y-6 bg-muted/20">
					{/* PM Triggers */}
					{agentPmTriggers.length > 0 && (
						<div className="space-y-3">
							<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								Project Management Triggers
							</p>
							<TriggerToggles
								items={agentPmTriggers}
								values={localPmTriggers}
								onChange={setLocalPmTriggers}
								idPrefix={`${agentType}-pm`}
							/>
							<div className="flex items-center gap-2">
								<button
									type="button"
									onClick={handleSavePm}
									disabled={pmSaving}
									className="inline-flex h-7 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
								>
									{pmSaving ? 'Saving...' : 'Save'}
								</button>
								{pmSaved && <span className="text-xs text-muted-foreground">Saved</span>}
							</div>
						</div>
					)}

					{/* SCM Triggers */}
					{agentScmTriggers.length > 0 && (
						<div className="space-y-3">
							<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								GitHub Triggers
							</p>
							<TriggerToggles
								items={agentScmTriggers}
								values={localScmTriggers}
								onChange={setLocalScmTriggers}
								idPrefix={`${agentType}-scm`}
							/>
							<div className="flex items-center gap-2">
								<button
									type="button"
									onClick={handleSaveScm}
									disabled={scmSaving}
									className="inline-flex h-7 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
								>
									{scmSaving ? 'Saving...' : 'Save'}
								</button>
								{scmSaved && <span className="text-xs text-muted-foreground">Saved</span>}
							</div>
						</div>
					)}

					{!hasTriggers && (
						<p className="text-xs text-muted-foreground">
							No trigger configuration for this agent.
						</p>
					)}
				</div>
			)}
		</div>
	);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: manages multiple mutations + state for agent configs and trigger updates
export function ProjectAgentConfigs({ projectId }: { projectId: string }) {
	const queryClient = useQueryClient();
	const configsQuery = useQuery(trpc.agentConfigs.list.queryOptions({ projectId }));
	const integrationsQuery = useQuery(trpc.projects.integrations.list.queryOptions({ projectId }));

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editing, setEditing] = useState<AgentConfig | null>(null);
	const [agentType, setAgentType] = useState('');
	const [model, setModel] = useState('');
	const [maxIterations, setMaxIterations] = useState('');
	const [agentBackend, setAgentBackend] = useState('');
	const [prompt, setPrompt] = useState('');
	const [localLifecycleTriggers, setLocalLifecycleTriggers] = useState<Record<string, unknown>>({});
	const [lifecycleSaving, setLifecycleSaving] = useState(false);
	const [lifecycleSaved, setLifecycleSaved] = useState(false);

	const configsQueryKey = trpc.agentConfigs.list.queryOptions({ projectId }).queryKey;
	const integrationsQueryKey = trpc.projects.integrations.list.queryOptions({ projectId }).queryKey;

	function openCreate(defaultAgentType = '') {
		setEditing(null);
		setAgentType(defaultAgentType);
		setModel('');
		setMaxIterations('');
		setAgentBackend('');
		setPrompt('');
		setDialogOpen(true);
	}

	function openEdit(config: AgentConfig) {
		setEditing(config);
		setAgentType(config.agentType);
		setModel(config.model ?? '');
		setMaxIterations(config.maxIterations?.toString() ?? '');
		setAgentBackend(config.agentBackend ?? '');
		setPrompt(config.prompt ?? '');
		setDialogOpen(true);
	}

	const createMutation = useMutation({
		mutationFn: () =>
			trpcClient.agentConfigs.create.mutate({
				projectId,
				agentType,
				model: model || null,
				maxIterations: maxIterations ? Number(maxIterations) : null,
				agentBackend: agentBackend || null,
				prompt: prompt || null,
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: configsQueryKey });
			setDialogOpen(false);
		},
	});

	const updateMutation = useMutation({
		mutationFn: () =>
			trpcClient.agentConfigs.update.mutate({
				id: editing?.id as number,
				agentType,
				model: model || null,
				maxIterations: maxIterations ? Number(maxIterations) : null,
				agentBackend: agentBackend || null,
				prompt: prompt || null,
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: configsQueryKey });
			setDialogOpen(false);
		},
	});

	const deleteMutation = useMutation({
		mutationFn: (id: number) => trpcClient.agentConfigs.delete.mutate({ id }),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: configsQueryKey }),
	});

	const updateTriggersMutation = useMutation({
		mutationFn: ({
			category,
			triggers,
		}: { category: 'pm' | 'scm'; triggers: Record<string, unknown> }) =>
			trpcClient.projects.integrations.updateTriggers.mutate({
				projectId,
				category,
				triggers: triggers as Record<string, boolean | Record<string, boolean>>,
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: integrationsQueryKey });
		},
	});

	if (configsQuery.isLoading || integrationsQuery.isLoading) {
		return <div className="py-4 text-muted-foreground">Loading agent configs...</div>;
	}

	const configs = (configsQuery.data ?? []) as AgentConfig[];
	const integrations = (integrationsQuery.data ?? []) as Array<Record<string, unknown>>;

	const pmIntegration = integrations.find((i) => i.category === 'pm');
	const scmIntegration = integrations.find((i) => i.category === 'scm');
	const pmProvider = (pmIntegration?.provider as string) ?? 'trello';
	const pmTriggers = (pmIntegration?.triggers as Record<string, unknown>) ?? {};
	const scmTriggers = (scmIntegration?.triggers as Record<string, unknown>) ?? {};

	// Build a map of agentType → AgentConfig for quick lookup
	const configByAgent = new Map<string, AgentConfig>();
	for (const c of configs) {
		configByAgent.set(c.agentType, c);
	}

	const activeMutation = editing ? updateMutation : createMutation;

	const handleEditConfig = (config: AgentConfig | null, type: string) => {
		if (config) {
			openEdit(config);
		} else {
			openCreate(type);
		}
	};

	const handleSaveTriggers = async (
		category: 'pm' | 'scm',
		triggers: Record<string, unknown>,
		_agentType: string,
	) => {
		await updateTriggersMutation.mutateAsync({ category, triggers });
	};

	const handleSaveLifecycle = async () => {
		setLifecycleSaving(true);
		try {
			const changed: Record<string, unknown> = {};
			for (const t of LIFECYCLE_TRIGGERS) {
				if (t.key in localLifecycleTriggers) {
					changed[t.key] = localLifecycleTriggers[t.key];
				}
			}
			await updateTriggersMutation.mutateAsync({ category: 'scm', triggers: changed });
			setLifecycleSaved(true);
			setTimeout(() => setLifecycleSaved(false), 2000);
		} finally {
			setLifecycleSaving(false);
		}
	};

	// Sync lifecycle triggers from props
	useEffect(() => {
		setLocalLifecycleTriggers(scmTriggers);
	}, [scmTriggers]);

	return (
		<div className="space-y-4">
			<p className="text-sm text-muted-foreground">
				Per-agent configuration and trigger settings scoped to this project.
			</p>

			{/* Agent sections */}
			<div className="space-y-2">
				{ALL_AGENT_TYPES.map((type) => (
					<AgentSection
						key={type}
						agentType={type}
						config={configByAgent.get(type) ?? null}
						pmTriggers={pmTriggers}
						scmTriggers={scmTriggers}
						pmProvider={pmProvider}
						onEditConfig={handleEditConfig}
						onDeleteConfig={(id) => deleteMutation.mutate(id)}
						onSaveTriggers={handleSaveTriggers}
					/>
				))}

				{/* Custom agent types not in the known list */}
				{configs
					.filter((c) => !(ALL_AGENT_TYPES as readonly string[]).includes(c.agentType))
					.map((c) => (
						<AgentSection
							key={c.agentType}
							agentType={c.agentType}
							config={c}
							pmTriggers={pmTriggers}
							scmTriggers={scmTriggers}
							pmProvider={pmProvider}
							onEditConfig={handleEditConfig}
							onDeleteConfig={(id) => deleteMutation.mutate(id)}
							onSaveTriggers={handleSaveTriggers}
						/>
					))}
			</div>

			{/* Add config for custom agent type */}
			<button
				type="button"
				onClick={() => openCreate()}
				className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
			>
				<Plus className="h-4 w-4" /> Add Custom Agent Config
			</button>

			{/* Lifecycle triggers section */}
			{LIFECYCLE_TRIGGERS.length > 0 && (
				<div className="rounded-lg border border-border p-4 space-y-3">
					<div>
						<h3 className="text-sm font-medium">Lifecycle Automations</h3>
						<p className="text-xs text-muted-foreground mt-0.5">
							These automations update card status but do not run an agent.
						</p>
					</div>
					<TriggerToggles
						items={LIFECYCLE_TRIGGERS}
						values={localLifecycleTriggers}
						onChange={setLocalLifecycleTriggers}
						idPrefix="lifecycle"
					/>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={handleSaveLifecycle}
							disabled={lifecycleSaving}
							className="inline-flex h-7 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
						>
							{lifecycleSaving ? 'Saving...' : 'Save'}
						</button>
						{lifecycleSaved && <span className="text-xs text-muted-foreground">Saved</span>}
					</div>
				</div>
			)}

			{/* Dialog for add/edit agent config */}
			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{editing ? 'Edit Agent Config' : 'New Agent Config'}</DialogTitle>
					</DialogHeader>
					<form
						onSubmit={(e) => {
							e.preventDefault();
							activeMutation.mutate();
						}}
						className="space-y-4"
					>
						<div className="space-y-2">
							<Label htmlFor="ac-agentType">Agent Type</Label>
							<Input
								id="ac-agentType"
								value={agentType}
								onChange={(e) => setAgentType(e.target.value)}
								placeholder="e.g. implementation, review"
								required
							/>
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div className="space-y-2">
								<Label htmlFor="ac-model">Model</Label>
								<ModelField
									id="ac-model"
									value={model}
									onChange={setModel}
									backend={agentBackend}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="ac-iterations">Max Iterations</Label>
								<Input
									id="ac-iterations"
									type="number"
									value={maxIterations}
									onChange={(e) => setMaxIterations(e.target.value)}
									placeholder="Optional"
								/>
							</div>
						</div>
						<div className="space-y-2">
							<Label>Backend</Label>
							<Select
								value={agentBackend || '_none'}
								onValueChange={(v) => setAgentBackend(v === '_none' ? '' : v)}
							>
								<SelectTrigger className="w-full">
									<SelectValue placeholder="Optional" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="_none">None</SelectItem>
									<SelectItem value="llmist">llmist</SelectItem>
									<SelectItem value="claude-code">claude-code</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-2">
							<Label>Prompt</Label>
							{editing?.prompt ? (
								<p className="text-sm text-muted-foreground">
									Custom prompt set.{' '}
									<Link to="/settings/prompts" className="text-primary hover:underline">
										Edit in Prompt Editor
									</Link>
								</p>
							) : (
								<p className="text-sm text-muted-foreground">
									Using default.{' '}
									<Link to="/settings/prompts" className="text-primary hover:underline">
										Customize in Prompt Editor
									</Link>
								</p>
							)}
						</div>
						<div className="flex justify-end gap-2">
							<button
								type="button"
								onClick={() => setDialogOpen(false)}
								className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm hover:bg-accent"
							>
								Cancel
							</button>
							<button
								type="submit"
								disabled={activeMutation.isPending}
								className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
							>
								{activeMutation.isPending ? 'Saving...' : editing ? 'Update' : 'Create'}
							</button>
						</div>
						{activeMutation.isError && (
							<p className="text-sm text-destructive">{activeMutation.error.message}</p>
						)}
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
