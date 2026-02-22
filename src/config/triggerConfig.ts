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
	/** New trigger: fires review agent when review is requested from a CASCADE persona. Default false (opt-in). */
	reviewRequested: z.boolean().default(false),
	/** PR opened trigger. Default false (disabled until reviewed). */
	prOpened: z.boolean().default(false),
});

export type TrelloTriggerConfig = z.infer<typeof TrelloTriggerConfigSchema>;
export type JiraTriggerConfig = z.infer<typeof JiraTriggerConfigSchema>;
export type GitHubTriggerConfig = z.infer<typeof GitHubTriggerConfigSchema>;

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
	return value;
}
