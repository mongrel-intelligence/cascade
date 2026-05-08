/**
 * Static-analysis guard against the agentInput.workItemId-omission bug class.
 *
 * Every TriggerHandler that returns a TriggerResult dispatching a real agent
 * (`agentType: '<something>'` — not `null`) and sets a top-level `workItemId`
 * MUST also include `workItemId` inside the same return's `agentInput` object.
 *
 * Why: tryCreateRun (src/agents/shared/runTracking.ts) reads `input.workItemId`
 * from agentInput when persisting the run row to `agent_runs.work_item_id`.
 * If the trigger sets workItemId at the top level only, the DB column stays
 * NULL, and the dashboard's work-item page (which filters by that column)
 * silently hides the run. The runtime patch in runAgentExecutionPipeline
 * only repairs the field when the re-resolved value DIFFERS from the top-level
 * value, so a trigger that already populates the top-level field bypasses
 * the safety net entirely.
 *
 * Live incident: src/triggers/github/pr-review-submitted.ts and
 * src/triggers/github/pr-comment-mention.ts both shipped this omission.
 * Confirmed via `cascade runs list --project ucho` on 2026-04-29: 0/103
 * respond-to-review runs and 0/9 respond-to-pr-comment runs had a non-null
 * work_item_id, while every other agent-type populated it correctly. Four
 * respond-to-review runs for ucho/MNG-400 (PR #136) on 2026-04-28 were
 * invisible on the work-item page despite firing successfully.
 *
 * This test parses every trigger-handler file under `src/triggers/` via the
 * TypeScript AST and asserts the invariant. It does NOT execute the handlers;
 * it inspects every `return { agentType: ..., agentInput: { ... }, workItemId, ... }`
 * literal and fires loudly with a precise file:line reference when violated.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
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

interface Violation {
	file: string;
	line: number;
	agentType: string;
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

function findProperty(
	obj: ts.ObjectLiteralExpression,
	name: string,
): ts.PropertyAssignment | ts.ShorthandPropertyAssignment | undefined {
	for (const prop of obj.properties) {
		const propName = prop.name && ts.isIdentifier(prop.name) ? prop.name.text : undefined;
		if (propName !== name) continue;
		if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) return prop;
	}
	return undefined;
}

function getAgentTypeLiteral(obj: ts.ObjectLiteralExpression): string | null {
	const prop = findProperty(obj, 'agentType');
	if (!prop || !ts.isPropertyAssignment(prop)) return null;
	const init = prop.initializer;
	if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
		return init.text;
	}
	// Identifier (e.g. `agentType` shorthand from a variable) — can't statically
	// confirm a literal value but it's still a real dispatch, so flag for audit.
	if (ts.isIdentifier(init)) return init.text;
	return null;
}

/**
 * Inspect a single object literal that is the argument of a `return` statement.
 * Returns the agentType label if this return is a TriggerResult that violates
 * the invariant; returns null otherwise.
 */
function inspectReturnObject(obj: ts.ObjectLiteralExpression): string | null {
	const agentType = getAgentTypeLiteral(obj);
	// Skip lifecycle-only returns (`agentType: null`) — they don't run an
	// agent so workItemId is never persisted to agent_runs anyway.
	if (!agentType) return null;

	const outerWorkItemId = findProperty(obj, 'workItemId');
	const agentInputProp = findProperty(obj, 'agentInput');
	if (!outerWorkItemId || !agentInputProp) return null;

	// agentInput must be an object literal we can inspect statically. Spreads
	// or variable references are out of scope for this guard.
	if (
		!ts.isPropertyAssignment(agentInputProp) ||
		!ts.isObjectLiteralExpression(agentInputProp.initializer)
	) {
		return null;
	}

	const innerWorkItemId = findProperty(agentInputProp.initializer, 'workItemId');
	return innerWorkItemId ? null : agentType;
}

function scanFile(file: string): Violation[] {
	const src = readFileSync(file, 'utf-8');
	const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
	const violations: Violation[] = [];

	function visit(node: ts.Node): void {
		if (
			ts.isReturnStatement(node) &&
			node.expression &&
			ts.isObjectLiteralExpression(node.expression)
		) {
			const violatingAgentType = inspectReturnObject(node.expression);
			if (violatingAgentType) {
				const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
				violations.push({ file, line: line + 1, agentType: violatingAgentType });
			}
		}
		ts.forEachChild(node, visit);
	}

	visit(sf);
	return violations;
}

describe('trigger workItemId consistency (static guard)', () => {
	const allFiles = listHandlerFiles(TRIGGERS_ROOT);

	it('finds at least one trigger handler to scan (sanity)', () => {
		expect(allFiles.length).toBeGreaterThan(10);
	});

	it('covers every current built-in trigger source file', () => {
		const scannedFiles = new Set(allFiles);
		const missingFiles = BUILT_IN_TRIGGER_FILES.filter((file) => !scannedFiles.has(file));

		expect(
			missingFiles.map((file) => file.replace(`${TRIGGERS_ROOT}/`, 'src/triggers/')),
			`trigger workItemId consistency must scan every built-in trigger file registered by PM manifests, SCM, and alerting. ` +
				`Missing files:\n${missingFiles
					.map((file) => `  - ${file.replace(`${TRIGGERS_ROOT}/`, 'src/triggers/')}`)
					.join('\n')}`,
		).toEqual([]);
	});

	const allViolations = allFiles.flatMap(scanFile);

	it('every TriggerResult with a top-level workItemId also carries it inside agentInput', () => {
		const formatted = allViolations
			.map(
				(v) =>
					`  ${v.file.replace(`${TRIGGERS_ROOT}/`, 'src/triggers/')}:${v.line}  agentType=${v.agentType}`,
			)
			.join('\n');
		expect(
			allViolations,
			allViolations.length === 0
				? ''
				: `Found ${allViolations.length} TriggerResult return(s) that set workItemId at the top level ` +
						`but omit it from agentInput:\n${formatted}\n\n` +
						`tryCreateRun (src/agents/shared/runTracking.ts) reads workItemId from agentInput; ` +
						`omitting it leaves agent_runs.work_item_id NULL and hides the run from the work-item ` +
						`page. Add \`workItemId\` (shorthand is fine) to the agentInput object in each listed return.`,
		).toEqual([]);
	});
});
