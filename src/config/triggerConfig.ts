import { z } from 'zod';

// ============================================================================
// Trigger Config Schemas
// ============================================================================

/**
 * Per-agent ready-to-process label configuration.
 * Each agent type can independently toggle whether the label trigger fires for it.
 */
export const ReadyToProcessLabelSchema = z
	.union([
		z.boolean(),
		z.object({
			briefing: z.boolean().default(true),
			planning: z.boolean().default(true),
			implementation: z.boolean().default(true),
		}),
	])
	.optional();

export type ReadyToProcessLabelConfig = z.infer<typeof ReadyToProcessLabelSchema>;

/**
 * Trigger configuration for Trello integrations.
 * All triggers default to `true` for backward compatibility.
 */
export const TrelloTriggerConfigSchema = z.object({
	cardMovedToBriefing: z.boolean().default(true),
	cardMovedToPlanning: z.boolean().default(true),
	cardMovedToTodo: z.boolean().default(true),
	readyToProcessLabel: ReadyToProcessLabelSchema,
	commentMention: z.boolean().default(true),
});

/**
 * Trigger configuration for JIRA integrations.
 * All triggers default to `true` for backward compatibility.
 */
export const JiraTriggerConfigSchema = z.object({
	issueTransitioned: z.boolean().default(true),
	readyToProcessLabel: ReadyToProcessLabelSchema,
	commentMention: z.boolean().default(true),
});

/**
 * Controls which PRs trigger the review agent.
 * - `own`: CI passes on a PR authored by the implementer persona
 * - `all`: CI passes on any PR (non-implementer PRs included)
 * - `reviewRequested`: review is explicitly requested from a CASCADE persona
 * Modes compose — e.g., `['own', 'reviewRequested']` enables both.
 * Default: `['reviewRequested']` — review only fires when explicitly requested.
 */
export const ReviewScopeSchema = z
	.array(z.enum(['own', 'all', 'reviewRequested']))
	.default(['reviewRequested']);

export type ReviewScope = z.infer<typeof ReviewScopeSchema>;

/**
 * Trigger configuration for GitHub integrations.
 */
export const GitHubTriggerConfigSchema = z.object({
	checkSuiteFailure: z.boolean().default(true),
	prReviewSubmitted: z.boolean().default(true),
	prCommentMention: z.boolean().default(true),
	prReadyToMerge: z.boolean().default(true),
	prMerged: z.boolean().default(true),
	/** Controls which PRs trigger the review agent. See ReviewScopeSchema for options. */
	reviewScope: ReviewScopeSchema,
});

export type TrelloTriggerConfig = z.infer<typeof TrelloTriggerConfigSchema>;
export type JiraTriggerConfig = z.infer<typeof JiraTriggerConfigSchema>;
export type GitHubTriggerConfig = z.infer<typeof GitHubTriggerConfigSchema>;

// ============================================================================
// Review Scope Helper
// ============================================================================

/**
 * Returns whether the given reviewScope array includes the specified mode.
 */
export function isReviewScopeEnabled(scope: ReviewScope, mode: ReviewScope[number]): boolean {
	return scope.includes(mode);
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Resolve whether a Trello trigger is enabled based on project trigger config.
 * Returns `true` (enabled) when no config is present (backward compatible).
 */
export function resolveTrelloTriggerEnabled(
	config: Partial<TrelloTriggerConfig> | undefined,
	key: keyof TrelloTriggerConfig,
): boolean {
	if (!config) return true;
	const value = config[key];
	if (key === 'readyToProcessLabel') {
		// For the readyToProcessLabel key, check if it's enabled at all (any agent)
		// This is only used for the outer "does anything use this?" check
		const rtp = value as ReadyToProcessLabelConfig;
		if (rtp === undefined) return true;
		if (typeof rtp === 'boolean') return rtp;
		return rtp.briefing || rtp.planning || rtp.implementation;
	}
	return value === undefined ? true : (value as boolean);
}

/**
 * Resolve whether the ready-to-process trigger is enabled for a specific agent type.
 * Supports both the new nested object format and the legacy boolean format.
 * Returns `true` when no config is present (backward compatible).
 */
export function resolveReadyToProcessEnabled(
	config: Partial<TrelloTriggerConfig> | Partial<JiraTriggerConfig> | undefined,
	agentType: string,
): boolean {
	if (!config) return true;
	const rtp = config.readyToProcessLabel as ReadyToProcessLabelConfig;
	if (rtp === undefined) return true;
	if (typeof rtp === 'boolean') {
		// Legacy: boolean applies to all agents
		return rtp;
	}
	// Nested object: check per-agent toggle
	if (agentType === 'briefing') return rtp.briefing ?? true;
	if (agentType === 'planning') return rtp.planning ?? true;
	if (agentType === 'implementation') return rtp.implementation ?? true;
	// Unknown agent type — default to enabled
	return true;
}

/**
 * Resolve whether a JIRA trigger is enabled based on project trigger config.
 * Returns `true` (enabled) when no config is present (backward compatible).
 */
export function resolveJiraTriggerEnabled(
	config: Partial<JiraTriggerConfig> | undefined,
	key: keyof JiraTriggerConfig,
): boolean {
	if (!config) return true;
	const value = config[key];
	if (key === 'readyToProcessLabel') {
		const rtp = value as ReadyToProcessLabelConfig;
		if (rtp === undefined) return true;
		if (typeof rtp === 'boolean') return rtp;
		return rtp.briefing || rtp.planning || rtp.implementation;
	}
	return value === undefined ? true : (value as boolean);
}

/** Boolean-only keys from GitHubTriggerConfig (excludes array fields like reviewScope). */
type GitHubBooleanTriggerKey = {
	[K in keyof GitHubTriggerConfig]: GitHubTriggerConfig[K] extends boolean ? K : never;
}[keyof GitHubTriggerConfig];

/**
 * Resolve whether a GitHub trigger is enabled based on project trigger config.
 * Returns `true` (enabled) when no config is present (backward compatible).
 * Only accepts boolean trigger keys — use `resolveReviewScope` for array-typed fields.
 */
export function resolveGitHubTriggerEnabled(
	config: Partial<GitHubTriggerConfig> | undefined,
	key: GitHubBooleanTriggerKey,
): boolean {
	if (!config) return true;
	const value = config[key];
	if (value === undefined) return true;
	return value;
}

/**
 * Resolve the reviewScope from project GitHub trigger config.
 * Returns the default scope when no config is present.
 */
export function resolveReviewScope(config: Partial<GitHubTriggerConfig> | undefined): ReviewScope {
	if (!config || config.reviewScope === undefined) {
		return ReviewScopeSchema.parse(undefined);
	}
	return config.reviewScope;
}
