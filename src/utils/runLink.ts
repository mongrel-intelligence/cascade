/**
 * Run link utility — builds subtle dashboard links for agent comments.
 *
 * Generates markdown footer lines that link agents' comments back to the
 * CASCADE dashboard run or work-item-runs page, making it easy to navigate
 * to the right run for debugging.
 *
 * All functions are pure or read-only (only reads env vars) and return
 * empty strings when the dashboard URL is unset or run links are disabled.
 */

/**
 * Read the CASCADE_DASHBOARD_URL env var.
 * Returns empty string if unset (graceful no-op).
 */
export function getDashboardUrl(): string {
	const url = process.env.CASCADE_DASHBOARD_URL;
	return url && url !== 'undefined' ? url : '';
}

/**
 * Shorten a model name for display.
 * Strips provider prefixes and long suffixes to keep the label concise.
 *
 * Examples:
 *   'openrouter:anthropic/claude-haiku-4.5' → 'claude-haiku-4.5'
 *   'anthropic:claude-sonnet-4-5-20250929'  → 'claude-sonnet-4-5-20250929'
 *   'claude-haiku-4.5'                      → 'claude-haiku-4.5'
 */
export function shortenModelName(model: string): string {
	if (!model) return model;

	// Strip provider prefix (e.g. 'openrouter:', 'anthropic:', 'gemini:')
	const withoutProvider = model.includes(':') ? model.split(':').slice(1).join(':') : model;

	// Strip sub-provider prefix for openrouter models (e.g. 'anthropic/claude-haiku-4.5' → 'claude-haiku-4.5')
	const withoutSubProvider = withoutProvider.includes('/')
		? withoutProvider.split('/').slice(1).join('/')
		: withoutProvider;

	return withoutSubProvider;
}

/**
 * Build a markdown run-details footer link.
 *
 * Format: `🕵️ engineLabel · modelShort · [run details](url)`
 *
 * Returns empty string if dashboardUrl is empty or runId is missing.
 */
export function buildRunLink({
	dashboardUrl,
	runId,
	engineLabel,
	model,
}: {
	dashboardUrl: string;
	runId: string;
	engineLabel: string;
	model: string;
}): string {
	if (!dashboardUrl || !runId) return '';

	const modelShort = shortenModelName(model);
	const url = `${dashboardUrl.replace(/\/$/, '')}/runs/${runId}`;

	const parts = [engineLabel, modelShort].filter(Boolean).join(' · ');
	return `\n\n---\n🕵️ ${parts} · [run details](${url})`;
}

/**
 * Build a markdown work-item-runs footer link.
 * Used at ack time when a runId is not yet available.
 *
 * Format: `🕵️ engineLabel · modelShort · [run details](url)`
 *
 * Returns empty string if dashboardUrl, projectId, or workItemId is missing.
 */
export function buildWorkItemRunsLink({
	dashboardUrl,
	projectId,
	workItemId,
	engineLabel,
	model,
}: {
	dashboardUrl: string;
	projectId: string;
	workItemId: string;
	engineLabel?: string;
	model?: string;
}): string {
	if (!dashboardUrl || !projectId || !workItemId) return '';

	const url = `${dashboardUrl.replace(/\/$/, '')}/work-items/${projectId}/${workItemId}`;
	const modelShort = model ? shortenModelName(model) : '';
	const parts = [engineLabel, modelShort].filter(Boolean).join(' · ');
	const label = parts ? `${parts} · [run details](${url})` : `[run details](${url})`;
	return `\n\n---\n🕵️ ${label}`;
}

/**
 * Build the run link footer by reading env vars injected by the secretBuilder
 * for subprocess agents (claude-code/codex/opencode).
 *
 * The optional `workItemId` parameter is used as fallback when no runId is
 * available (e.g. postComment gadget which knows the target work item).
 *
 * Returns empty string when run links are disabled or CASCADE_DASHBOARD_URL
 * is unset — graceful no-op.
 */
export function buildRunLinkFooterFromEnv(workItemId?: string): string {
	if (process.env.CASCADE_RUN_LINKS_ENABLED !== 'true') return '';
	const dashboardUrl = getDashboardUrl();
	if (!dashboardUrl) return '';

	const runId = process.env.CASCADE_RUN_ID;
	const engineLabel = process.env.CASCADE_ENGINE_LABEL ?? '';
	const model = process.env.CASCADE_MODEL ?? '';
	const projectId = process.env.CASCADE_PROJECT_ID ?? '';
	const resolvedWorkItemId = workItemId ?? process.env.CASCADE_WORK_ITEM_ID ?? '';

	if (runId) {
		return buildRunLink({ dashboardUrl, runId, engineLabel, model });
	}
	if (projectId && resolvedWorkItemId) {
		return buildWorkItemRunsLink({
			dashboardUrl,
			projectId,
			workItemId: resolvedWorkItemId,
			engineLabel,
			model,
		});
	}
	return '';
}
