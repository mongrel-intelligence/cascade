import { ModelField } from '@/components/settings/model-field.js';
import {
	DefinitionTriggerToggles,
	type ResolvedTrigger,
} from '@/components/shared/definition-trigger-toggles.js';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog.js';
import { Badge } from '@/components/ui/badge.js';
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
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table.js';
import {
	AGENT_LABELS,
	CATEGORY_LABELS,
	type TriggerParameterValue,
} from '@/lib/trigger-agent-mapping.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, ChevronRight, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

interface AgentConfig {
	id: number;
	agentType: string;
	model: string | null;
	maxIterations: number | null;
	agentEngine: string | null;
	maxConcurrency: number | null;
}

interface Engine {
	id: string;
	label: string;
}

// ============================================================================
// Definition-Based Agent Section (New)
// ============================================================================

interface SaveConfigValues {
	model: string;
	maxIterations: string;
	agentEngine: string;
	maxConcurrency: string;
}

interface DefinitionAgentSectionProps {
	agentType: string;
	config: AgentConfig | null;
	triggers: ResolvedTrigger[];
	integrations: {
		pm: string | null;
		scm: string | null;
	};
	engines: Engine[];
	isSaving: boolean;
	onSaveConfig: (agentType: string, configId: number | null, values: SaveConfigValues) => void;
	saveSuccessNonce: number;
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
	config,
	triggers,
	integrations,
	engines,
	isSaving,
	onSaveConfig,
	saveSuccessNonce,
	onDeleteConfig,
	onTriggerToggle,
	onTriggerParamChange,
}: DefinitionAgentSectionProps) {
	const [saved, setSaved] = useState(false);
	const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Tracks whether a successful save is in flight (prevents config sync from clearing "Saved")
	const justSavedRef = useRef(false);

	// Local form state
	const [model, setModel] = useState(config?.model ?? '');
	const [maxIterations, setMaxIterations] = useState(config?.maxIterations?.toString() ?? '');
	const [agentEngine, setAgentEngine] = useState(config?.agentEngine ?? '');
	const [maxConcurrency, setMaxConcurrency] = useState(config?.maxConcurrency?.toString() ?? '');

	// Sync form state when config changes (e.g. after invalidateQueries refetch)
	// Skip clearing "Saved" if we just saved — the nonce effect will handle the timer
	useEffect(() => {
		setModel(config?.model ?? '');
		setMaxIterations(config?.maxIterations?.toString() ?? '');
		setAgentEngine(config?.agentEngine ?? '');
		setMaxConcurrency(config?.maxConcurrency?.toString() ?? '');
		if (justSavedRef.current) {
			justSavedRef.current = false;
		} else {
			setSaved(false);
		}
	}, [config]);

	// Show "Saved" indicator only after confirmed persistence (nonce increments on each success)
	useEffect(() => {
		if (saveSuccessNonce === 0) return;
		// Mark that a save just completed so the config sync effect won't clear the indicator
		justSavedRef.current = true;
		if (savedTimerRef.current !== null) {
			clearTimeout(savedTimerRef.current);
		}
		setSaved(true);
		savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
	}, [saveSuccessNonce]);

	// Clean up the "Saved" timer on unmount to avoid state updates on unmounted component
	useEffect(() => {
		return () => {
			if (savedTimerRef.current !== null) {
				clearTimeout(savedTimerRef.current);
			}
		};
	}, []);

	// Group triggers by category and filter by active integrations
	const triggersByCategory = useMemo(() => {
		const groups: Record<string, ResolvedTrigger[]> = {
			pm: [],
			scm: [],
			internal: [],
		};

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
		triggersByCategory.internal.length > 0;

	const handleSave = () => {
		onSaveConfig(agentType, config?.id ?? null, {
			model,
			maxIterations,
			agentEngine,
			maxConcurrency,
		});
	};

	const handleCancel = () => {
		setModel(config?.model ?? '');
		setMaxIterations(config?.maxIterations?.toString() ?? '');
		setAgentEngine(config?.agentEngine ?? '');
		setMaxConcurrency(config?.maxConcurrency?.toString() ?? '');
	};

	const handleDelete = () => {
		if (config && window.confirm('Delete this agent config?')) {
			onDeleteConfig(config.id);
		}
	};

	return (
		<div className="space-y-6">
			{/* Config fields */}
			<div className="space-y-4">
				<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					Configuration
				</p>
				<div className="grid grid-cols-2 gap-4">
					<div className="space-y-2">
						<Label htmlFor={`${agentType}-model`}>Model</Label>
						<ModelField
							id={`${agentType}-model`}
							value={model}
							onChange={setModel}
							engine={agentEngine}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor={`${agentType}-iterations`}>Max Iterations</Label>
						<Input
							id={`${agentType}-iterations`}
							type="number"
							value={maxIterations}
							onChange={(e) => setMaxIterations(e.target.value)}
							placeholder="Optional"
						/>
					</div>
				</div>
				<div className="grid grid-cols-2 gap-4">
					<div className="space-y-2">
						<Label htmlFor={`${agentType}-concurrency`}>Max Concurrency</Label>
						<Input
							id={`${agentType}-concurrency`}
							type="number"
							min={1}
							value={maxConcurrency}
							onChange={(e) => setMaxConcurrency(e.target.value)}
							placeholder="Optional"
						/>
					</div>
					<div className="space-y-2">
						<Label>Engine</Label>
						<Select
							value={agentEngine || '_none'}
							onValueChange={(v) => setAgentEngine(v === '_none' ? '' : v)}
						>
							<SelectTrigger className="w-full">
								<SelectValue placeholder="Optional" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="_none">None</SelectItem>
								{engines.map((engine) => (
									<SelectItem key={engine.id} value={engine.id}>
										{engine.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>
				<div className="space-y-2">
					<Label>Prompt</Label>
					<p className="text-sm text-muted-foreground">
						Prompts are managed in{' '}
						<Link to="/global/definitions" className="text-primary hover:underline">
							Agent Definitions
						</Link>
					</p>
				</div>
			</div>

			{/* Render triggers by category */}
			{(['pm', 'scm', 'internal'] as const).map((category) => {
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

			{!hasTriggers && (
				<p className="text-xs text-muted-foreground">No trigger configuration for this agent.</p>
			)}

			{/* Footer actions */}
			<div className="flex items-center justify-between border-t border-border pt-4">
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={handleSave}
						disabled={isSaving}
						className="inline-flex h-7 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
					>
						{isSaving ? 'Saving...' : config ? 'Save' : 'Create Config'}
					</button>
					<button
						type="button"
						onClick={handleCancel}
						className="inline-flex h-7 items-center rounded-md border border-input px-3 text-xs hover:bg-accent"
					>
						Reset
					</button>
					{saved && <span className="text-xs text-muted-foreground">Saved</span>}
				</div>
				{config && (
					<button
						type="button"
						onClick={handleDelete}
						className="inline-flex h-7 items-center rounded-md border border-destructive px-3 text-xs text-destructive hover:bg-destructive/10"
					>
						Delete Config
					</button>
				)}
			</div>
		</div>
	);
}

// ============================================================================
// Agent List View
// ============================================================================

function countActiveTriggers(
	triggers: ResolvedTrigger[],
	integrations: { pm: string | null; scm: string | null },
): number {
	return triggers.filter((t) => {
		if (!t.enabled) return false;
		const [category] = t.event.split(':');
		if (t.providers && t.providers.length > 0) {
			const activeProvider = integrations[category as keyof typeof integrations];
			return t.providers.some((p) => p === activeProvider);
		}
		return true;
	}).length;
}

interface AgentRowProps {
	type: string;
	config: AgentConfig | null;
	triggers: ResolvedTrigger[];
	integrations: { pm: string | null; scm: string | null };
	onSelect: (agentType: string) => void;
	onDeleteRequest: (id: number, label: string) => void;
}

function AgentRow({
	type,
	config,
	triggers,
	integrations,
	onSelect,
	onDeleteRequest,
}: AgentRowProps) {
	const label = (AGENT_LABELS as Record<string, string | undefined>)[type] ?? type;
	const activeTriggerCount = countActiveTriggers(triggers, integrations);
	const modelInfo = config?.model ?? null;
	const engineInfo = config?.agentEngine ?? null;

	return (
		<TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => onSelect(type)}>
			<TableCell className="font-medium">{label}</TableCell>
			<TableCell>
				{config ? (
					<Badge variant="default" className="text-xs">
						Configured
					</Badge>
				) : (
					<Badge variant="outline" className="text-xs">
						Default
					</Badge>
				)}
			</TableCell>
			<TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
				{modelInfo || engineInfo ? (
					<span>
						{modelInfo && <span>{modelInfo}</span>}
						{modelInfo && engineInfo && <span> · </span>}
						{engineInfo && <span>{engineInfo}</span>}
					</span>
				) : (
					<span>—</span>
				)}
			</TableCell>
			<TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
				{activeTriggerCount > 0 ? <span>{activeTriggerCount} active</span> : <span>None</span>}
			</TableCell>
			<TableCell>
				<div className="flex items-center justify-end gap-1">
					{config && (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onDeleteRequest(config.id, label);
							}}
							className="p-1 text-muted-foreground hover:text-destructive"
							title="Delete config"
						>
							<Trash2 className="h-4 w-4" />
						</button>
					)}
					<ChevronRight className="h-4 w-4 text-muted-foreground" />
				</div>
			</TableCell>
		</TableRow>
	);
}

interface AgentListViewProps {
	agentTypes: string[];
	configByAgent: Map<string, AgentConfig>;
	triggersByAgent: Map<string, ResolvedTrigger[]>;
	integrations: { pm: string | null; scm: string | null };
	onSelect: (agentType: string) => void;
	onDelete: (id: number) => void;
	isDeleting: boolean;
}

function AgentListView({
	agentTypes,
	configByAgent,
	triggersByAgent,
	integrations,
	onSelect,
	onDelete,
	isDeleting,
}: AgentListViewProps) {
	const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string } | null>(null);

	if (agentTypes.length === 0) {
		return (
			<div className="py-8 text-center text-muted-foreground">No agent definitions found.</div>
		);
	}

	return (
		<>
			<div className="overflow-x-auto rounded-lg border border-border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Agent</TableHead>
							<TableHead>Status</TableHead>
							<TableHead className="hidden sm:table-cell">Model / Engine</TableHead>
							<TableHead className="hidden sm:table-cell">Active Triggers</TableHead>
							<TableHead className="w-20" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{agentTypes.map((type) => (
							<AgentRow
								key={type}
								type={type}
								config={configByAgent.get(type) ?? null}
								triggers={triggersByAgent.get(type) ?? []}
								integrations={integrations}
								onSelect={onSelect}
								onDeleteRequest={(id, label) => setDeleteTarget({ id, label })}
							/>
						))}
					</TableBody>
				</Table>
			</div>

			<AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Agent Config</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete the custom config for{' '}
							<strong>{deleteTarget?.label}</strong>? The agent will revert to default settings.
							This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (deleteTarget) {
									onDelete(deleteTarget.id);
									setDeleteTarget(null);
								}
							}}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{isDeleting ? 'Deleting...' : 'Delete'}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

// ============================================================================
// Agent Detail View
// ============================================================================

interface AgentDetailViewProps {
	agentType: string;
	config: AgentConfig | null;
	triggers: ResolvedTrigger[];
	integrations: { pm: string | null; scm: string | null };
	engines: Engine[];
	isSaving: boolean;
	onSaveConfig: (agentType: string, configId: number | null, values: SaveConfigValues) => void;
	saveSuccessNonce: number;
	onDeleteConfig: (id: number) => void;
	onTriggerToggle: (agentType: string, event: string, enabled: boolean) => void;
	onTriggerParamChange: (
		agentType: string,
		event: string,
		parameters: Record<string, TriggerParameterValue>,
		currentEnabled: boolean,
	) => void;
	onBack: () => void;
}

function AgentDetailView({
	agentType,
	config,
	triggers,
	integrations,
	engines,
	isSaving,
	onSaveConfig,
	saveSuccessNonce,
	onDeleteConfig,
	onTriggerToggle,
	onTriggerParamChange,
	onBack,
}: AgentDetailViewProps) {
	const label = (AGENT_LABELS as Record<string, string | undefined>)[agentType] ?? agentType;

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-3">
				<button
					type="button"
					onClick={onBack}
					className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
				>
					<ArrowLeft className="h-4 w-4" /> Back to agents
				</button>
			</div>
			<div>
				<h2 className="text-lg font-semibold">{label}</h2>
				<p className="text-sm text-muted-foreground">
					Configure model, engine, and trigger settings for the {label} agent.
				</p>
			</div>
			<DefinitionAgentSection
				agentType={agentType}
				config={config}
				triggers={triggers}
				integrations={integrations}
				engines={engines}
				isSaving={isSaving}
				onSaveConfig={onSaveConfig}
				saveSuccessNonce={saveSuccessNonce}
				onDeleteConfig={(id) => {
					onDeleteConfig(id);
					onBack();
				}}
				onTriggerToggle={onTriggerToggle}
				onTriggerParamChange={onTriggerParamChange}
			/>
		</div>
	);
}

// ============================================================================
// Main Component
// ============================================================================

export function ProjectAgentConfigs({ projectId }: { projectId: string }) {
	const queryClient = useQueryClient();

	// Agent configs query
	const configsQuery = useQuery(trpc.agentConfigs.list.queryOptions({ projectId }));
	const enginesQuery = useQuery(trpc.agentConfigs.engines.queryOptions());

	// Definition-based triggers query
	const triggersViewQuery = useQuery(
		trpc.agentTriggerConfigs.getProjectTriggersView.queryOptions({ projectId }),
	);

	const [savingAgentType, setSavingAgentType] = useState<string | null>(null);
	const [saveSuccessNonces, setSaveSuccessNonces] = useState<Record<string, number>>({});
	const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

	const configsQueryKey = trpc.agentConfigs.list.queryOptions({ projectId }).queryKey;
	const triggersViewQueryKey = trpc.agentTriggerConfigs.getProjectTriggersView.queryOptions({
		projectId,
	}).queryKey;

	// Agent config mutations (shared)
	const createMutation = useMutation({
		mutationFn: (input: {
			agentType: string;
			model: string | null;
			maxIterations: number | null;
			agentEngine: string | null;
			maxConcurrency: number | null;
		}) =>
			trpcClient.agentConfigs.create.mutate({
				projectId,
				agentType: input.agentType,
				model: input.model,
				maxIterations: input.maxIterations,
				agentEngine: input.agentEngine,
				maxConcurrency: input.maxConcurrency,
			}),
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({ queryKey: configsQueryKey });
			setSavingAgentType(null);
			setSaveSuccessNonces((prev) => ({
				...prev,
				[variables.agentType]: (prev[variables.agentType] ?? 0) + 1,
			}));
		},
		onError: (err) => {
			toast.error('Failed to create agent config', { description: err.message });
			setSavingAgentType(null);
		},
	});

	const updateMutation = useMutation({
		mutationFn: (input: {
			id: number;
			agentType: string;
			model: string | null;
			maxIterations: number | null;
			agentEngine: string | null;
			maxConcurrency: number | null;
		}) =>
			trpcClient.agentConfigs.update.mutate({
				id: input.id,
				agentType: input.agentType,
				model: input.model,
				maxIterations: input.maxIterations,
				agentEngine: input.agentEngine,
				maxConcurrency: input.maxConcurrency,
			}),
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({ queryKey: configsQueryKey });
			setSavingAgentType(null);
			setSaveSuccessNonces((prev) => ({
				...prev,
				[variables.agentType]: (prev[variables.agentType] ?? 0) + 1,
			}));
		},
		onError: (err) => {
			toast.error('Failed to update agent config', { description: err.message });
			setSavingAgentType(null);
		},
	});

	const deleteMutation = useMutation({
		mutationFn: (id: number) => trpcClient.agentConfigs.delete.mutate({ id }),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: configsQueryKey }),
		onError: (err) => {
			toast.error('Failed to delete agent config', { description: err.message });
		},
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

	// Loading state
	const isLoading = configsQuery.isLoading || triggersViewQuery.isLoading;

	if (isLoading) {
		return <div className="py-4 text-muted-foreground">Loading agent configs...</div>;
	}

	const configs = (configsQuery.data ?? []) as AgentConfig[];
	const engines = (enginesQuery.data ?? []) as Engine[];

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
	};
	if (triggersViewQuery.data) {
		for (const agent of triggersViewQuery.data.agents) {
			triggersByAgent.set(agent.agentType, agent.triggers as ResolvedTrigger[]);
		}
	}

	const handleSaveConfig = (
		type: string,
		configId: number | null,
		values: { model: string; maxIterations: string; agentEngine: string; maxConcurrency: string },
	) => {
		setSavingAgentType(type);
		const payload = {
			agentType: type,
			model: values.model || null,
			maxIterations: values.maxIterations ? Number(values.maxIterations) : null,
			agentEngine: values.agentEngine || null,
			maxConcurrency: values.maxConcurrency ? Number(values.maxConcurrency) : null,
		};

		if (configId !== null) {
			updateMutation.mutate({ id: configId, ...payload });
		} else {
			createMutation.mutate(payload);
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

	// Get list of agent types to display
	const agentTypes = Array.from(triggersByAgent.keys());

	// Render detail view when an agent is selected
	if (selectedAgent !== null) {
		return (
			<AgentDetailView
				agentType={selectedAgent}
				config={configByAgent.get(selectedAgent) ?? null}
				triggers={triggersByAgent.get(selectedAgent) ?? []}
				integrations={triggersViewIntegrations}
				engines={engines}
				isSaving={
					savingAgentType === selectedAgent &&
					(createMutation.isPending || updateMutation.isPending)
				}
				onSaveConfig={handleSaveConfig}
				saveSuccessNonce={saveSuccessNonces[selectedAgent] ?? 0}
				onDeleteConfig={(id) => deleteMutation.mutate(id)}
				onTriggerToggle={handleTriggerToggle}
				onTriggerParamChange={handleTriggerParamChange}
				onBack={() => setSelectedAgent(null)}
			/>
		);
	}

	// Render list view
	return (
		<div className="space-y-4">
			<p className="text-sm text-muted-foreground">
				Per-agent configuration and trigger settings scoped to this project. Click an agent to
				configure its model, engine, and triggers.
			</p>

			<AgentListView
				agentTypes={agentTypes}
				configByAgent={configByAgent}
				triggersByAgent={triggersByAgent}
				integrations={triggersViewIntegrations}
				onSelect={setSelectedAgent}
				onDelete={(id) => deleteMutation.mutate(id)}
				isDeleting={deleteMutation.isPending}
			/>
		</div>
	);
}
