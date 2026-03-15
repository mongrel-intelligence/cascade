import { z } from 'zod';
import { type EngineSettings, getEngineSettings } from '../../config/engineSettings.js';
import type { ProjectConfig } from '../../types/index.js';

export const OPENCODE_SETTING_DEFAULTS = {
	webSearch: false,
};

export const OpenCodeSettingsSchema = z.object({
	webSearch: z.boolean().optional(),
});

export type OpenCodeSettings = z.infer<typeof OpenCodeSettingsSchema>;

export interface ResolvedOpenCodeSettings extends Required<Pick<OpenCodeSettings, 'webSearch'>> {}

/**
 * Resolve OpenCode settings from the given engine settings, falling back to
 * project-level settings when no explicit override is provided.
 *
 * @param project - The project config (used as fallback when engineSettings is not provided)
 * @param engineSettings - Optional pre-merged engine settings (e.g. from AgentExecutionPlan).
 *   When provided, these take precedence over project.engineSettings.
 */
export function resolveOpenCodeSettings(
	project: ProjectConfig,
	engineSettings?: EngineSettings,
): ResolvedOpenCodeSettings {
	const effectiveSettings = engineSettings ?? project.engineSettings;
	const opencode = getEngineSettings(effectiveSettings, 'opencode', OpenCodeSettingsSchema) ?? {};

	return {
		webSearch: opencode.webSearch ?? OPENCODE_SETTING_DEFAULTS.webSearch,
	};
}
