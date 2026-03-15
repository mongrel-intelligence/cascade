import { z } from 'zod';
import type { EngineSettings } from '../../config/engineSettings.js';
import { getEngineSettings } from '../../config/engineSettings.js';
import type { ProjectConfig } from '../../types/index.js';

export const ClaudeCodeSettingsSchema = z.object({
	effort: z.enum(['low', 'medium', 'high', 'max']).optional(),
	thinking: z.enum(['adaptive', 'enabled', 'disabled']).optional(),
	thinkingBudgetTokens: z.number().int().positive().optional(),
});

export type ClaudeCodeSettings = z.infer<typeof ClaudeCodeSettingsSchema>;

export interface ResolvedClaudeCodeSettings {
	effort?: ClaudeCodeSettings['effort'];
	thinking?: ClaudeCodeSettings['thinking'];
	thinkingBudgetTokens?: number;
}

/**
 * Resolve Claude Code engine settings from the merged engine settings.
 *
 * Uses `mergedSettings` when available (agent-config overrides already merged
 * into project-level settings by the adapter). Falls back to `project.engineSettings`
 * for backward compatibility when called directly (e.g., in tests).
 */
export function resolveClaudeCodeSettings(
	project: ProjectConfig,
	mergedSettings?: EngineSettings,
): ResolvedClaudeCodeSettings {
	const sourceSettings = mergedSettings ?? project.engineSettings;
	const claudeCode =
		getEngineSettings(sourceSettings, 'claude-code', ClaudeCodeSettingsSchema) ?? {};

	return {
		effort: claudeCode.effort,
		thinking: claudeCode.thinking,
		thinkingBudgetTokens: claudeCode.thinkingBudgetTokens,
	};
}
