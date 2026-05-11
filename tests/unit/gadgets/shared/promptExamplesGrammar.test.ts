/**
 * Static guard — every cascade-tools example rendered into the agent system
 * prompt must mirror the canonical CLI grammar.
 *
 * Spec 014 regression net for prod incident 2026-05-09: 9/14 codex runs
 * hit `--includeComments true` because the prompt example said exactly that
 * while oclif's `Flags.boolean({ allowNo: true })` rejects the value form
 * (silent exit 2, empty stdout, contract bypass). The rule:
 *
 * - boolean param example=true  → `# example: --<key>`
 * - boolean param example=false → `# example: --no-<key>`
 * - never `--<key> 'true'` / `--<key> 'false'`
 *
 * This test iterates every real ToolDefinition shipped in the four category
 * barrels and asserts the invariant against the rendered tool guidance. A new
 * gadget that ships a boolean+example combo will pass automatically; one that
 * hand-rolls a divergent renderer will fail loudly with a precise file:line.
 */

import { describe, expect, it } from 'vitest';

import { buildToolGuidance } from '../../../../src/backends/shared/nativeToolPrompts.js';
import * as githubDefs from '../../../../src/gadgets/github/definitions.js';
import { createPRReviewDef } from '../../../../src/gadgets/github/definitions.js';
import * as pmDefs from '../../../../src/gadgets/pm/definitions.js';
import { readWorkItemDef } from '../../../../src/gadgets/pm/definitions.js';
import * as sentryDefs from '../../../../src/gadgets/sentry/definitions.js';
import * as sessionDefs from '../../../../src/gadgets/session/definitions.js';
import { generateToolManifest } from '../../../../src/gadgets/shared/manifestGenerator.js';
import type { ToolDefinition } from '../../../../src/gadgets/shared/toolDefinition.js';

function collectAllDefs(): ToolDefinition[] {
	const candidates: unknown[] = [
		...Object.values(githubDefs),
		...Object.values(pmDefs),
		...Object.values(sentryDefs),
		...Object.values(sessionDefs),
	];
	const defs: ToolDefinition[] = [];
	for (const c of candidates) {
		if (c && typeof c === 'object' && 'name' in c && 'parameters' in c) {
			defs.push(c as ToolDefinition);
		}
	}
	return defs;
}

const allDefs = collectAllDefs();

describe('prompt-rendered examples — CLI grammar correctness', () => {
	it('discovered at least the 23 known gadget definitions', () => {
		expect(allDefs.length).toBeGreaterThanOrEqual(23);
	});

	for (const def of allDefs) {
		const booleanFlagNames = Object.entries(def.parameters)
			.filter(([, p]) => p.type === 'boolean' && !p.gadgetOnly)
			.map(([k]) => k);

		if (booleanFlagNames.length === 0) continue;

		it(`${def.name}: boolean flag examples mirror canonical toggle grammar`, () => {
			const manifest = generateToolManifest(def);
			const rendered = buildToolGuidance([manifest]);

			for (const flagName of booleanFlagNames) {
				// The prod regression: `# example: --includeComments 'true'`.
				// Oclif rejects that form. Assert the renderer never emits it.
				expect(
					rendered,
					`${def.name}.${flagName} must not render --${flagName} 'true'`,
				).not.toContain(`--${flagName} 'true'`);
				expect(
					rendered,
					`${def.name}.${flagName} must not render --${flagName} "true"`,
				).not.toContain(`--${flagName} "true"`);
				expect(
					rendered,
					`${def.name}.${flagName} must not render --${flagName} 'false'`,
				).not.toContain(`--${flagName} 'false'`);
				expect(
					rendered,
					`${def.name}.${flagName} must not render --${flagName} "false"`,
				).not.toContain(`--${flagName} "false"`);
			}
		});
	}

	it('CreatePRReview renders enum examples as raw CLI values', () => {
		const manifest = generateToolManifest(createPRReviewDef);
		const rendered = buildToolGuidance([manifest]);

		expect(rendered).toContain('# example: --event APPROVE');
		expect(rendered).not.toContain(`--event '"APPROVE"'`);
		expect(rendered).not.toContain(`--event '"REQUEST_CHANGES"'`);
		expect(rendered).not.toContain(`--event '"COMMENT"'`);
	});

	it('ReadWorkItem renders shell-safe PM IDs without literal quotes', () => {
		const manifest = generateToolManifest(readWorkItemDef);
		const rendered = buildToolGuidance([manifest]);

		expect(rendered).toContain('# example: --workItemId abc123');
		expect(rendered).not.toContain(`--workItemId '"abc123"'`);
		expect(rendered).not.toContain(`--workItemId 'abc123'`);
		expect(rendered).not.toContain(`--workItemId "abc123"`);
	});

	it('CreatePRReview keeps array-of-object comments as JSON payload examples', () => {
		const manifest = generateToolManifest(createPRReviewDef);
		const rendered = buildToolGuidance([manifest]);

		expect(rendered).toContain(
			`# example: --comments '${JSON.stringify([
				{
					path: 'src/utils.ts',
					line: 15,
					body: 'This could cause a null pointer exception. Please add a null check.',
				},
			])}'`,
		);
		expect(rendered).not.toContain('--comments <string> (repeatable)');
		expect(rendered).not.toContain('--comments path');
	});

	for (const def of allDefs) {
		const enumFlagNames = Object.entries(def.parameters)
			.filter(([, p]) => p.type === 'enum' && !p.gadgetOnly)
			.map(([k]) => k);

		if (enumFlagNames.length === 0) continue;

		it(`${def.name}: enum flag examples use raw CLI grammar`, () => {
			const manifest = generateToolManifest(def);
			const rendered = buildToolGuidance([manifest]);

			for (const flagName of enumFlagNames) {
				const options =
					def.parameters[flagName]?.type === 'enum' ? def.parameters[flagName].options : [];
				for (const option of options) {
					expect(
						rendered,
						`${def.name}.${flagName} must not render --${flagName} '"${option}"'`,
					).not.toContain(`--${flagName} '"${option}"'`);
				}
			}
		});
	}
});
