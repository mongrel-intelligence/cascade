import { z } from 'zod';
import { type EngineSettings, getEngineSettings } from '../../config/engineSettings.js';
import type { ProjectConfig } from '../../types/index.js';

export const CODEX_SETTING_DEFAULTS = {
	approvalPolicy: 'never' as const,
	sandboxMode: 'danger-full-access' as const,
	webSearch: false,
};

export const CodexSettingsSchema = z.object({
	approvalPolicy: z.enum(['never', 'on-request', 'untrusted']).optional(),
	sandboxMode: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional(),
	reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
	webSearch: z.boolean().optional(),
});

export type CodexSettings = z.infer<typeof CodexSettingsSchema>;

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
	return { sandboxMode: CODEX_SETTING_DEFAULTS.sandboxMode };
}

/**
 * Resolve Codex settings from the given engine settings, falling back to
 * project-level settings when no explicit override is provided.
 *
 * @param project - The project config (used as fallback when engineSettings is not provided)
 * @param nativeToolCapabilities - Optional agent capabilities used to derive sandbox defaults
 * @param engineSettings - Optional pre-merged engine settings (e.g. from AgentExecutionPlan).
 *   When provided, these take precedence over project.engineSettings.
 */
export function resolveCodexSettings(
	project: ProjectConfig,
	nativeToolCapabilities?: string[],
	engineSettings?: EngineSettings,
): ResolvedCodexSettings {
	const effectiveSettings = engineSettings ?? project.engineSettings;
	const codex = getEngineSettings(effectiveSettings, 'codex', CodexSettingsSchema) ?? {};
	const defaults = getDefaultsFromCapabilities(nativeToolCapabilities);

	return {
		approvalPolicy: codex.approvalPolicy ?? CODEX_SETTING_DEFAULTS.approvalPolicy,
		sandboxMode: codex.sandboxMode ?? defaults.sandboxMode,
		reasoningEffort: codex.reasoningEffort,
		webSearch: codex.webSearch ?? CODEX_SETTING_DEFAULTS.webSearch,
	};
}

export function assertHeadlessCodexSettings(settings: ResolvedCodexSettings): void {
	if (settings.approvalPolicy !== 'never') {
		throw new Error(
			`Codex automation requires approvalPolicy="never"; received "${settings.approvalPolicy}"`,
		);
	}
}
