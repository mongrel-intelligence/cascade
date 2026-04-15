/**
 * Agent detail view components: DefinitionAgentSection and AgentDetailView.
 * Renders the tabbed detail panel (Engine / Prompts / Triggers) for a single agent.
 */
import { ArrowLeft } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { EngineSettingsFields } from '@/components/settings/engine-settings-fields.js';
import { ModelField } from '@/components/settings/model-field.js';
import {
	DefinitionTriggerToggles,
	type ResolvedTrigger,
} from '@/components/shared/definition-trigger-toggles.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.js';
import { AGENT_LABELS, CATEGORY_LABELS } from '@/lib/trigger-agent-mapping.js';
import type { AgentDetailViewProps, DefinitionAgentSectionProps } from './agent-config-types.js';
import { AgentPromptOverrides } from './agent-prompt-overrides.js';

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
	const inheritedEngine = projectEngine ?? systemDefaults?.agentEngine ?? 'claude-code';
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
					<div className="space-y-2">
						<Label htmlFor={`${agentType}-model`}>Model</Label>
						<ModelField
							id={`${agentType}-model`}
							value={model}
							onChange={setModel}
							engine={agentEngine}
							defaultLabel={inheritedModel ? `Inherit from project (${inheritedModel})` : undefined}
							projectId={projectId}
						/>
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
					<div className="grid grid-cols-2 gap-4">
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
					</div>
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

export function AgentDetailView({
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
