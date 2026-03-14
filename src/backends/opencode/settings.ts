import { OpenCodeSettingsSchema, getEngineSettings } from '../../config/engineSettings.js';
import type { OpenCodeSettings } from '../../config/engineSettings.js';
import type { ProjectConfig } from '../../types/index.js';

export interface ResolvedOpenCodeSettings extends Required<Pick<OpenCodeSettings, 'webSearch'>> {}

export function resolveOpenCodeSettings(project: ProjectConfig): ResolvedOpenCodeSettings {
	const opencode =
		getEngineSettings(project.engineSettings, 'opencode', OpenCodeSettingsSchema) ?? {};

	return {
		webSearch: opencode.webSearch ?? false,
	};
}
