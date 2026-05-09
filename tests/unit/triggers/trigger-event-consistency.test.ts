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

	return { file, gatingEvents, emittedEvents };
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
});
