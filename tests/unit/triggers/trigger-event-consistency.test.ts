/**
 * Static-analysis guard against the trigger-event-string drift bug class.
 *
 * Every TriggerHandler that calls `checkTriggerEnabled(projectId, agentType,
 * <event>, ...)` MUST use the same `<event>` string that it later emits as
 * `triggerEvent: '<event>'` on the `AgentInput` it returns. If they drift,
 * the gating check looks up a DB row that doesn't exist (operators write
 * the EMITTED event when they enable the trigger), falls back to the agent
 * YAML's `defaultEnabled` (typically `false`), and the trigger silently
 * never fires in production.
 *
 * Live incident: `src/triggers/github/pr-conflict-detected.ts` had this
 * exact mismatch — gated on `'scm:conflict-resolution'` while emitting
 * `triggerEvent: 'scm:pr-conflict-detected'`. Conflict detection was
 * silently disabled in prod for every project that "enabled" it via the
 * dashboard. Confirmed via `cascade webhooklogs` on 2026-04-27: every
 * `pull_request synchronize` event for ucho returned "No trigger matched
 * for event" instead of queuing `resolve-conflicts`.
 *
 * This test parses every trigger-handler file under `src/triggers/` and
 * asserts the invariant. It does NOT run the handlers; it's a static
 * grep-style check against the file source so it stays cheap and fires
 * loudly with a precise file:line reference when violated.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_TRIGGER_EVENTS } from '../../../src/triggers/shared/events.js';

const TRIGGERS_ROOT = join(__dirname, '..', '..', '..', 'src', 'triggers');

const BUILT_IN_TRIGGER_FILES = [
	'github/check-suite-failure.ts',
	'github/check-suite-success.ts',
	'github/pr-comment-mention.ts',
	'github/pr-conflict-detected.ts',
	'github/pr-merged.ts',
	'github/pr-opened.ts',
	'github/pr-ready-to-merge.ts',
	'github/pr-review-submitted.ts',
	'github/review-requested.ts',
	'jira/comment-mention.ts',
	'jira/label-added.ts',
	'jira/status-changed.ts',
	'linear/comment-mention.ts',
	'linear/label-added.ts',
	'linear/status-changed.ts',
	'sentry/alerting-issue.ts',
	'sentry/alerting-metric.ts',
	'trello/comment-mention.ts',
	'trello/label-added.ts',
	'trello/status-changed.ts',
].map((path) => join(TRIGGERS_ROOT, path));

// Handlers that legitimately gate on one event without emitting it as a
// `triggerEvent`. Add an entry ONLY when there's a real reason — every
// exemption silently weakens the guard.
const EXEMPT_FILES = new Set<string>([
	// Auto-chain dispatcher: gates on a synthetic 'internal:auto-chain'
	// event but does emit it as triggerEvent at line 772 — passes the check
	// without exemption. Listed here only as documentation.
]);

interface HandlerScan {
	file: string;
	gatingEvents: Set<string>;
	emittedEvents: Set<string>;
}

interface RawTriggerLiteralOccurrence {
	file: string;
	lineNumber: number;
	literal: string;
	line: string;
}

function listHandlerFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			out.push(...listHandlerFiles(full));
		} else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
			out.push(full);
		}
	}
	return out;
}

function scanHandler(file: string): HandlerScan {
	const src = readFileSync(file, 'utf-8');
	const gatingEvents = new Set<string>();
	const emittedEvents = new Set<string>();

	// Match `checkTriggerEnabled(...)` and `checkTriggerEnabledWithParams(...)`.
	// Captures the third argument (event string literal). Permits arbitrary
	// whitespace/newlines and any agentType expression in slot 2.
	//
	// Examples matched:
	//   checkTriggerEnabled(ctx.project.id, 'review', 'scm:pr-opened', this.name)
	//   checkTriggerEnabled(ctx.project.id, agentType, 'pm:label-added', this.name)
	//   await checkTriggerEnabledWithParams(
	//     ctx.project.id,
	//     'alerting',
	//     'alerting:issue-alert',
	//     this.name,
	//   );
	const gatingPattern =
		/checkTriggerEnabled(?:WithParams)?\s*\(\s*[^,]+,\s*[^,]+,\s*['"]([^'"]+)['"]/g;
	for (const m of src.matchAll(gatingPattern)) {
		gatingEvents.add(m[1]);
	}

	// Match `triggerEvent: '<value>'` in object literals (the AgentInput emission).
	const emittedPattern = /triggerEvent\s*:\s*['"]([^'"]+)['"]/g;
	for (const m of src.matchAll(emittedPattern)) {
		emittedEvents.add(m[1]);
	}

	// PM status/label handlers intentionally centralize result assembly in shared
	// builders. Treat those builder calls as local emissions for this drift guard.
	if (src.includes('buildPMStatusDispatchResult')) {
		emittedEvents.add('pm:status-changed');
	}
	if (src.includes('buildPMLabelDispatchResult')) {
		emittedEvents.add('pm:label-added');
	}
	if (src.includes('buildReviewResult')) {
		emittedEvents.add('scm:check-suite-success');
	}
	if (src.includes('buildRespondToCiResult')) {
		emittedEvents.add('scm:check-suite-failure');
	}
	// `check-suite-failure.ts` returns the result of `dispatchRespondToCi(...)`,
	// which itself uses `buildRespondToCiResult`. Treat the dispatch helper
	// call as a local emission so the cross-file chain stays visible to the
	// gating-vs-emitted drift guard.
	if (src.includes('dispatchRespondToCi(')) {
		emittedEvents.add('scm:check-suite-failure');
	}
	if (src.includes('buildResolveConflictsResult')) {
		emittedEvents.add('scm:pr-conflict-detected');
	}

	return { file, gatingEvents, emittedEvents };
}

const RAW_TRIGGER_LITERAL_EXEMPTIONS = new Set<string>([
	// Existing handlers still pass literal event IDs into trigger-enabled gates
	// or inline legacy AgentInput objects. Keep exemptions exact and line-scoped:
	// new handlers or newly-added raw event literals must use TRIGGER_EVENTS
	// unless a new entry is added here with a reason.
	"src/triggers/trello/status-changed.ts :: 'pm:status-changed',",
	"src/triggers/github/pr-review-submitted.ts :: 'scm:pr-review-submitted',",
	"src/triggers/github/pr-review-submitted.ts :: triggerEvent: 'scm:pr-review-submitted',",
	"src/triggers/github/pr-merged.ts :: if (await checkTriggerEnabled(ctx.project.id, 'backlog-manager', 'scm:pr-merged', this.name)) {",
	"src/triggers/github/pr-merged.ts :: agentInput: { triggerEvent: 'scm:pr-merged', workItemId: workItemId },",
	"src/triggers/github/check-suite-success.ts :: 'scm:check-suite-success',",
	"src/triggers/github/check-suite-failure.ts :: 'scm:check-suite-failure',",
	"src/triggers/github/pr-conflict-detected.ts :: 'scm:pr-conflict-detected',",
	"src/triggers/github/review-requested.ts :: 'scm:review-requested',",
	"src/triggers/github/review-requested.ts :: triggerEvent: 'scm:review-requested',",
	// Biome formatter reflowed the `checkTriggerEnabled(...)` call to a single
	// line on 2026-05-09 (disabled-trigger-shadowing fix). The literal event
	// string still references TRIGGER_EVENTS conceptually but the line content
	// changed. Pin the new line so the static guard stays exact.
	"src/triggers/github/review-requested.ts :: if (!(await checkTriggerEnabled(ctx.project.id, 'review', 'scm:review-requested', this.name))) {",
	"src/triggers/github/pr-comment-mention.ts :: 'scm:pr-comment-mention',",
	"src/triggers/github/pr-comment-mention.ts :: triggerEvent: 'scm:pr-comment-mention',",
	"src/triggers/github/pr-opened.ts :: 'scm:pr-opened',",
	"src/triggers/github/pr-opened.ts :: triggerEvent: 'scm:pr-opened',",
	"src/triggers/github/respond-to-ci-dispatch.ts :: 'scm:check-suite-failure',",
	"src/triggers/trello/comment-mention.ts :: 'pm:comment-mention',",
	"src/triggers/trello/comment-mention.ts :: triggerEvent: 'pm:comment-mention',",
	"src/triggers/trello/label-added.ts :: if (!(await checkTriggerEnabled(ctx.project.id, agentType, 'pm:label-added', this.name))) {",
	"src/triggers/config-resolver.ts :: /** Trigger event identifier (e.g., 'pm:status-changed') */",
	"src/triggers/jira/status-changed.ts :: 'pm:status-changed',",
	"src/triggers/jira/comment-mention.ts :: 'pm:comment-mention',",
	"src/triggers/jira/comment-mention.ts :: triggerEvent: 'pm:comment-mention',",
	"src/triggers/shared/splitting-auto-chain.ts :: 'internal:auto-chain',",
	"src/triggers/shared/splitting-auto-chain.ts :: agentInput: { triggerEvent: 'internal:auto-chain', workItemId },",
	"src/triggers/shared/post-completion-review.ts :: triggerEvent: 'scm:check-suite-success',",
	"src/triggers/jira/label-added.ts :: if (!(await checkTriggerEnabled(ctx.project.id, agentType, 'pm:label-added', this.name))) {",
	"src/triggers/linear/comment-mention.ts :: 'pm:comment-mention',",
	"src/triggers/linear/comment-mention.ts :: triggerEvent: 'pm:comment-mention',",
	"src/triggers/linear/label-added.ts :: if (!(await checkTriggerEnabled(ctx.project.id, agentType, 'pm:label-added', this.name))) {",
	"src/triggers/linear/status-changed.ts :: 'pm:status-changed',",
	"src/triggers/sentry/alerting-metric.ts :: 'alerting:metric-alert',",
	"src/triggers/sentry/alerting-metric.ts :: triggerEvent: 'alerting:metric-alert',",
	"src/triggers/sentry/alerting-issue.ts :: 'alerting:issue-alert',",
	"src/triggers/sentry/alerting-issue.ts :: triggerEvent: 'alerting:issue-alert',",
]);

function findRawTriggerLiteralOccurrences(files: string[]): RawTriggerLiteralOccurrence[] {
	const escapedEvents = ALL_TRIGGER_EVENTS.map((event) =>
		event.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
	).join('|');
	const rawLiteralPattern = new RegExp(`[\`'"](${escapedEvents})[\`'"]`, 'g');

	return files
		.filter((file) => !file.endsWith('/shared/events.ts'))
		.flatMap((file) => {
			const relPath = file.replace(`${TRIGGERS_ROOT}/`, 'src/triggers/');
			const lines = readFileSync(file, 'utf-8').split('\n');
			return lines.flatMap((line, index) => {
				const matches = [...line.matchAll(rawLiteralPattern)];
				return matches.map((match) => ({
					file: relPath,
					lineNumber: index + 1,
					literal: match[1],
					line: line.trim(),
				}));
			});
		});
}

describe('trigger-event-string consistency (static guard)', () => {
	const allFiles = listHandlerFiles(TRIGGERS_ROOT).filter(
		(f) => !f.endsWith('/trigger-check.ts') && !EXEMPT_FILES.has(f),
	);
	const scans = allFiles
		.map(scanHandler)
		.filter((s) => s.gatingEvents.size > 0 || s.emittedEvents.size > 0);

	it('finds at least one trigger handler to scan (sanity)', () => {
		expect(scans.length).toBeGreaterThan(10);
	});

	it('covers every current built-in trigger source file', () => {
		const scannedFiles = new Set(allFiles);
		const missingFiles = BUILT_IN_TRIGGER_FILES.filter((file) => !scannedFiles.has(file));

		expect(
			missingFiles.map((file) => file.replace(`${TRIGGERS_ROOT}/`, 'src/triggers/')),
			`trigger-event-string consistency must scan every built-in trigger file registered by PM manifests, SCM, and alerting. ` +
				`Missing files:\n${missingFiles
					.map((file) => `  - ${file.replace(`${TRIGGERS_ROOT}/`, 'src/triggers/')}`)
					.join('\n')}`,
		).toEqual([]);
	});

	for (const scan of scans) {
		const relPath = scan.file.replace(`${TRIGGERS_ROOT}/`, 'src/triggers/');

		it(`${relPath}: every gating event is also emitted as triggerEvent`, () => {
			for (const gating of scan.gatingEvents) {
				expect(
					scan.emittedEvents.has(gating),
					`Handler ${relPath} calls checkTriggerEnabled(..., '${gating}', ...) but never emits ` +
						`triggerEvent: '${gating}'. ` +
						`Emitted events in this file: [${[...scan.emittedEvents].join(', ') || '(none)'}]. ` +
						`This silently disables the trigger in production: operators write the EMITTED ` +
						`event when they enable it via the dashboard, the gating check looks up a DB row ` +
						`that doesn't exist, falls back to the agent YAML's defaultEnabled (typically false), ` +
						`and the trigger never fires. Either fix the gating event string to match the emitted ` +
						`one, or — if the mismatch is intentional — add this file to EXEMPT_FILES with a ` +
						`comment explaining why.`,
				).toBe(true);
			}
		});
	}

	it('forbids new raw trigger-event literals outside the event catalog', () => {
		const occurrences = findRawTriggerLiteralOccurrences(allFiles);
		const unexpected = occurrences.filter(
			(occurrence) =>
				!RAW_TRIGGER_LITERAL_EXEMPTIONS.has(`${occurrence.file} :: ${occurrence.line}`),
		);

		expect(
			unexpected.map(
				(occurrence) =>
					`${occurrence.file}:${occurrence.lineNumber} raw ${occurrence.literal} in: ${occurrence.line}`,
			),
			`New trigger handlers must reference TRIGGER_EVENTS from src/triggers/shared/events.ts ` +
				`instead of adding raw event strings. If a literal is unavoidable, add a narrow ` +
				`RAW_TRIGGER_LITERAL_EXEMPTIONS entry with a reason. Unexpected raw literals:`,
		).toEqual([]);
	});
});
