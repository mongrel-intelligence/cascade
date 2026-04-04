/**
 * Shared types for the agent configuration components.
 *
 * Extracted from project-agent-configs.tsx so each sub-module can import
 * only what it needs without circular dependencies.
 */

import type { ResolvedTrigger } from '@/components/shared/definition-trigger-toggles.js';
import type { TriggerParameterValue } from '@/lib/trigger-agent-mapping.js';

export interface AgentConfig {
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

export type EngineSettingField =
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

export interface Engine {
	id: string;
	label: string;
	settings?: {
		title?: string;
		description?: string;
		fields: EngineSettingField[];
	};
}

export interface SaveConfigValues {
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

export interface SystemDefaults {
	model: string;
	maxIterations: number;
	agentEngine: string;
	engineSettings: Record<string, Record<string, unknown>>;
}

export interface DefinitionAgentSectionProps {
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

export interface AgentRowProps {
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
	/** Set of credential env-var keys that are configured for this project. */
	configuredCredentialKeys: Set<string>;
}

export interface AgentListViewProps {
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
	/** Set of credential env-var keys that are configured for this project. */
	configuredCredentialKeys: Set<string>;
}

export interface AgentDetailViewProps {
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
