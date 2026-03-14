import type { AgentInput, CascadeConfig, ProjectConfig } from '../types/index.js';
import type { CompletionRequirements } from './completion.js';

// Re-export shared contracts so downstream code that imports from here continues to work.
export type {
	ContextInjection,
	LogWriter,
	ProgressReporter,
	ToolManifest,
} from '../agents/contracts/index.js';

import type {
	ContextInjection,
	LogWriter,
	ProgressReporter,
	ToolManifest,
} from '../agents/contracts/index.js';

/**
 * Shared execution context created by the platform lifecycle.
 */
export interface AgentExecutionContext {
	agentType: string;
	project: ProjectConfig;
	config: CascadeConfig;
	repoDir: string;
	agentInput: AgentInput;
	progressReporter: ProgressReporter;
	logWriter: LogWriter;
	/** Per-project secrets to inject into subprocess environment */
	projectSecrets?: Record<string, string>;
	/** Database run ID for real-time LLM call logging */
	runId?: string;
}

/**
 * Prompt material normalized by the shared lifecycle before engine execution.
 */
export interface AgentPromptSpec {
	systemPrompt: string;
	taskPrompt: string;
	availableTools: ToolManifest[];
	contextInjections: ContextInjection[];
}

/**
 * Engine policy resolved by shared orchestration.
 */
export interface AgentEnginePolicy {
	maxIterations: number;
	budgetUsd?: number;
	model: string;
	/** Engine-neutral capability list used to derive native tools per engine */
	nativeToolCapabilities?: string[];
	/** Whether to enable stop hooks that check for uncommitted/unpushed changes (defaults to true) */
	enableStopHooks?: boolean;
	/** Whether to block git push in hooks (defaults to true) */
	blockGitPush?: boolean;
	/** Path where the llmist SDK should write its structured log (workspace dir, not temp) */
	engineLogPath?: string;
}

/**
 * Fully normalized execution plan passed to an engine implementation.
 */
export interface AgentExecutionPlan
	extends AgentExecutionContext,
		AgentPromptSpec,
		AgentEnginePolicy {
	cliToolsDir: string;
	nativeToolShimDir?: string;
	completionRequirements?: CompletionRequirements;
}

export type PrEvidenceSource = 'llmist-session' | 'native-tool-sidecar' | 'text';

export interface PrEvidence {
	source: PrEvidenceSource;
	authoritative: boolean;
	command?: string;
}

/**
 * Result returned by an AgentEngine after execution.
 */
export interface AgentEngineResult {
	success: boolean;
	output: string;
	prUrl?: string;
	prEvidence?: PrEvidence;
	error?: string;
	cost?: number;
	logBuffer?: Buffer;
	runId?: string;
}

export interface AgentEngineSettingFieldOption {
	value: string;
	label: string;
}

export type AgentEngineSettingField =
	| {
			key: string;
			label: string;
			type: 'select';
			description?: string;
			options: ReadonlyArray<AgentEngineSettingFieldOption>;
	  }
	| {
			key: string;
			label: string;
			type: 'boolean';
			description?: string;
	  };

export interface AgentEngineSettingsDefinition {
	title?: string;
	description?: string;
	fields: ReadonlyArray<AgentEngineSettingField>;
}

/**
 * Describes how an engine should be presented and configured by callers/UI.
 */
export interface AgentEngineDefinition {
	readonly id: string;
	readonly label: string;
	readonly description: string;
	readonly capabilities: string[];
	readonly modelSelection:
		| { type: 'free-text' }
		| {
				type: 'select';
				defaultValueLabel: string;
				options: ReadonlyArray<{ value: string; label: string }>;
		  };
	readonly logLabel: string;
	readonly settings?: AgentEngineSettingsDefinition;
}

/**
 * Interface that all agent engines must implement.
 */
export interface AgentEngine {
	readonly definition: AgentEngineDefinition;

	execute(input: AgentExecutionPlan): Promise<AgentEngineResult>;
	supportsAgentType(agentType: string): boolean;
	/**
	 * Optionally resolve a CASCADE model string to the engine-specific model identifier.
	 * Engines that need model validation (e.g., Claude Code, Codex) implement this method.
	 * Engines that pass the model through unchanged (e.g., LLMist) do not need to implement it.
	 */
	resolveModel?(cascadeModel: string): string;
	/**
	 * Optional hook called by the adapter before engine.execute().
	 * Use for engine-specific environment setup (e.g., writing auth files, checking directories).
	 * LLMist does not implement this hook.
	 */
	beforeExecute?(plan: AgentExecutionPlan): Promise<void>;
	/**
	 * Optional hook called by the adapter after engine.execute(), in a finally block.
	 * Use for engine-specific cleanup (e.g., removing temp files, killing subprocesses).
	 * LLMist does not implement this hook.
	 */
	afterExecute?(plan: AgentExecutionPlan, result: AgentEngineResult): Promise<void>;
}
