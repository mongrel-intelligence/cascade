import {
	OpenCodeSettingsSchema,
	getEngineSettings,
	mergeEngineSettings,
} from '../../config/engineSettings.js';
import type { EngineSettings, OpenCodeSettings } from '../../config/engineSettings.js';
import type { CascadeConfig, ProjectConfig } from '../../types/index.js';

export interface ResolvedOpenCodeSettings
	extends Required<Pick<OpenCodeSettings, 'agent' | 'webSearch'>> {}

export function resolveOpenCodeSettings(
	project: ProjectConfig,
	config: CascadeConfig,
): ResolvedOpenCodeSettings {
	const merged: EngineSettings | undefined = mergeEngineSettings(
		config.defaults.engineSettings,
		project.engineSettings,
	);
	const opencode = getEngineSettings(merged, 'opencode', OpenCodeSettingsSchema) ?? {};

	return {
		agent: opencode.agent ?? 'auto',
		webSearch: opencode.webSearch ?? false,
	};
}
