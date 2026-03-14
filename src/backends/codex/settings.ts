import { CodexSettingsSchema, getEngineSettings } from '../../config/engineSettings.js';
import type { CodexSettings } from '../../config/engineSettings.js';
import type { ProjectConfig } from '../../types/index.js';

export interface ResolvedCodexSettings
	extends Required<Pick<CodexSettings, 'approvalPolicy' | 'sandboxMode' | 'webSearch'>> {
	reasoningEffort?: CodexSettings['reasoningEffort'];
}

function getDefaultsFromCapabilities(
	_nativeToolCapabilities?: string[],
): Pick<ResolvedCodexSettings, 'sandboxMode'> {
	// Default to full access — Codex always runs inside an ephemeral Docker
	// container, so network/filesystem isolation is enforced at the container
	// level rather than by Codex's own sandbox.
	return { sandboxMode: 'danger-full-access' };
}

export function resolveCodexSettings(
	project: ProjectConfig,
	nativeToolCapabilities?: string[],
): ResolvedCodexSettings {
	const codex = getEngineSettings(project.engineSettings, 'codex', CodexSettingsSchema) ?? {};
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
