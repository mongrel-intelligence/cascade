import { z } from 'zod';
import { type EngineSettings, getEngineSettings } from '../../config/engineSettings.js';
import type { ProjectConfig } from '../../types/index.js';

export const ClaudeCodeSettingsSchema = z.object({
	effort: z.enum(['low', 'medium', 'high', 'max']).optional(),
	thinking: z.enum(['adaptive', 'enabled', 'disabled']).optional(),
	// TODO: Frontend 'number' field type is not yet supported (Story #2).
	// This field is defined here for catalog registration; the dashboard will
	// render it once numeric fields are implemented.
	thinkingBudgetTokens: z.number().int().positive().optional(),
});

export type ClaudeCodeSettings = z.infer<typeof ClaudeCodeSettingsSchema>;

export interface ResolvedClaudeCodeSettings {
	effort: NonNullable<ClaudeCodeSettings['effort']>;
	thinking: NonNullable<ClaudeCodeSettings['thinking']>;
	thinkingBudgetTokens?: ClaudeCodeSettings['thinkingBudgetTokens'];
}

/**
 * Resolve Claude Code settings from the given engine settings, falling back to
 * project-level settings when no explicit override is provided.
 *
 * @param project - The project config (used as fallback when engineSettings is not provided)
 * @param engineSettings - Optional pre-merged engine settings (e.g. from AgentExecutionPlan).
 *   When provided, these take precedence over project.engineSettings.
 */
export function resolveClaudeCodeSettings(
	project: ProjectConfig,
	engineSettings?: EngineSettings,
): ResolvedClaudeCodeSettings {
	const effectiveSettings = engineSettings ?? project.engineSettings;
	const claudeCode =
		getEngineSettings(effectiveSettings, 'claude-code', ClaudeCodeSettingsSchema) ?? {};

	return {
		effort: claudeCode.effort ?? 'high',
		thinking: claudeCode.thinking ?? 'adaptive',
		thinkingBudgetTokens: claudeCode.thinkingBudgetTokens,
	};
}
