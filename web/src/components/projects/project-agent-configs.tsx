import { EngineSettingsFields } from '@/components/settings/engine-settings-fields.js';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.js';
import {
	AGENT_LABELS,
	CATEGORY_LABELS,
	type TriggerParameterValue,
} from '@/lib/trigger-agent-mapping.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AgentPromptOverrides } from './agent-prompt-overrides.js';

interface AgentConfig {
	id: number;
	agentType: string;
	model: string | null;
	maxIterations: number | null;
	agentEngine: string | null;
	agentEngineSettings: Record<string, Record<string, unknown>> | null;
	maxConcurrency: number | null;
	systemPrompt: string | null;
	taskPrompt: string | null;
}

interface EngineSettingFieldOption {
	value: string;
	label: string;
}

type EngineSettingField =
	| {
			key: string;
			label: string;
			type: 'select';
			description?: string;
			options: EngineSettingFieldOption[];
	  }
	| { key: string; label: string; type: 'boolean'; description?: string }
	| {
			key: string;
			label: string;
			type: 'number';
			description?: string;
			min?: number;
			max?: number;
			step?: number;
	  };

interface Engine {
	id: string;
	label: string;
	settings?: {
		title?: string;
		description?: string;
		fields: EngineSettingField[];
	};
}

// ============================================================================
// Definition-Based Agent Section (New)
// ============================================================================

interface SaveConfigValues {
	model: string;
	maxIterations: string;
	agentEngine: string;
	maxConcurrency: string;
	engineSettings: Record<string, Record<string, unknown>> | undefined;
	systemPrompt: string;
	taskPrompt: string;
	/** True when the user explicitly cleared the system prompt override (send null, not the fallback text). */
	systemPromptCleared: boolean;
	/** True when the user explicitly cleared the task prompt override (send null, not the fallback text). */
	taskPromptCleared: boolean;
}

interface SystemDefaults {
	model: string;
	maxIterations: number;
	agentEngine: string;
	engineSettings: Record<string, Record<string, unknown>>;
}

interface DefinitionAgentSectionProps {
	agentType: string;
	projectId: string;
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
	/** Project-level model (null = use system default). */
	projectModel: string | null;
	/** Project-level engine (null = use system default). */
	projectEngine: string | null;
	/** Project-level maxIterations (null = use system default). */
	projectMaxIterations: number | null;
	/** System-level defaults from the backend. */
	systemDefaults: SystemDefaults | undefined;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: tabbed detail panel managing Engine/Prompts/Triggers tabs with per-tab state, mutations, and trigger category grouping
function DefinitionAgentSection({
	agentType,
	projectId,
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
	projectModel,
	projectEngine,
	projectMaxIterations,
	systemDefaults,
}: DefinitionAgentSectionProps) {
	const [saved, setSaved] = useState(false);
	const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Tracks whether a successful save is in flight (prevents config sync from clearing "Saved")
	const justSavedRef = useRef(false);

	// Local form state — engine fields
	const [model, setModel] = useState(config?.model ?? '');
	const [maxIterations, setMaxIterations] = useState(config?.maxIterations?.toString() ?? '');
	const [agentEngine, setAgentEngine] = useState(config?.agentEngine ?? '');
	const [maxConcurrency, setMaxConcurrency] = useState(config?.maxConcurrency?.toString() ?? '');
	const [engineSettings, setEngineSettings] = useState<
		Record<string, Record<string, unknown>> | undefined
	>(config?.agentEngineSettings ?? undefined);

	// Local form state — prompt fields (initialized by AgentPromptOverrides component)
	const [systemPrompt, setSystemPrompt] = useState(config?.systemPrompt ?? '');
	const [taskPrompt, setTaskPrompt] = useState(config?.taskPrompt ?? '');
	// Track whether the user explicitly cleared a prompt override so we can send null on save
	// instead of the fallback display text (which would create a duplicate "custom" override).
	const [systemPromptCleared, setSystemPromptCleared] = useState(false);
	const [taskPromptCleared, setTaskPromptCleared] = useState(false);

	const effectiveEngineId = agentEngine || '';
	const effectiveEngine = engines.find((engine) => engine.id === effectiveEngineId);

	// Resolved inherited engine — project override or system default
	const inheritedEngine = projectEngine ?? systemDefaults?.agentEngine ?? 'llmist';
	// Per-field engine defaults for the EngineSettingsFields component
	const engineDefaults =
		systemDefaults && effectiveEngineId
			? systemDefaults.engineSettings[effectiveEngineId]
			: undefined;

	// Resolved inherited model and iterations (walk the chain: project → system)
	const inheritedModel = projectModel ?? systemDefaults?.model;
	const inheritedMaxIterations = projectMaxIterations ?? systemDefaults?.maxIterations;

	// Sync form state when config changes (e.g. after invalidateQueries refetch)
	// Skip clearing "Saved" if we just saved — the nonce effect will handle the timer
	useEffect(() => {
		setModel(config?.model ?? '');
		setMaxIterations(config?.maxIterations?.toString() ?? '');
		setAgentEngine(config?.agentEngine ?? '');
		setMaxConcurrency(config?.maxConcurrency?.toString() ?? '');
		setEngineSettings(config?.agentEngineSettings ?? undefined);
		setSystemPrompt(config?.systemPrompt ?? '');
		setTaskPrompt(config?.taskPrompt ?? '');
		setSystemPromptCleared(false);
		setTaskPromptCleared(false);
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
			engineSettings,
			systemPrompt,
			taskPrompt,
			systemPromptCleared,
			taskPromptCleared,
		});
	};

	const handleCancel = () => {
		setModel(config?.model ?? '');
		setMaxIterations(config?.maxIterations?.toString() ?? '');
		setAgentEngine(config?.agentEngine ?? '');
		setMaxConcurrency(config?.maxConcurrency?.toString() ?? '');
		setEngineSettings(config?.agentEngineSettings ?? undefined);
		setSystemPrompt(config?.systemPrompt ?? '');
		setTaskPrompt(config?.taskPrompt ?? '');
		setSystemPromptCleared(false);
		setTaskPromptCleared(false);
	};

	const handleDelete = () => {
		if (config && window.confirm('Delete this agent config?')) {
			onDeleteConfig(config.id);
		}
	};

	return (
		<div className="space-y-4">
			<Tabs defaultValue="engine">
				<TabsList>
					<TabsTrigger value="engine">Engine</TabsTrigger>
					<TabsTrigger value="prompts">Prompts</TabsTrigger>
					<TabsTrigger value="triggers">Triggers</TabsTrigger>
				</TabsList>

				{/* Engine Tab */}
				<TabsContent value="engine" className="space-y-4 pt-4">
					<div className="grid grid-cols-2 gap-4">
						<div className="space-y-2">
							<Label htmlFor={`${agentType}-model`}>Model</Label>
							<ModelField
								id={`${agentType}-model`}
								value={model}
								onChange={setModel}
								engine={agentEngine}
								defaultLabel={
									inheritedModel ? `Inherit from project (${inheritedModel})` : undefined
								}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor={`${agentType}-iterations`}>Max Iterations</Label>
							<Input
								id={`${agentType}-iterations`}
								type="number"
								value={maxIterations}
								onChange={(e) => setMaxIterations(e.target.value)}
								placeholder={
									inheritedMaxIterations !== undefined
										? `${inheritedMaxIterations} (inherited)`
										: 'Optional'
								}
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
									<SelectItem value="_none">Inherit from project ({inheritedEngine})</SelectItem>
									{engines.map((engine) => (
										<SelectItem key={engine.id} value={engine.id}>
											{engine.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
					{effectiveEngine && (
						<EngineSettingsFields
							engine={effectiveEngine}
							value={engineSettings}
							onChange={setEngineSettings}
							inheritLabel="Inherit from project"
							engineDefaults={engineDefaults}
						/>
					)}
				</TabsContent>

				{/* Prompts Tab */}
				<TabsContent value="prompts" className="pt-4">
					<AgentPromptOverrides
						projectId={projectId}
						agentType={agentType}
						systemPrompt={systemPrompt}
						onSystemPromptChange={(v) => {
							setSystemPrompt(v);
							// User is editing manually — cancel any pending clear
							setSystemPromptCleared(false);
						}}
						taskPrompt={taskPrompt}
						onTaskPromptChange={(v) => {
							setTaskPrompt(v);
							// User is editing manually — cancel any pending clear
							setTaskPromptCleared(false);
						}}
						onSystemPromptClear={() => setSystemPromptCleared(true)}
						onTaskPromptClear={() => setTaskPromptCleared(true)}
					/>
				</TabsContent>

				{/* Triggers Tab */}
				<TabsContent value="triggers" className="space-y-6 pt-4">
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
						<p className="text-xs text-muted-foreground">
							No trigger configuration for this agent.
						</p>
					)}
				</TabsContent>
			</Tabs>

			{/* Footer actions — outside tabs, applies globally */}
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
	/** Project-level model to show as "inherited" when agent has no override. */
	projectModel: string | null;
	/** Project-level engine to show as "inherited" when agent has no override. */
	projectEngine: string | null;
	/** System-level defaults. */
	systemDefaults: SystemDefaults | undefined;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: table row with multiple computed display values (model, engine, trigger count) and layered inheritance fallbacks
function AgentRow({
	type,
	config,
	triggers,
	integrations,
	onSelect,
	onDeleteRequest,
	projectModel,
	projectEngine,
	systemDefaults,
}: AgentRowProps) {
	const label = (AGENT_LABELS as Record<string, string | undefined>)[type] ?? type;
	const activeTriggerCount = countActiveTriggers(triggers, integrations);
	const modelInfo = config?.model ?? null;
	const engineInfo = config?.agentEngine ?? null;
	const hasCustomEngineSettings =
		config?.agentEngineSettings != null && Object.keys(config.agentEngineSettings).length > 0;

	// Fallback display: show inherited model/engine when agent has no specific override
	const inheritedModel = projectModel ?? systemDefaults?.model ?? null;
	const inheritedEngine = projectEngine ?? systemDefaults?.agentEngine ?? null;
	const displayModel = modelInfo ?? (inheritedModel ? `${inheritedModel} (inherited)` : null);
	const displayEngine = engineInfo ?? (inheritedEngine ? `${inheritedEngine} (inherited)` : null);

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
				{displayModel || displayEngine ? (
					<span>
						{displayModel && <span>{displayModel}</span>}
						{displayModel && displayEngine && <span> · </span>}
						{displayEngine && <span>{displayEngine}</span>}
						{hasCustomEngineSettings && (
							<span className="ml-1.5 inline-flex items-center rounded-sm bg-muted px-1.5 py-0.5 text-xs">
								Custom settings
							</span>
						)}
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
	enabledAgentTypes: string[];
	availableAgentTypes: string[];
	configByAgent: Map<string, AgentConfig>;
	triggersByAgent: Map<string, ResolvedTrigger[]>;
	integrations: { pm: string | null; scm: string | null };
	onSelect: (agentType: string) => void;
	onDelete: (id: number) => void;
	onEnable: (agentType: string) => void;
	isDeleting: boolean;
	isEnabling: boolean;
	projectModel: string | null;
	projectEngine: string | null;
	systemDefaults: SystemDefaults | undefined;
}

function AgentListView({
	enabledAgentTypes,
	availableAgentTypes,
	configByAgent,
	triggersByAgent,
	integrations,
	onSelect,
	onDelete,
	onEnable,
	isDeleting,
	isEnabling,
	projectModel,
	projectEngine,
	systemDefaults,
}: AgentListViewProps) {
	const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string } | null>(null);

	return (
		<>
			{enabledAgentTypes.length === 0 ? (
				<div className="rounded-lg border border-border py-8 text-center text-muted-foreground">
					No agents enabled. Enable agents below to start processing.
				</div>
			) : (
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
							{enabledAgentTypes.map((type) => (
								<AgentRow
									key={type}
									type={type}
									config={configByAgent.get(type) ?? null}
									triggers={triggersByAgent.get(type) ?? []}
									integrations={integrations}
									onSelect={onSelect}
									onDeleteRequest={(id, label) => setDeleteTarget({ id, label })}
									projectModel={projectModel}
									projectEngine={projectEngine}
									systemDefaults={systemDefaults}
								/>
							))}
						</TableBody>
					</Table>
				</div>
			)}

			{availableAgentTypes.length > 0 && (
				<div className="space-y-3">
					<p className="text-sm font-medium text-muted-foreground">Available Agents</p>
					<div className="rounded-lg border border-border divide-y divide-border">
						{availableAgentTypes.map((agentType) => {
							const label =
								(AGENT_LABELS as Record<string, string | undefined>)[agentType] ?? agentType;
							return (
								<div key={agentType} className="flex items-center justify-between px-4 py-3">
									<span className="text-sm font-medium">{label}</span>
									<button
										type="button"
										onClick={() => onEnable(agentType)}
										disabled={isEnabling}
										className="inline-flex h-7 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
									>
										{isEnabling ? 'Enabling...' : 'Enable Agent'}
									</button>
								</div>
							);
						})}
					</div>
				</div>
			)}

			<AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Agent Config</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete the config for <strong>{deleteTarget?.label}</strong>?
							The agent will be disabled and no longer process any events. This action cannot be
							undone.
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
	projectId: string;
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
	projectModel: string | null;
	projectEngine: string | null;
	projectMaxIterations: number | null;
	systemDefaults: SystemDefaults | undefined;
}

function AgentDetailView({
	agentType,
	projectId,
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
	projectModel,
	projectEngine,
	projectMaxIterations,
	systemDefaults,
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
				projectId={projectId}
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
				projectModel={projectModel}
				projectEngine={projectEngine}
				projectMaxIterations={projectMaxIterations}
				systemDefaults={systemDefaults}
			/>
		</div>
	);
}

// ============================================================================
// Main Component
// ============================================================================

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: orchestrates multiple queries, mutations, and list/detail navigation with agent config and trigger data transformation
export function ProjectAgentConfigs({ projectId }: { projectId: string }) {
	const queryClient = useQueryClient();

	// Agent configs query
	const configsQuery = useQuery(trpc.agentConfigs.list.queryOptions({ projectId }));
	const enginesQuery = useQuery(trpc.agentConfigs.engines.queryOptions());

	// Project-level defaults (for inheritance chain display)
	const projectQuery = useQuery(trpc.projects.getById.queryOptions({ id: projectId }));
	const defaultsQuery = useQuery({
		...trpc.projects.defaults.queryOptions(),
		staleTime: Number.POSITIVE_INFINITY,
	});

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
			engineSettings: Record<string, Record<string, unknown>> | null;
			maxConcurrency: number | null;
			systemPrompt: string | null;
			taskPrompt: string | null;
		}) =>
			trpcClient.agentConfigs.create.mutate({
				projectId,
				agentType: input.agentType,
				model: input.model,
				maxIterations: input.maxIterations,
				agentEngine: input.agentEngine,
				engineSettings: input.engineSettings,
				maxConcurrency: input.maxConcurrency,
				systemPrompt: input.systemPrompt,
				taskPrompt: input.taskPrompt,
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
			engineSettings: Record<string, Record<string, unknown>> | null;
			maxConcurrency: number | null;
			systemPrompt: string | null;
			taskPrompt: string | null;
		}) =>
			trpcClient.agentConfigs.update.mutate({
				id: input.id,
				agentType: input.agentType,
				model: input.model,
				maxIterations: input.maxIterations,
				agentEngine: input.agentEngine,
				engineSettings: input.engineSettings,
				maxConcurrency: input.maxConcurrency,
				systemPrompt: input.systemPrompt,
				taskPrompt: input.taskPrompt,
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
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: configsQueryKey });
			queryClient.invalidateQueries({ queryKey: triggersViewQueryKey });
		},
		onError: (err) => {
			toast.error('Failed to delete agent config', { description: err.message });
		},
	});

	// Enable an agent by creating a bare agent_configs row (no overrides = project defaults)
	const enableAgentMutation = useMutation({
		mutationFn: (agentType: string) =>
			trpcClient.agentConfigs.create.mutate({
				projectId,
				agentType,
				model: null,
				maxIterations: null,
				agentEngine: null,
				engineSettings: null,
				maxConcurrency: null,
				systemPrompt: null,
				taskPrompt: null,
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: configsQueryKey });
			queryClient.invalidateQueries({ queryKey: triggersViewQueryKey });
			toast.success('Agent enabled');
		},
		onError: (err) => {
			toast.error('Failed to enable agent', { description: err.message });
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

	// Project-level and system-level defaults for inheritance display
	const projectData = projectQuery.data;
	const systemDefaults = defaultsQuery.data
		? {
				model: defaultsQuery.data.model,
				maxIterations: defaultsQuery.data.maxIterations,
				agentEngine: defaultsQuery.data.agentEngine,
				engineSettings: defaultsQuery.data.engineSettings as Record<
					string,
					Record<string, unknown>
				>,
			}
		: undefined;
	const projectModel = projectData?.model ?? null;
	const projectEngine = projectData?.agentEngine ?? null;
	const projectMaxIterations = projectData?.maxIterations ?? null;

	// Build agent config map
	const configByAgent = new Map<string, AgentConfig>();
	for (const c of configs) {
		configByAgent.set(c.agentType, c);
	}

	// Build triggers map from API — use enabledAgents (configured agents only)
	const triggersByAgent = new Map<string, ResolvedTrigger[]>();
	const triggersViewIntegrations = triggersViewQuery.data?.integrations ?? {
		pm: null,
		scm: null,
	};
	if (triggersViewQuery.data) {
		const agentsList = triggersViewQuery.data.enabledAgents ?? triggersViewQuery.data.agents ?? [];
		for (const agent of agentsList) {
			triggersByAgent.set(agent.agentType, agent.triggers as ResolvedTrigger[]);
		}
	}

	// Available (unconfigured) agent types
	const availableAgentTypes = triggersViewQuery.data?.availableAgents ?? [];

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: save handler dispatches create vs update, builds payload from many optional fields, and chains trigger upsert
	const handleSaveConfig = (type: string, configId: number | null, values: SaveConfigValues) => {
		setSavingAgentType(type);
		const activeEngine = values.agentEngine || null;
		const activeEngineSettings =
			activeEngine && values.engineSettings?.[activeEngine]
				? { [activeEngine]: values.engineSettings[activeEngine] }
				: null;
		const payload = {
			agentType: type,
			model: values.model || null,
			maxIterations: values.maxIterations ? Number(values.maxIterations) : null,
			agentEngine: activeEngine,
			engineSettings: activeEngineSettings,
			maxConcurrency: values.maxConcurrency ? Number(values.maxConcurrency) : null,
			// When the user explicitly cleared an override, send null to remove it server-side.
			// Otherwise fall back to empty-string → null conversion for unpopulated fields.
			systemPrompt: values.systemPromptCleared ? null : values.systemPrompt || null,
			taskPrompt: values.taskPromptCleared ? null : values.taskPrompt || null,
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

	// Get list of enabled agent types to display
	const enabledAgentTypes = Array.from(triggersByAgent.keys());

	// Render detail view when an agent is selected
	if (selectedAgent !== null) {
		return (
			<AgentDetailView
				agentType={selectedAgent}
				projectId={projectId}
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
				projectModel={projectModel}
				projectEngine={projectEngine}
				projectMaxIterations={projectMaxIterations}
				systemDefaults={systemDefaults}
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
				enabledAgentTypes={enabledAgentTypes}
				availableAgentTypes={availableAgentTypes}
				configByAgent={configByAgent}
				triggersByAgent={triggersByAgent}
				integrations={triggersViewIntegrations}
				onSelect={setSelectedAgent}
				onDelete={(id) => deleteMutation.mutate(id)}
				onEnable={(agentType) => enableAgentMutation.mutate(agentType)}
				isDeleting={deleteMutation.isPending}
				isEnabling={enableAgentMutation.isPending}
				projectModel={projectModel}
				projectEngine={projectEngine}
				systemDefaults={systemDefaults}
			/>
		</div>
	);
}
