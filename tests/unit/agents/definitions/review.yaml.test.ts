import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	clearDefinitionCache,
	loadBuiltinDefinition,
} from '../../../../src/agents/definitions/loader.js';

/**
 * The review agent's task prompt lives in `src/agents/definitions/review.yaml`.
 * These tests guard the SKIPPED FILES contract: when the pre-fetch omits files,
 * the agent needs to know how to fetch them on demand.
 */
describe('review.yaml prompt contract', () => {
	const yamlPath = join(__dirname, '../../../../src/agents/definitions/review.yaml');
	const yamlText = readFileSync(yamlPath, 'utf-8');

	it('names the SKIPPED FILES injection (AC #7)', () => {
		expect(yamlText).toMatch(/SKIPPED FILES/i);
	});

	it('tells the agent to fetch skipped files via `gh pr diff` or `Read`', () => {
		expect(yamlText).toMatch(/gh pr diff/);
		expect(yamlText).toMatch(/\bRead\b/);
	});

	it('describes the compact-diff context shape', () => {
		// Agent should know it will see per-file diffs (not full file contents).
		expect(yamlText.toLowerCase()).toMatch(/compact|per-file diff|diff\s+context/);
	});

	it('does not reference the old "full file contents" pre-fetch', () => {
		expect(yamlText.toLowerCase()).not.toContain('full file contents');
	});
});

/**
 * Work item context pipeline contract — guards that the review agent's three
 * triggers all include `workItem` in their contextPipeline so that the PM work
 * item is always pre-fetched and available to the agent.
 */
describe('review.yaml work item context pipeline contract', () => {
	afterEach(() => {
		clearDefinitionCache();
	});

	it('includes workItem in the scm:check-suite-success context pipeline', () => {
		const def = loadBuiltinDefinition('review');
		const trigger = def.triggers?.find((t) => t.event === 'scm:check-suite-success');
		expect(trigger).toBeDefined();
		expect(trigger?.contextPipeline).toContain('workItem');
	});

	it('includes workItem in the scm:review-requested context pipeline', () => {
		const def = loadBuiltinDefinition('review');
		const trigger = def.triggers?.find((t) => t.event === 'scm:review-requested');
		expect(trigger).toBeDefined();
		expect(trigger?.contextPipeline).toContain('workItem');
	});

	it('includes workItem in the scm:pr-opened context pipeline', () => {
		const def = loadBuiltinDefinition('review');
		const trigger = def.triggers?.find((t) => t.event === 'scm:pr-opened');
		expect(trigger).toBeDefined();
		expect(trigger?.contextPipeline).toContain('workItem');
	});

	it('task prompt mentions ReadWorkItem for work item context', () => {
		const def = loadBuiltinDefinition('review');
		const taskPrompt = def.prompts?.taskPrompt ?? '';
		expect(taskPrompt).toMatch(/ReadWorkItem/);
	});

	it('task prompt instructs agent to use work item to verify requirements', () => {
		const def = loadBuiltinDefinition('review');
		const taskPrompt = def.prompts?.taskPrompt ?? '';
		// Should mention acceptance criteria or requirements
		expect(taskPrompt.toLowerCase()).toMatch(/acceptance criteria|requirements/);
	});
});

/**
 * Work item context in the review.eta system prompt — guards that the prompt
 * template instructs the agent to verify code changes against PM work item
 * acceptance criteria and requirements.
 */
describe('review.eta work item context contract', () => {
	const etaPath = join(__dirname, '../../../../src/agents/prompts/templates/review.eta');
	const etaText = readFileSync(etaPath, 'utf-8');

	it('mentions ReadWorkItem injection in the review prompt template', () => {
		expect(etaText).toMatch(/ReadWorkItem/);
	});

	it('instructs agent to verify code against work item acceptance criteria', () => {
		expect(etaText.toLowerCase()).toMatch(/acceptance criteria/);
	});

	it('instructs agent to cross-reference work item requirements', () => {
		// Should mention cross-referencing or verifying against work item requirements
		expect(etaText.toLowerCase()).toMatch(/work item/);
		expect(etaText.toLowerCase()).toMatch(/requirements|acceptance criteria|checklists/);
	});
});
