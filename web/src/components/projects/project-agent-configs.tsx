import { ModelField } from '@/components/settings/model-field.js';
import {
	DefinitionTriggerToggles,
	type ResolvedTrigger,
} from '@/components/shared/definition-trigger-toggles.js';
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
	AGENT_LABELS,
	CATEGORY_LABELS,
	EMAIL_TRIGGER_AGENTS,
	type KnownAgentType,
	LIFECYCLE_TRIGGERS,
	type TriggerParameterValue,
} from '@/lib/trigger-agent-mapping.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { EmailJokeConfig } from './email-wizard.js';

interface AgentConfig {
	id: number;
	agentType: string;
	model: string | null;
	maxIterations: number | null;
	agentBackend: string | null;
}

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

// ============================================================================
// Definition-Based Agent Section (New)
// ============================================================================

interface DefinitionAgentSectionProps {
	agentType: string;
	projectId: string;
	config: AgentConfig | null;
	triggers: ResolvedTrigger[];
	integrations: {
		pm: string | null;
		scm: string | null;
		email: string | null;
		sms: string | null;
	};
	onEditConfig: (config: AgentConfig | null, agentType: string) => void;
	onDeleteConfig: (id: number) => void;
	onTriggerToggle: (agentType: string, event: string, enabled: boolean) => void;
	onTriggerParamChange: (
		agentType: string,
		event: string,
		parameters: Record<string, TriggerParameterValue>,
		currentEnabled: boolean,
	) => void;
}

function DefinitionAgentSection({
	agentType,
	projectId,
	config,
	triggers,
	integrations,
	onEditConfig,
	onDeleteConfig,
	onTriggerToggle,
	onTriggerParamChange,
}: DefinitionAgentSectionProps) {
	const [expanded, setExpanded] = useState(false);
	const hasEmailTriggers = EMAIL_TRIGGER_AGENTS.has(agentType as KnownAgentType);

	// Group triggers by category and filter by active integrations
	const triggersByCategory = useMemo(() => {
		const groups: Record<string, ResolvedTrigger[]> = { pm: [], scm: [], email: [], sms: [] };

		for (const trigger of triggers) {
			// Extract category from event (e.g., "pm:card-moved" -> "pm")
			const [category] = trigger.event.split(':');
			if (category in groups) {
				// Filter by provider if the trigger has provider restrictions
				if (trigger.providers && trigger.providers.length > 0) {
					const activeProvider = integrations[category as keyof typeof integrations];
					const matchesProvider = trigger.providers.some((p) => p === activeProvider);
					if (!matchesProvider) continue;
				}
				groups[category].push(trigger);
			}
		}

		return groups;
	}, [triggers, integrations]);

	const hasTriggers =
		triggersByCategory.pm.length > 0 ||
		triggersByCategory.scm.length > 0 ||
		triggersByCategory.email.length > 0 ||
		triggersByCategory.sms.length > 0 ||
		hasEmailTriggers;

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
					<span className="font-medium text-sm">
						{(AGENT_LABELS as Record<string, string | undefined>)[agentType] ?? agentType}
					</span>
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
					{/* Render triggers by category */}
					{(['pm', 'scm', 'email', 'sms'] as const).map((category) => {
						const categoryTriggers = triggersByCategory[category];
						if (categoryTriggers.length === 0) return null;

						return (
							<div key={category} className="space-y-3">
								<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
									{CATEGORY_LABELS[category] ?? category} Triggers
								</p>
								<DefinitionTriggerToggles
									triggers={categoryTriggers}
									onToggle={(event, enabled) => onTriggerToggle(agentType, event, enabled)}
									onParamChange={(event, params) => {
										// Find the current trigger to get its enabled state
										const currentTrigger = categoryTriggers.find((t) => t.event === event);
										onTriggerParamChange(agentType, event, params, currentTrigger?.enabled ?? true);
									}}
									idPrefix={`${agentType}-${category}`}
								/>
							</div>
						);
					})}

					{/* Email Triggers (custom widget) */}
					{hasEmailTriggers && (
						<div className="space-y-3">
							<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								Email Configuration
							</p>
							<EmailJokeConfig projectId={projectId} />
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

// ============================================================================
// Main Component
// ============================================================================

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: manages multiple mutations + state for agent configs and trigger updates
export function ProjectAgentConfigs({ projectId }: { projectId: string }) {
	const queryClient = useQueryClient();

	// Agent configs query
	const configsQuery = useQuery(trpc.agentConfigs.list.queryOptions({ projectId }));

	// Definition-based triggers query
	const triggersViewQuery = useQuery(
		trpc.agentTriggerConfigs.getProjectTriggersView.queryOptions({ projectId }),
	);

	// Integrations query (for lifecycle triggers)
	const integrationsQuery = useQuery(trpc.projects.integrations.list.queryOptions({ projectId }));

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editing, setEditing] = useState<AgentConfig | null>(null);
	const [agentType, setAgentType] = useState('');
	const [model, setModel] = useState('');
	const [maxIterations, setMaxIterations] = useState('');
	const [agentBackend, setAgentBackend] = useState('');
	const [localLifecycleTriggers, setLocalLifecycleTriggers] = useState<Record<string, unknown>>({});
	const [lifecycleSaving, setLifecycleSaving] = useState(false);
	const [lifecycleSaved, setLifecycleSaved] = useState(false);

	const configsQueryKey = trpc.agentConfigs.list.queryOptions({ projectId }).queryKey;
	const triggersViewQueryKey = trpc.agentTriggerConfigs.getProjectTriggersView.queryOptions({
		projectId,
	}).queryKey;
	const integrationsQueryKey = trpc.projects.integrations.list.queryOptions({ projectId }).queryKey;

	function openCreate(defaultAgentType: string) {
		setEditing(null);
		setAgentType(defaultAgentType);
		setModel('');
		setMaxIterations('');
		setAgentBackend('');
		setDialogOpen(true);
	}

	function openEdit(config: AgentConfig) {
		setEditing(config);
		setAgentType(config.agentType);
		setModel(config.model ?? '');
		setMaxIterations(config.maxIterations?.toString() ?? '');
		setAgentBackend(config.agentBackend ?? '');
		setDialogOpen(true);
	}

	// Agent config mutations (shared)
	const createMutation = useMutation({
		mutationFn: () =>
			trpcClient.agentConfigs.create.mutate({
				projectId,
				agentType,
				model: model || null,
				maxIterations: maxIterations ? Number(maxIterations) : null,
				agentBackend: agentBackend || null,
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

	// New trigger mutation (uses agentTriggerConfigs.upsert)
	const upsertTriggerMutation = useMutation({
		mutationFn: (input: {
			agentType: string;
			triggerEvent: string;
			enabled?: boolean;
			parameters?: Record<string, TriggerParameterValue>;
		}) =>
			trpcClient.agentTriggerConfigs.upsert.mutate({
				projectId,
				agentType: input.agentType,
				triggerEvent: input.triggerEvent,
				enabled: input.enabled,
				parameters: input.parameters,
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: triggersViewQueryKey });
		},
	});

	// Lifecycle trigger mutation (uses legacy save mechanism)
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

	// Derive trigger values for lifecycle triggers
	const integrations = (integrationsQuery.data ?? []) as Array<Record<string, unknown>>;
	const scmIntegration = integrations.find((i) => i.category === 'scm');
	const emptyTriggers = useMemo<Record<string, unknown>>(() => ({}), []);
	const scmTriggers = (scmIntegration?.triggers as Record<string, unknown>) ?? emptyTriggers;

	// Sync lifecycle trigger state
	useEffect(() => {
		setLocalLifecycleTriggers(scmTriggers);
	}, [scmTriggers]);

	// Loading state
	const isLoading = configsQuery.isLoading || triggersViewQuery.isLoading;

	if (isLoading) {
		return <div className="py-4 text-muted-foreground">Loading agent configs...</div>;
	}

	const configs = (configsQuery.data ?? []) as AgentConfig[];

	// Build agent config map
	const configByAgent = new Map<string, AgentConfig>();
	for (const c of configs) {
		configByAgent.set(c.agentType, c);
	}

	// Build triggers map from API
	const triggersByAgent = new Map<string, ResolvedTrigger[]>();
	const triggersViewIntegrations = triggersViewQuery.data?.integrations ?? {
		pm: null,
		scm: null,
		email: null,
		sms: null,
	};
	if (triggersViewQuery.data) {
		for (const agent of triggersViewQuery.data.agents) {
			triggersByAgent.set(agent.agentType, agent.triggers as ResolvedTrigger[]);
		}
	}

	// Handlers
	const handleEditConfig = (config: AgentConfig | null, type: string) => {
		if (config) {
			openEdit(config);
		} else {
			openCreate(type);
		}
	};

	const handleTriggerToggle = (agentType: string, event: string, enabled: boolean) => {
		upsertTriggerMutation.mutate(
			{ agentType, triggerEvent: event, enabled },
			{
				onError: (err) => {
					toast.error('Failed to update trigger', {
						description: err.message,
					});
				},
			},
		);
	};

	const handleTriggerParamChange = (
		agentType: string,
		event: string,
		parameters: Record<string, TriggerParameterValue>,
		currentEnabled: boolean,
	) => {
		// Include the current enabled state to avoid overwriting it
		upsertTriggerMutation.mutate(
			{ agentType, triggerEvent: event, enabled: currentEnabled, parameters },
			{
				onError: (err) => {
					toast.error('Failed to update trigger parameters', {
						description: err.message,
					});
				},
			},
		);
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

	const activeMutation = editing ? updateMutation : createMutation;

	// Get list of agent types to display
	const agentTypes = Array.from(triggersByAgent.keys());

	return (
		<div className="space-y-4">
			<p className="text-sm text-muted-foreground">
				Per-agent configuration and trigger settings scoped to this project.
			</p>

			{/* Agent sections */}
			<div className="space-y-2">
				{agentTypes.map((type) => (
					<DefinitionAgentSection
						key={type}
						agentType={type}
						projectId={projectId}
						config={configByAgent.get(type) ?? null}
						triggers={triggersByAgent.get(type) ?? []}
						integrations={triggersViewIntegrations}
						onEditConfig={handleEditConfig}
						onDeleteConfig={(id) => deleteMutation.mutate(id)}
						onTriggerToggle={handleTriggerToggle}
						onTriggerParamChange={handleTriggerParamChange}
					/>
				))}
			</div>

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
								value={(AGENT_LABELS as Record<string, string | undefined>)[agentType] ?? agentType}
								readOnly
								className="bg-muted"
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
							<p className="text-sm text-muted-foreground">
								Prompts are managed in{' '}
								<Link to="/settings/definitions" className="text-primary hover:underline">
									Agent Definitions
								</Link>
							</p>
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
