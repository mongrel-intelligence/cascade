import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import type { ResolvedTrigger } from '@/components/shared/definition-trigger-toggles.js';
import type { TriggerParameterValue } from '@/lib/trigger-agent-mapping.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { AgentDetailView } from './agent-config-detail.js';
import { AgentListView } from './agent-config-list.js';
import type {
	AgentConfig,
	Engine,
	SaveConfigValues,
	SystemDefaults,
} from './agent-config-types.js';

// ============================================================================
// Main Component
// ============================================================================

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: orchestrates multiple queries, mutations, and list/detail navigation with agent config and trigger data transformation
export function ProjectAgentConfigs({ projectId }: { projectId: string }) {
	const queryClient = useQueryClient();

	// Agent configs query
	const configsQuery = useQuery(trpc.agentConfigs.list.queryOptions({ projectId }));
	const enginesQuery = useQuery(trpc.agentConfigs.engines.queryOptions());

	// Credentials query — used to show missing-credentials warnings on agent rows
	const credentialsQuery = useQuery(trpc.projects.credentials.list.queryOptions({ projectId }));

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
	const systemDefaults: SystemDefaults | undefined = defaultsQuery.data
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

	// Build set of configured credential keys for missing-credentials detection on agent rows
	const configuredCredentialKeys = new Set<string>(
		(credentialsQuery.data ?? []).map((c: { envVarKey: string }) => c.envVarKey),
	);

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
				configuredCredentialKeys={configuredCredentialKeys}
			/>
		</div>
	);
}
