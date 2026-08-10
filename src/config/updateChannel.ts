import { z } from 'zod';

/**
 * Update-channel catalog — the single source of truth for *where* a CASCADE
 * agent is allowed to post communication-only status updates back to humans.
 *
 * A channel gates two independent posting surfaces:
 *   - **PM** — comments on the work item (Trello card / JIRA issue / Linear issue).
 *   - **SCM** — comments and reviews on the GitHub pull request.
 *
 * | channel    | PM posting | SCM posting |
 * |------------|:----------:|:-----------:|
 * | `none`     |     ❌     |     ❌      |
 * | `pm-only`  |     ✅     |     ❌      |
 * | `scm-only` |     ❌     |     ✅      |
 * | `both`     |     ✅     |     ✅      |
 *
 * The default is `both`, which preserves the historical behavior where agents
 * post everywhere.
 *
 * This module is intentionally pure and dependency-free (Zod only). Wiring the
 * resolver / gating helpers into config mapping, the DB, the API, the CLI, or
 * the UI is the job of later stories — everything else imports from here so the
 * channel semantics have exactly one home.
 */
export const UPDATE_CHANNELS = ['none', 'scm-only', 'pm-only', 'both'] as const;

/** A single update-channel value. */
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

/** Channel used when a project / agent does not specify one. */
export const DEFAULT_UPDATE_CHANNEL: UpdateChannel = 'both';

/** Zod enum for validating persisted / API-supplied channel values. */
export const UpdateChannelSchema = z.enum(UPDATE_CHANNELS);

/**
 * Worker env var carrying the resolved update channel to `cascade-tools`
 * subprocesses (the native-tool engine path). Injected for every run by
 * `augmentProjectSecrets` so the CLI gate (e.g. `cascade-tools pm post-comment`)
 * can enforce the channel even when a posting command is invoked via bash,
 * bypassing the in-process {@link filterPostingGadgetNames} filter.
 */
export const UPDATE_CHANNEL_ENV_VAR = 'CASCADE_UPDATE_CHANNEL';

/**
 * Channel file written by the worker process before the agent starts. Used as a
 * fallback when {@link UPDATE_CHANNEL_ENV_VAR} is stripped by the claude
 * subprocess chain (observed with @anthropic-ai/claude-code ≤ 2.1.185 — the
 * bun-compiled binary does not forward all custom env vars to bash subprocesses,
 * which is exactly why the sibling review-event-policy gate added a file
 * fallback too). The path is fixed inside the ephemeral worker container's /tmp,
 * so there is no cross-run collision. Written UNCONDITIONALLY with the run's
 * resolved channel so the file always reflects the current run and self-corrects
 * if a /tmp path is ever reused.
 */
export const UPDATE_CHANNEL_FILE = '/tmp/cascade-update-channel';

/**
 * Minimal structural shape that {@link resolveUpdateChannel} reads from a
 * project.
 *
 * `agentUpdateChannels` is deliberately optional and is NOT yet part of the
 * persisted `ProjectConfig` schema — adding the column / config field is a
 * later story. Typing against this narrow interface keeps this foundational
 * module decoupled from the central schema while remaining structurally
 * compatible with the future `ProjectConfig` shape.
 */
export interface ProjectWithUpdateChannels {
	/** Per-agent-type channel overrides, keyed by agent type. */
	agentUpdateChannels?: Record<string, UpdateChannel | undefined>;
}

/**
 * Resolve the update channel for a given agent type on a project.
 *
 * Reads `project.agentUpdateChannels?.[agentType]` and falls back to
 * {@link DEFAULT_UPDATE_CHANNEL} (`both`) when the project has no map, no entry
 * for the agent type, or an `undefined` entry.
 */
export function resolveUpdateChannel(
	project: ProjectWithUpdateChannels,
	agentType: string,
): UpdateChannel {
	return project.agentUpdateChannels?.[agentType] ?? DEFAULT_UPDATE_CHANNEL;
}

/** True when the channel permits posting PM (work-item) comments. */
export function isPmPostingEnabled(channel: UpdateChannel): boolean {
	return channel === 'pm-only' || channel === 'both';
}

/** True when the channel permits posting SCM (pull-request) comments / reviews. */
export function isScmPostingEnabled(channel: UpdateChannel): boolean {
	return channel === 'scm-only' || channel === 'both';
}

/**
 * Communication-only gadget names, grouped by posting surface.
 *
 * These are the *only* gadgets the update channel gates: they exist purely to
 * post human-facing status updates, so silencing them never stops an agent
 * from doing real work (reading code, opening PRs, moving cards, etc.). Action
 * gadgets such as `CreatePR`, `MoveWorkItem`, and `UpdateWorkItem` are
 * deliberately absent from these lists.
 */
export const PM_POSTING_GADGETS = ['PostComment'] as const;

/** SCM (pull-request) communication-only gadget names. See {@link PM_POSTING_GADGETS}. */
export const SCM_POSTING_GADGETS = [
	'PostPRComment',
	'UpdatePRComment',
	'CreatePRReview',
	'ReplyToReviewComment',
] as const;

const PM_POSTING_GADGET_NAMES: ReadonlySet<string> = new Set<string>(PM_POSTING_GADGETS);
const SCM_POSTING_GADGET_NAMES: ReadonlySet<string> = new Set<string>(SCM_POSTING_GADGETS);

/**
 * Drop the communication-only posting gadget names the channel disables.
 *
 * - When PM posting is off, {@link PM_POSTING_GADGETS} names are removed.
 * - When SCM posting is off, {@link SCM_POSTING_GADGETS} names are removed.
 * - Every other name (action gadgets, unknown names) passes through untouched.
 *
 * The input order is preserved and the input array is not mutated.
 */
export function filterPostingGadgetNames(
	names: readonly string[],
	channel: UpdateChannel,
): string[] {
	const pmEnabled = isPmPostingEnabled(channel);
	const scmEnabled = isScmPostingEnabled(channel);

	return names.filter((name) => {
		if (!pmEnabled && PM_POSTING_GADGET_NAMES.has(name)) {
			return false;
		}
		if (!scmEnabled && SCM_POSTING_GADGET_NAMES.has(name)) {
			return false;
		}
		return true;
	});
}
