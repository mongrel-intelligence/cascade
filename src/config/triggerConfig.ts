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
			'backlog-manager': z.boolean().default(true),
		}),
	])
	.optional();

export type ReadyToProcessLabelConfig = z.infer<typeof ReadyToProcessLabelSchema>;

/**
 * Per-agent status-changed configuration.
 * Each agent type can independently toggle whether the status-changed trigger fires for it.
 */
export const StatusChangedSchema = z
	.union([
		z.boolean(),
		z.object({
			splitting: z.boolean().default(true),
			planning: z.boolean().default(true),
			implementation: z.boolean().default(true),
			'backlog-manager': z.boolean().default(true),
		}),
	])
	.optional();

export type StatusChangedConfig = z.infer<typeof StatusChangedSchema>;

/**
 * Trigger configuration for Trello integrations.
 * All triggers default to `true` for backward compatibility.
 *
 * `statusChanged` is the unified key replacing the legacy `cardMovedToSplitting`,
 * `cardMovedToPlanning`, and `cardMovedToTodo` keys.
 */
export const TrelloTriggerConfigSchema = z.object({
	/** Unified status-changed toggle (replaces legacy cardMovedTo* keys). */
	statusChanged: StatusChangedSchema.default(true),
	/** @deprecated Use `statusChanged` instead. */
	cardMovedToSplitting: z.boolean().default(true),
	/** @deprecated Use `statusChanged` instead. */
	cardMovedToPlanning: z.boolean().default(true),
	/** @deprecated Use `statusChanged` instead. */
	cardMovedToTodo: z.boolean().default(true),
	readyToProcessLabel: ReadyToProcessLabelSchema,
	commentMention: z.boolean().default(true),
});

/**
 * @deprecated Use `StatusChangedSchema` instead.
 */
export const IssueTransitionedSchema = StatusChangedSchema;
export type IssueTransitionedConfig = StatusChangedConfig;

/**
 * Trigger configuration for JIRA integrations.
 * All triggers default to `true` for backward compatibility.
 *
 * `statusChanged` is the unified key replacing the legacy `issueTransitioned` key.
 */
export const JiraTriggerConfigSchema = z.object({
	/** Unified status-changed toggle (replaces legacy issueTransitioned key). */
	statusChanged: StatusChangedSchema,
	/** @deprecated Use `statusChanged` instead. */
	issueTransitioned: StatusChangedSchema,
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
	 * After a PR is merged, chain into the backlog-manager agent to pick the next card.
	 * Default false (opt-in) for backward compatibility.
	 */
	prMergedBacklogManager: z.boolean().default(false),
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
// Email Trigger Config
// ============================================================================

/**
 * Trigger configuration for email-joke agent.
 * Stored in project_integrations.triggers for email category.
 */
export const EmailJokeTriggerConfigSchema = z.object({
	/** Email address filter — only respond to emails from this sender */
	senderEmail: z.string().email().nullable().optional(),
});

export type EmailJokeTriggerConfig = z.infer<typeof EmailJokeTriggerConfigSchema>;

/**
 * Resolve email-joke trigger config with defaults.
 * Also used for type-safe parsing of raw trigger objects.
 */
export function resolveEmailJokeTriggerConfig(
	config: Partial<EmailJokeTriggerConfig> | undefined,
): EmailJokeTriggerConfig {
	return {
		senderEmail: config?.senderEmail ?? undefined,
	};
}

/**
 * Parse and validate email-joke trigger config from unknown input.
 * Returns a properly typed EmailJokeTriggerConfig.
 */
export function parseEmailJokeTriggers(triggers: unknown): EmailJokeTriggerConfig {
	if (!triggers || typeof triggers !== 'object') {
		return { senderEmail: undefined };
	}
	const result = EmailJokeTriggerConfigSchema.safeParse(triggers);
	return result.success ? result.data : { senderEmail: undefined };
}

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

/** Shape of a per-agent toggle object (splitting / planning / implementation / backlog-manager). */
type PerAgentObject = {
	splitting?: boolean;
	planning?: boolean;
	implementation?: boolean;
	'backlog-manager'?: boolean;
};

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
	if (agentType === 'backlog-manager') return value['backlog-manager'] ?? true;
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
		return !!(obj.splitting || obj.planning || obj.implementation || obj['backlog-manager']);
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
const TRELLO_NESTED_KEYS: string[] = ['readyToProcessLabel', 'statusChanged'];

/** Keys whose values are per-agent nested objects in the JIRA trigger config. */
const JIRA_NESTED_KEYS: string[] = ['readyToProcessLabel', 'statusChanged', 'issueTransitioned'];

/** Keys that are opt-in (default false) in the GitHub trigger config. */
const GITHUB_OPT_IN_KEYS: string[] = ['reviewRequested', 'prOpened', 'prMergedBacklogManager'];

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
 * Resolve whether the status-changed trigger is enabled for a specific agent type (Jira).
 * Reads from the `statusChanged` key first, falling back to the legacy `issueTransitioned` key.
 * Supports both the new nested object format and the legacy boolean format.
 * Returns `true` when no config is present (backward compatible).
 */
export function resolveStatusChangedEnabled(
	config: Partial<JiraTriggerConfig> | undefined,
	agentType: string,
): boolean {
	// Prefer new `statusChanged` key, fall back to legacy `issueTransitioned`
	const value =
		config?.statusChanged !== undefined ? config.statusChanged : config?.issueTransitioned;
	return resolvePerAgentToggle(value as boolean | PerAgentObject | undefined, agentType);
}

/**
 * Resolve whether the status-changed trigger is enabled for a specific agent type (Trello).
 * Reads from the `statusChanged` key first, falling back to the legacy per-agent keys:
 * - splitting → cardMovedToSplitting
 * - planning → cardMovedToPlanning
 * - implementation → cardMovedToTodo
 *
 * Supports both the new nested object format and the legacy boolean format.
 * Returns `true` when no config is present (backward compatible).
 */
export function resolveTrelloStatusChangedEnabled(
	config: Partial<TrelloTriggerConfig> | undefined,
	agentType: string,
): boolean {
	// Prefer new `statusChanged` key
	if (config?.statusChanged !== undefined) {
		return resolvePerAgentToggle(
			config.statusChanged as boolean | PerAgentObject | undefined,
			agentType,
		);
	}

	// Fall back to legacy per-agent keys
	if (agentType === 'splitting' && config?.cardMovedToSplitting !== undefined) {
		return config.cardMovedToSplitting;
	}
	if (agentType === 'planning' && config?.cardMovedToPlanning !== undefined) {
		return config.cardMovedToPlanning;
	}
	if (agentType === 'implementation' && config?.cardMovedToTodo !== undefined) {
		return config.cardMovedToTodo;
	}

	// No config present — default enabled for backward compatibility
	return true;
}

/**
 * @deprecated Use `resolveStatusChangedEnabled` instead.
 * Resolve whether the issue-transitioned trigger is enabled for a specific agent type.
 * Supports both the new nested object format and the legacy boolean format.
 * Returns `true` when no config is present (backward compatible).
 */
export function resolveIssueTransitionedEnabled(
	config: Partial<JiraTriggerConfig> | undefined,
	agentType: string,
): boolean {
	return resolveStatusChangedEnabled(config, agentType);
}
