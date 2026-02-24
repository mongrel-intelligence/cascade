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
			splitting: z.boolean().default(true),
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
	cardMovedToSplitting: z.boolean().default(true),
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
			splitting: z.boolean().default(true),
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
// Generic Helpers
// ============================================================================

/** Shape of a per-agent toggle object (splitting / planning / implementation). */
type PerAgentObject = { splitting?: boolean; planning?: boolean; implementation?: boolean };

/**
 * Generic resolver for per-agent toggles that can be:
 * - `undefined` → returns `true` (backward compatible, always enabled)
 * - `boolean` → applies uniformly to all agents
 * - `{ splitting, planning, implementation }` → per-agent lookup
 *
 * This replaces the duplicated logic in `resolveReadyToProcessEnabled` and
 * `resolveIssueTransitionedEnabled`.
 */
export function resolvePerAgentToggle(
	value: boolean | PerAgentObject | undefined,
	agentType: string,
): boolean {
	if (value === undefined) return true;
	if (typeof value === 'boolean') return value;
	// Nested object: check per-agent toggle
	if (agentType === 'splitting') return value.splitting ?? true;
	if (agentType === 'planning') return value.planning ?? true;
	if (agentType === 'implementation') return value.implementation ?? true;
	// Unknown agent type — default to enabled
	return true;
}

/** Options for `resolveTriggerEnabled()`. */
interface ResolveTriggerEnabledOptions {
	/**
	 * Keys that are opt-in (default `false` even when config is absent).
	 * All other keys default to `true` when absent.
	 */
	optInKeys?: string[];
	/**
	 * Keys whose value is a `ReadyToProcessLabelConfig`-style object.
	 * When queried at the outer level (not per-agent), returns `true` if any
	 * agent sub-key is enabled.
	 */
	nestedKeys?: string[];
	/**
	 * Keys whose value may be a non-boolean object (e.g. `reviewTrigger`).
	 * When the stored value is not a boolean, returns `true` (the object being
	 * present signals it is active).
	 */
	objectKeys?: string[];
}

/**
 * Generic resolver for a single trigger key within any platform's trigger config.
 *
 * Handles all the special cases across Trello, JIRA, and GitHub:
 * - Missing config or missing key → `true` (or `false` for opt-in keys)
 * - Boolean value → return it directly
 * - Nested per-agent object (nestedKeys) → `true` if any agent sub-key is enabled
 * - Non-boolean object (objectKeys) → `true` (presence indicates active)
 *
 * Platform-specific wrappers (`resolveTrelloTriggerEnabled`, etc.) call this
 * function with the appropriate option sets, keeping all special-case knowledge
 * in one place.
 */
export function resolveTriggerEnabled(
	config: Record<string, unknown> | undefined,
	key: string,
	options: ResolveTriggerEnabledOptions = {},
): boolean {
	const { optInKeys = [], nestedKeys = [], objectKeys = [] } = options;
	const isOptIn = optInKeys.includes(key);

	if (!config) return !isOptIn;

	const value = config[key];

	if (value === undefined) return !isOptIn;

	// Nested per-agent object (e.g. readyToProcessLabel, issueTransitioned)
	if (nestedKeys.includes(key)) {
		if (typeof value === 'boolean') return value;
		const obj = value as PerAgentObject;
		return !!(obj.splitting || obj.planning || obj.implementation);
	}

	// Object key (e.g. reviewTrigger) — non-boolean means the object is present/active
	if (objectKeys.includes(key)) {
		if (typeof value !== 'boolean') return true;
		return value;
	}

	return typeof value === 'boolean' ? value : true;
}

// ============================================================================
// Platform config constants
// ============================================================================

/** Keys whose values are per-agent nested objects in the Trello trigger config. */
const TRELLO_NESTED_KEYS: string[] = ['readyToProcessLabel'];

/** Keys whose values are per-agent nested objects in the JIRA trigger config. */
const JIRA_NESTED_KEYS: string[] = ['readyToProcessLabel', 'issueTransitioned'];

/** Keys that are opt-in (default false) in the GitHub trigger config. */
const GITHUB_OPT_IN_KEYS: string[] = ['reviewRequested', 'prOpened'];

/** Keys whose values may be non-boolean objects in the GitHub trigger config. */
const GITHUB_OBJECT_KEYS: string[] = ['reviewTrigger'];

// ============================================================================
// Platform-specific wrappers (thin, backward-compatible)
// ============================================================================

/**
 * Resolve whether a Trello trigger is enabled based on project trigger config.
 * Returns `true` (enabled) when no config is present (backward compatible).
 */
export function resolveTrelloTriggerEnabled(
	config: Partial<TrelloTriggerConfig> | undefined,
	key: keyof TrelloTriggerConfig,
): boolean {
	return resolveTriggerEnabled(config as Record<string, unknown> | undefined, key as string, {
		nestedKeys: TRELLO_NESTED_KEYS,
	});
}

/**
 * Resolve whether a JIRA trigger is enabled based on project trigger config.
 * Returns `true` (enabled) when no config is present (backward compatible).
 */
export function resolveJiraTriggerEnabled(
	config: Partial<JiraTriggerConfig> | undefined,
	key: keyof JiraTriggerConfig,
): boolean {
	return resolveTriggerEnabled(config as Record<string, unknown> | undefined, key as string, {
		nestedKeys: JIRA_NESTED_KEYS,
	});
}

/**
 * Resolve whether a GitHub trigger is enabled based on project trigger config.
 * For new opt-in triggers (reviewRequested, prOpened), returns `false` when no config is present.
 */
export function resolveGitHubTriggerEnabled(
	config: Partial<GitHubTriggerConfig> | undefined,
	key: keyof GitHubTriggerConfig,
): boolean {
	return resolveTriggerEnabled(config as Record<string, unknown> | undefined, key as string, {
		optInKeys: GITHUB_OPT_IN_KEYS,
		objectKeys: GITHUB_OBJECT_KEYS,
	});
}

// ============================================================================
// Per-agent trigger resolvers (thin wrappers over resolvePerAgentToggle)
// ============================================================================

/**
 * Resolve whether the ready-to-process trigger is enabled for a specific agent type.
 * Supports both the new nested object format and the legacy boolean format.
 * Returns `true` when no config is present (backward compatible).
 */
export function resolveReadyToProcessEnabled(
	config: Partial<TrelloTriggerConfig> | Partial<JiraTriggerConfig> | undefined,
	agentType: string,
): boolean {
	return resolvePerAgentToggle(
		config?.readyToProcessLabel as boolean | PerAgentObject | undefined,
		agentType,
	);
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
	return resolvePerAgentToggle(
		config?.issueTransitioned as boolean | PerAgentObject | undefined,
		agentType,
	);
}
