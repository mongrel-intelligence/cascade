import {
	CodexSettingsSchema,
	getEngineSettings,
	mergeEngineSettings,
} from '../../config/engineSettings.js';
import type { CodexSettings, EngineSettings } from '../../config/engineSettings.js';
import type { CascadeConfig, ProjectConfig } from '../../types/index.js';

export interface ResolvedCodexSettings
	extends Required<Pick<CodexSettings, 'approvalPolicy' | 'sandboxMode' | 'webSearch'>> {
	reasoningEffort?: CodexSettings['reasoningEffort'];
}

function getDefaultsFromCapabilities(
	nativeToolCapabilities?: string[],
): Pick<ResolvedCodexSettings, 'sandboxMode'> {
	const canWrite = nativeToolCapabilities?.includes('fs:write') ?? false;
	return {
		sandboxMode: canWrite ? 'workspace-write' : 'read-only',
	};
}

export function resolveCodexSettings(
	project: ProjectConfig,
	config: CascadeConfig,
	nativeToolCapabilities?: string[],
): ResolvedCodexSettings {
	const merged: EngineSettings | undefined = mergeEngineSettings(
		config.defaults.engineSettings,
		project.engineSettings,
	);
	const codex = getEngineSettings(merged, 'codex', CodexSettingsSchema) ?? {};
	const defaults = getDefaultsFromCapabilities(nativeToolCapabilities);

	return {
		approvalPolicy: codex.approvalPolicy ?? 'never',
		sandboxMode: codex.sandboxMode ?? defaults.sandboxMode,
		reasoningEffort: codex.reasoningEffort,
		webSearch: codex.webSearch ?? false,
	};
}

export function assertHeadlessCodexSettings(settings: ResolvedCodexSettings): void {
	if (settings.approvalPolicy !== 'never') {
		throw new Error(
			`Codex automation requires approvalPolicy="never"; received "${settings.approvalPolicy}"`,
		);
	}
}
