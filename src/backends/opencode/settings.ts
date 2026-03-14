import { z } from 'zod';
import { getEngineSettings } from '../../config/engineSettings.js';
import type { ProjectConfig } from '../../types/index.js';

export const OpenCodeSettingsSchema = z.object({
	webSearch: z.boolean().optional(),
});

export type OpenCodeSettings = z.infer<typeof OpenCodeSettingsSchema>;

export interface ResolvedOpenCodeSettings extends Required<Pick<OpenCodeSettings, 'webSearch'>> {}

export function resolveOpenCodeSettings(project: ProjectConfig): ResolvedOpenCodeSettings {
	const opencode =
		getEngineSettings(project.engineSettings, 'opencode', OpenCodeSettingsSchema) ?? {};

	return {
		webSearch: opencode.webSearch ?? false,
	};
}
