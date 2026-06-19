/**
 * Pin the pure unknown-command suggestion helper (MNG-1441).
 *
 * The helper is the testable seam that decides which suggestion (if any) is
 * surfaced when a `cascade-tools` agent typos a topic or subcommand. These
 * tests guarantee:
 *
 * - Topic typos suggest the closest topic and preserve the user's trailing
 *   segments (`sm get-pr-diff` → `scm get-pr-diff`).
 * - Subcommand typos under a known topic suggest the closest subcommand
 *   (`pm reaad-work-item` → `pm read-work-item`).
 * - Far-away typos drop the `hint` field but still surface the candidate
 *   list via `expected`, so the agent has a concrete enumeration to
 *   self-correct from.
 * - The candidate set never leaks topics that are not loaded by
 *   `cascade-tools` (the dashboard topic is excluded automatically because
 *   its glob is filtered out in `bin/cascade-tools.js`).
 *
 * The helper does NOT install oclif's `command_not_found` hook — wiring is
 * out of scope for MNG-1441. These tests pin decisions only.
 */

import { describe, expect, it } from 'vitest';

import {
	buildUnknownCommandEnvelope,
	type OclifLikeConfig,
} from '../../../src/cli/_shared/commandSuggestions.js';

/**
 * Construct a minimal oclif-like config that mirrors the shape
 * `bin/cascade-tools.js` produces (four topics, flat `<topic>:<sub>` IDs,
 * no dashboard surface).
 */
function makeConfig(overrides: Partial<OclifLikeConfig> = {}): OclifLikeConfig {
	return {
		bin: 'cascade-tools',
		commandIDs: [
			'pm:read-work-item',
			'pm:post-comment',
			'pm:update-work-item',
			'pm:add-checklist',
			'pm:update-checklist-item',
			'scm:create-pr',
			'scm:get-pr-diff',
			'scm:post-pr-comment',
			'scm:create-pr-review',
			'alerting:get-alerting-event',
			'alerting:get-alerting-issue',
			'session:finish',
		],
		pjson: {
			oclif: {
				topics: {
					pm: { description: 'PM topic' },
					scm: { description: 'SCM topic' },
					alerting: { description: 'Alerting topic' },
					session: { description: 'Session topic' },
				},
			},
		},
		...overrides,
	};
}

describe('buildUnknownCommandEnvelope', () => {
	it('marks the envelope as unknown-command with the typed input in `got`', () => {
		const envelope = buildUnknownCommandEnvelope({
			config: makeConfig(),
			id: 'pm:reaad-work-item',
		});
		expect(envelope.type).toBe('unknown-command');
		expect(envelope.got).toBe('pm reaad-work-item');
		// No `flag` field for command-level failures.
		expect(envelope.flag).toBeUndefined();
		// Message renders the runnable form so humans reading stderr see what
		// they typed in CLI shape, not oclif's colon-separated id.
		expect(envelope.message).toBe("Unknown command 'cascade-tools pm reaad-work-item'");
	});

	it('suggests the closest topic for a top-level typo (`sm get-pr-diff` → `scm get-pr-diff`)', () => {
		const envelope = buildUnknownCommandEnvelope({
			config: makeConfig(),
			id: 'sm:get-pr-diff',
		});
		expect(envelope.hint).toBe("did you mean 'cascade-tools scm get-pr-diff'?");
		// Topic-typo envelopes list topics in `expected`, not subcommands —
		// the unknown segment is the topic.
		expect(envelope.expected).toBe('alerting, pm, scm, session');
	});

	it('suggests the closest subcommand under a known topic (`pm reaad-work-item` → `pm read-work-item`)', () => {
		const envelope = buildUnknownCommandEnvelope({
			config: makeConfig(),
			id: 'pm:reaad-work-item',
		});
		expect(envelope.hint).toBe("did you mean 'cascade-tools pm read-work-item'?");
		// Subcommand-typo envelopes list the topic's subcommands so the agent
		// has a concrete enumeration even when the hint is not exact.
		expect(envelope.expected).toContain('read-work-item');
		expect(envelope.expected).toContain('post-comment');
		// Subcommand expected MUST NOT leak other topics' subcommands.
		expect(envelope.expected).not.toContain('create-pr');
	});

	it('omits `hint` when the typo is too far from any candidate', () => {
		const envelope = buildUnknownCommandEnvelope({
			config: makeConfig(),
			id: 'pm:totallyunrelated',
		});
		expect(envelope.hint).toBeUndefined();
		// `expected` is still populated so the agent has a recovery path.
		expect(envelope.expected).toContain('read-work-item');
		expect(envelope.message).toBe("Unknown command 'cascade-tools pm totallyunrelated'");
	});

	it('omits `hint` for far-away top-level topic typos', () => {
		// 'zzzzzzzz' is well beyond the distance budget for any registered
		// cascade-tools topic.
		const envelope = buildUnknownCommandEnvelope({
			config: makeConfig(),
			id: 'zzzzzzzz:something',
		});
		expect(envelope.hint).toBeUndefined();
		expect(envelope.expected).toBe('alerting, pm, scm, session');
	});

	it("surfaces a useful `expected` field for subcommand typos (the topic's actual command list)", () => {
		const envelope = buildUnknownCommandEnvelope({
			config: makeConfig(),
			id: 'scm:get-pr-diffx',
		});
		// Comma-separated, deterministic (sorted) list matches the
		// enum-mismatch shape agents already parse from `parseErrors.ts`.
		expect(envelope.expected).toBe('create-pr, create-pr-review, get-pr-diff, post-pr-comment');
	});

	it('excludes dashboard topics when they are not loaded by cascade-tools', () => {
		// Mirror `bin/cascade-tools.js`: dashboard glob is excluded from
		// command discovery, and `pjson.oclif.topics` does not declare a
		// `dashboard` entry. Topic candidates must reflect that.
		const config = makeConfig();
		const envelope = buildUnknownCommandEnvelope({
			config,
			id: 'dashbord:projects',
		});
		// The candidate list does not include `dashboard`, so even if
		// `dashbord` were within edit distance, it could not be suggested.
		expect(envelope.expected.split(', ')).not.toContain('dashboard');
		expect(envelope.hint).toBeUndefined();
	});

	it('does include a topic derived from commandIDs even when not in pjson.oclif.topics', () => {
		// Topics are the union of commandIDs' first segments + explicit
		// pjson topics. A plugin-contributed topic that didn't make it into
		// `pjson.oclif.topics` is still a valid candidate.
		const config = makeConfig({
			commandIDs: [...makeConfig().commandIDs, 'plugin:do-thing'],
		});
		const envelope = buildUnknownCommandEnvelope({
			config,
			id: 'plugn:do-thing', // distance 1 from 'plugin'
		});
		expect(envelope.hint).toBe("did you mean 'cascade-tools plugin do-thing'?");
		expect(envelope.expected.split(', ')).toContain('plugin');
	});

	it('skips hidden topics from `pjson.oclif.topics` when building candidates', () => {
		// Hidden topics never appear in `cascade-tools --help` and should
		// not be suggested either. Without this filter, a typo that
		// resembles a hidden topic would surface confusing guidance.
		const config = makeConfig({
			commandIDs: ['pm:read-work-item'],
			pjson: {
				oclif: {
					topics: {
						pm: { description: 'PM' },
						internal: { description: 'Internal', hidden: true },
					},
				},
			},
		});
		const envelope = buildUnknownCommandEnvelope({
			config,
			id: 'internel:thing', // distance 1 from 'internal'
		});
		expect(envelope.expected.split(', ')).not.toContain('internal');
		expect(envelope.hint).toBeUndefined();
	});

	it("preserves the user's trailing positional segments when suggesting a topic", () => {
		// The trailing segment(s) are echoed verbatim in the hint so the
		// agent can immediately retry without retyping. Helpful when the
		// trailing form happens to be valid under the corrected topic.
		const envelope = buildUnknownCommandEnvelope({
			config: makeConfig(),
			id: 'sm:create-pr',
		});
		expect(envelope.hint).toBe("did you mean 'cascade-tools scm create-pr'?");
	});

	it('handles bare topic invocations defensively (no subcommand to suggest)', () => {
		// oclif normally routes bare-topic input to topic-help before
		// command_not_found fires, but direct callers may still hit this
		// path. The envelope should surface the subcommand enumeration.
		const envelope = buildUnknownCommandEnvelope({
			config: makeConfig(),
			id: 'pm',
		});
		expect(envelope.type).toBe('unknown-command');
		expect(envelope.expected).toContain('read-work-item');
		expect(envelope.hint).toBeUndefined();
	});

	it('produces no candidates and no hint when the config has no loaded commands or explicit topics', () => {
		const envelope = buildUnknownCommandEnvelope({
			config: { bin: 'cascade-tools', commandIDs: [], pjson: { oclif: {} } },
			id: 'pm:read-work-item',
		});
		expect(envelope.type).toBe('unknown-command');
		expect(envelope.expected).toBe('');
		expect(envelope.hint).toBeUndefined();
	});
});
