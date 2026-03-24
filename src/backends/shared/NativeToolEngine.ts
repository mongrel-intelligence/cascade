/**
 * NativeToolEngine — abstract base class for subprocess-based agent engines.
 *
 * Extracts shared patterns common to Claude Code, Codex, and OpenCode engines:
 * - Environment building via buildEngineEnv with engine-specific allowlists
 * - Context file cleanup in afterExecute
 * - supportsAgentType returning true (all native-tool engines support every agent type)
 *
 * Each concrete engine subclass must implement:
 *   - definition — the engine's AgentEngineDefinition
 *   - getAllowedEnvExact() — engine-specific env var allowlist
 *   - getExtraEnvVars() — unconditionally injected env vars (e.g. CI=true)
 *   - resolveEngineModel() — cascade model string → engine-specific model identifier
 *   - execute() — the actual subprocess execution logic
 *
 * LLMist stays separate — it is an in-process SDK, fundamentally different from
 * the subprocess pattern captured here.
 */

import type { z } from 'zod';
import { getEngineSettings } from '../../config/engineSettings.js';
import type {
	AgentEngine,
	AgentEngineDefinition,
	AgentEngineResult,
	AgentExecutionPlan,
} from '../types.js';
import { cleanupContextFiles } from './contextFiles.js';
import { buildEngineEnv } from './envBuilder.js';

export abstract class NativeToolEngine implements AgentEngine {
	// -------------------------------------------------------------------------
	// Abstract members — subclasses must implement these
	// -------------------------------------------------------------------------

	abstract readonly definition: AgentEngineDefinition;

	/**
	 * Engine-specific exact-match env var allowlist.
	 * Merged on top of the shared set by buildEnv().
	 */
	abstract getAllowedEnvExact(): Set<string>;

	/**
	 * Extra env vars injected unconditionally into every subprocess
	 * (e.g. { CI: 'true', CODEX_DISABLE_UPDATE_NOTIFIER: '1' }).
	 */
	abstract getExtraEnvVars(): Record<string, string>;

	/**
	 * Resolve a CASCADE model string to the engine-specific model identifier.
	 * Throw an Error if the model is incompatible with this engine.
	 */
	abstract resolveEngineModel(cascadeModel: string): string;

	// -------------------------------------------------------------------------
	// Shared / template methods
	// -------------------------------------------------------------------------

	/**
	 * Delegates to resolveEngineModel so the AgentEngine.resolveModel() contract is
	 * satisfied without requiring subclasses to remember to call super.
	 */
	resolveModel(cascadeModel: string): string {
		return this.resolveEngineModel(cascadeModel);
	}

	/**
	 * All native-tool engines support every agent type.
	 * Override in a subclass only if you need to restrict this.
	 */
	supportsAgentType(_agentType: string): boolean {
		return true;
	}

	/**
	 * Build a sanitised environment record for the subprocess.
	 *
	 * Calls buildEngineEnv with:
	 * - allowedEnvExact from getAllowedEnvExact()
	 * - extraVars from getExtraEnvVars()
	 * - projectSecrets and path dirs from the execution plan
	 */
	buildEnv(
		projectSecrets?: Record<string, string>,
		cliToolsDir?: string,
		nativeToolShimDir?: string,
	): Record<string, string | undefined> {
		return buildEngineEnv({
			allowedEnvExact: this.getAllowedEnvExact(),
			extraVars: this.getExtraEnvVars(),
			projectSecrets,
			cliToolsDir,
			nativeToolShimDir,
		});
	}

	/**
	 * Clean up offloaded context files after execution.
	 * Engines that need additional cleanup should override this method and
	 * call super.afterExecute() to ensure context files are removed.
	 */
	async afterExecute(plan: AgentExecutionPlan, _result: AgentEngineResult): Promise<void> {
		await cleanupContextFiles(plan.repoDir);
	}

	/**
	 * Resolve engine-specific settings from an execution plan.
	 *
	 * Reads from `input.engineSettings ?? input.project.engineSettings` and
	 * validates the result against `schema`. Returns `{}` (empty object typed
	 * as `z.infer<S>`) when no settings are configured for this engine.
	 *
	 * Subclasses should call this inside `execute()` with their own schema,
	 * passing the engine id via `this.definition.id`:
	 *
	 * ```ts
	 * const raw = this.resolveSettings(input, MyEngineSettingsSchema);
	 * ```
	 */
	protected resolveSettings<S extends z.ZodType<Record<string, unknown>>>(
		input: AgentExecutionPlan,
		schema: S,
	): z.infer<S> {
		const effectiveSettings = input.engineSettings ?? input.project.engineSettings;
		return getEngineSettings(effectiveSettings, this.definition.id, schema) ?? ({} as z.infer<S>);
	}

	/**
	 * Subclasses must provide the actual subprocess execution logic.
	 */
	abstract execute(input: AgentExecutionPlan): Promise<AgentEngineResult>;
}
