import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

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
