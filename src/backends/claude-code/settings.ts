import { z } from 'zod';
import { getEngineSettings } from '../../config/engineSettings.js';
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

export function resolveClaudeCodeSettings(project: ProjectConfig): ResolvedClaudeCodeSettings {
	const claudeCode =
		getEngineSettings(project.engineSettings, 'claude-code', ClaudeCodeSettingsSchema) ?? {};

	return {
		effort: claudeCode.effort ?? 'high',
		thinking: claudeCode.thinking ?? 'adaptive',
		thinkingBudgetTokens: claudeCode.thinkingBudgetTokens,
	};
}
