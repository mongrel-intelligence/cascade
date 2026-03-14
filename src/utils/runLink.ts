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
