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
 * Per-agent issue-transitioned configuration for JIRA.
 * Each agent type can independently toggle whether the issue-transitioned trigger fires for it.
 */
export const IssueTransitionedSchema = z
	.union([
		z.boolean(),
		z.object({
			briefing: z.boolean().default(true),
			planning: z.boolean().default(true),
			implementation: z.boolean().default(true),
		}),
	])
	.optional();

export type IssueTransitionedConfig = z.infer<typeof IssueTransitionedSchema>;

/**
 * Trigger configuration for JIRA integrations.
 * All triggers default to `true` for backward compatibility.
 */
export const JiraTriggerConfigSchema = z.object({
	issueTransitioned: IssueTransitionedSchema,
	readyToProcessLabel: ReadyToProcessLabelSchema,
	commentMention: z.boolean().default(true),
});

/**
 * Structured review trigger configuration with three independent modes.
 * All modes default to `false` (safe default — users must explicitly opt in).
 */
export const ReviewTriggerConfigSchema = z.object({
	/** Trigger review for PRs authored by the implementer persona. */
	ownPrsOnly: z.boolean().default(false),
	/** Trigger review for PRs authored by anyone (not just the implementer). */
	externalPrs: z.boolean().default(false),
	/** Trigger review when a CASCADE persona is explicitly requested as reviewer. */
	onReviewRequested: z.boolean().default(false),
});

export type ReviewTriggerConfig = z.infer<typeof ReviewTriggerConfigSchema>;

/**
 * Trigger configuration for GitHub integrations.
 * Existing triggers default to `true`; new triggers (`reviewRequested`, `prOpened`) default to `false`.
 */
export const GitHubTriggerConfigSchema = z.object({
	checkSuiteSuccess: z.boolean().default(true),
	checkSuiteFailure: z.boolean().default(true),
	prReviewSubmitted: z.boolean().default(true),
	prCommentMention: z.boolean().default(true),
	prReadyToMerge: z.boolean().default(true),
	prMerged: z.boolean().default(true),
	/** Legacy trigger: fires review agent when review is requested from a CASCADE persona. Default false (opt-in). */
	reviewRequested: z.boolean().default(false),
	/** PR opened trigger. Default false (disabled until reviewed). */
	prOpened: z.boolean().default(false),
	/**
	 * Structured review trigger config with three independent modes.
	 * When present, takes precedence over the legacy `reviewRequested` / `checkSuiteSuccess` booleans.
	 */
	reviewTrigger: ReviewTriggerConfigSchema.optional(),
});

export type TrelloTriggerConfig = z.infer<typeof TrelloTriggerConfigSchema>;
export type JiraTriggerConfig = z.infer<typeof JiraTriggerConfigSchema>;
export type GitHubTriggerConfig = z.infer<typeof GitHubTriggerConfigSchema>;

// ============================================================================
// Review Trigger Resolution
// ============================================================================

/**
 * Resolve the structured review trigger config from GitHub trigger config.
 *
 * Precedence:
 * 1. `reviewTrigger` object (new structured config) — wins when present
 * 2. Legacy booleans: `checkSuiteSuccess` → `ownPrsOnly`, `reviewRequested` → `onReviewRequested`
 * 3. Bare defaults (no config) — all modes false
 *
 * This helper is the single source of truth for determining which review trigger modes are active.
 */
export function resolveReviewTriggerConfig(
	config: Partial<GitHubTriggerConfig> | undefined,
): ReviewTriggerConfig {
	// New structured config wins when present
	if (config?.reviewTrigger !== undefined) {
		return {
			ownPrsOnly: config.reviewTrigger.ownPrsOnly ?? false,
			externalPrs: config.reviewTrigger.externalPrs ?? false,
			onReviewRequested: config.reviewTrigger.onReviewRequested ?? false,
		};
	}

	// Legacy fallback: map old boolean flags to structured modes
	const legacyOwnPrsOnly = config?.checkSuiteSuccess ?? true; // existing default was true
	const legacyOnReviewRequested = config?.reviewRequested ?? false;

	return {
		ownPrsOnly: legacyOwnPrsOnly,
		externalPrs: false, // no legacy equivalent — always false
		onReviewRequested: legacyOnReviewRequested,
	};
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
 * Resolve whether the issue-transitioned trigger is enabled for a specific agent type.
 * Supports both the new nested object format and the legacy boolean format.
 * Returns `true` when no config is present (backward compatible).
 */
export function resolveIssueTransitionedEnabled(
	config: Partial<JiraTriggerConfig> | undefined,
	agentType: string,
): boolean {
	if (!config) return true;
	const it = config.issueTransitioned as IssueTransitionedConfig;
	if (it === undefined) return true;
	if (typeof it === 'boolean') {
		// Legacy: boolean applies to all agents
		return it;
	}
	// Nested object: check per-agent toggle
	if (agentType === 'briefing') return it.briefing ?? true;
	if (agentType === 'planning') return it.planning ?? true;
	if (agentType === 'implementation') return it.implementation ?? true;
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
	if (key === 'issueTransitioned') {
		const it = value as IssueTransitionedConfig;
		if (it === undefined) return true;
		if (typeof it === 'boolean') return it;
		// Object form: enabled if any agent is enabled
		return it.briefing || it.planning || it.implementation;
	}
	return value === undefined ? true : (value as boolean);
}

/**
 * Resolve whether a GitHub trigger is enabled based on project trigger config.
 * For new opt-in triggers (reviewRequested, prOpened), returns `false` when no config is present.
 */
export function resolveGitHubTriggerEnabled(
	config: Partial<GitHubTriggerConfig> | undefined,
	key: keyof GitHubTriggerConfig,
): boolean {
	if (!config) {
		// New triggers that are opt-in default to false even without config
		if (key === 'reviewRequested' || key === 'prOpened') return false;
		return true;
	}
	const value = config[key];
	if (value === undefined) {
		// New triggers that are opt-in default to false
		if (key === 'reviewRequested' || key === 'prOpened') return false;
		return true;
	}
	// reviewTrigger is an object, not a boolean — skip it in this function
	if (typeof value !== 'boolean') return true;
	return value;
}
