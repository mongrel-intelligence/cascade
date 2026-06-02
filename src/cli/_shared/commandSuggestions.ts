/**
 * Pure helper that builds the `unknown-command` CLI envelope options for a
 * typoed `cascade-tools` invocation, given an oclif-like config. The helper
 * is intentionally side-effect free — it does NOT install oclif's
 * `command_not_found` hook, instantiate provider clients, or load command
 * classes — so unit tests can pin the suggestion decisions without booting
 * the full CLI surface.
 *
 * Suggestions are derived strictly from the loaded oclif config:
 *
 * - **Top-level topics** come from the union of (a) the first segment of
 *   every entry in `config.commandIDs` and (b) the keys of
 *   `config.pjson.oclif.topics` (skipping `hidden: true` topics). This makes
 *   the candidate set match the actual binary surface — the dashboard topic
 *   is excluded automatically when running under `cascade-tools`, because
 *   `bin/cascade-tools.js` excludes the dashboard glob from oclif's command
 *   discovery and overrides `pjson.oclif.topics` to a four-entry whitelist.
 * - **Subcommands** for a known topic come from `config.commandIDs` entries
 *   that start with `<topic>:`, taking the next segment as the subcommand
 *   name.
 *
 * Hints are formatted with spaces (the cascade-tools topicSeparator), e.g.
 * `cascade-tools pm read-work-item`, so the agent can copy-paste them
 * directly into the next attempt.
 *
 * Distance + ratio thresholds are imported from the shared scorer at
 * `gadgets/shared/cli/suggestions.ts` (MNG-1440) so command and flag
 * suggestions stay calibrated against the same budget. The local
 * `suggestClosestViable` variant in this file applies those thresholds
 * with closest-VIABLE tie-breaking instead of closest-then-validate —
 * see its docstring for why command topics with mixed lengths require
 * that adjustment.
 */

import { distance } from 'fastest-levenshtein';

import {
	MAX_SUGGESTION_DISTANCE,
	MAX_SUGGESTION_RATIO,
} from '../../gadgets/shared/cli/suggestions.js';
import type { EmitCliErrorOptions } from '../../gadgets/shared/errorEnvelope.js';

/**
 * Minimal shape of the `@oclif/core` `Config` object this helper needs.
 *
 * Kept narrow on purpose: declaring the full `Config` type would force unit
 * tests to construct (or mock) a value that satisfies dozens of unrelated
 * fields. Anything not used by the helper stays off the contract.
 */
export interface OclifLikeConfig {
	/** CLI binary name, e.g. `'cascade-tools'`. Used to format runnable hints. */
	readonly bin: string;
	/**
	 * All loaded command IDs, with `:` as topic separator. Oclif internally
	 * normalises every command id to colon-separated regardless of the
	 * configured `topicSeparator`.
	 */
	readonly commandIDs: readonly string[];
	readonly pjson: {
		readonly oclif?: {
			readonly topics?: Readonly<
				Record<string, { description?: string; hidden?: boolean } | undefined>
			>;
		};
	};
}

/**
 * Envelope options shape returned by {@link buildUnknownCommandEnvelope}.
 * Matches the input contract of `emitCliError` minus the stream/exit hooks
 * the helper does not own.
 */
export type UnknownCommandEnvelopeOptions = Omit<EmitCliErrorOptions, 'stdout' | 'stderr' | 'exit'>;

export interface BuildUnknownCommandEnvelopeInput {
	readonly config: OclifLikeConfig;
	/**
	 * Oclif-normalised command id with `:` separators (e.g.
	 * `'pm:reaad-work-item'`). This is the `id` field the
	 * `command_not_found` hook receives.
	 */
	readonly id: string;
	/**
	 * Optional positional argv slice oclif passes alongside `id`. Reserved
	 * for future use; the helper does not consume it today.
	 */
	readonly argv?: readonly string[];
}

const HINT_SEPARATOR = ' ';

/** Extract the deduped, sorted union of topic names available to the CLI. */
function collectTopics(config: OclifLikeConfig): string[] {
	const set = new Set<string>();
	for (const id of config.commandIDs) {
		const topic = id.split(':')[0];
		if (topic) set.add(topic);
	}
	const explicit = config.pjson.oclif?.topics;
	if (explicit) {
		for (const [name, value] of Object.entries(explicit)) {
			if (value?.hidden) continue;
			set.add(name);
		}
	}
	return [...set].sort();
}

/** Extract the deduped, sorted list of subcommand names under `topic`. */
function collectSubcommandsForTopic(config: OclifLikeConfig, topic: string): string[] {
	const prefix = `${topic}:`;
	const set = new Set<string>();
	for (const id of config.commandIDs) {
		if (!id.startsWith(prefix)) continue;
		const rest = id.slice(prefix.length);
		if (!rest) continue;
		const sub = rest.split(':')[0];
		if (sub) set.add(sub);
	}
	return [...set].sort();
}

/** Join `[bin, ...segments]` with the cascade-tools topicSeparator. */
function formatCommand(bin: string, segments: readonly string[]): string {
	return [bin, ...segments].join(HINT_SEPARATOR);
}

/** Format the comma-separated `expected` field shown to the agent. */
function formatExpected(candidates: readonly string[]): string {
	return candidates.join(', ');
}

/**
 * Return the closest VIABLE candidate to `unknown` — viable meaning the
 * candidate passes both the distance budget ({@link MAX_SUGGESTION_DISTANCE})
 * and the ratio budget ({@link MAX_SUGGESTION_RATIO}) defined by the shared
 * scorer at `gadgets/shared/cli/suggestions.ts` (MNG-1440).
 *
 * The shared `suggestClosest` picks the first equidistant candidate by
 * iteration order and THEN validates the budget. That contract suits flag
 * suggestions (homogeneous lengths, alias→canonical fan-in) but misfires
 * for command topics with mixed lengths: e.g. `sm` typo ties `pm` and
 * `scm` at distance 1; `pm` iterates first then fails the 0.4 ratio gate
 * (1 / max(2,2) = 0.5), suppressing the viable `scm` suggestion.
 *
 * This local variant evaluates eligibility on every candidate and picks
 * the closest one that survives. Ties are still broken by input order
 * among viable candidates, matching the shared scorer's documented
 * stability guarantee.
 */
function suggestClosestViable(unknown: string, candidates: readonly string[]): string | null {
	let best: { name: string; dist: number } | null = null;
	for (const candidate of candidates) {
		const d = distance(unknown, candidate);
		if (d > MAX_SUGGESTION_DISTANCE) continue;
		const target = Math.max(unknown.length, candidate.length);
		if (target > 0 && d / target > MAX_SUGGESTION_RATIO) continue;
		if (best === null || d < best.dist) {
			best = { name: candidate, dist: d };
		}
	}
	return best?.name ?? null;
}

/**
 * Build the `unknown-command` envelope options for an unknown `cascade-tools`
 * invocation. Two cases:
 *
 * 1. **Unknown top-level topic** (e.g. `sm get-pr-diff`) — compare the
 *    first segment against the union topic set; if a close match is found,
 *    hint with the corrected topic and the user's preserved trailing
 *    segments.
 * 2. **Known topic, unknown subcommand** (e.g. `pm reaad-work-item`) —
 *    compare the trailing segment against the topic's subcommand set; if a
 *    close match is found, hint with `<bin> <topic> <subcommand>`.
 *
 * When no candidate is within the suggestion budget (distance `<= 2`,
 * ratio `<= 0.4`), the envelope omits the `hint` field but still carries
 * the `expected` candidate list so the agent can self-correct from a
 * concrete enumeration.
 */
export function buildUnknownCommandEnvelope(
	input: BuildUnknownCommandEnvelopeInput,
): UnknownCommandEnvelopeOptions {
	const { config, id } = input;
	const segments = id.split(':').filter((seg) => seg.length > 0);
	const topicSegment = segments[0] ?? '';
	const rest = segments.slice(1);
	const got = segments.join(HINT_SEPARATOR);

	const topics = collectTopics(config);

	// Case A: unknown top-level topic. Suggest closest topic, preserve rest.
	if (!topics.includes(topicSegment)) {
		const closest = suggestClosestViable(topicSegment, topics);
		const envelope: UnknownCommandEnvelopeOptions = {
			type: 'unknown-command',
			message: `Unknown command '${formatCommand(config.bin, segments)}'`,
			got,
			expected: formatExpected(topics),
		};
		if (closest) {
			envelope.hint = `did you mean '${formatCommand(config.bin, [closest, ...rest])}'?`;
		}
		return envelope;
	}

	// Case B: known topic, no subcommand. Surface the topic's subcommands so
	// the agent has a runnable enumeration. oclif normally routes bare-topic
	// invocations to topic-help before command_not_found fires, but the
	// helper handles this case defensively for direct callers.
	const subcommands = collectSubcommandsForTopic(config, topicSegment);
	if (rest.length === 0) {
		return {
			type: 'unknown-command',
			message: `Unknown command '${formatCommand(config.bin, segments)}'`,
			got,
			expected: formatExpected(subcommands),
		};
	}

	// Case C: known topic, unknown subcommand. Compare the trailing segment
	// only (cascade-tools commands are flat: `<topic>:<sub>` with no nested
	// topics). Preserve any further trailing segments verbatim in the hint
	// for forward compatibility.
	const unknownSub = rest[0];
	const trailing = rest.slice(1);
	const closest = suggestClosestViable(unknownSub, subcommands);
	const envelope: UnknownCommandEnvelopeOptions = {
		type: 'unknown-command',
		message: `Unknown command '${formatCommand(config.bin, segments)}'`,
		got,
		expected: formatExpected(subcommands),
	};
	if (closest) {
		envelope.hint = `did you mean '${formatCommand(config.bin, [topicSegment, closest, ...trailing])}'?`;
	}
	return envelope;
}
