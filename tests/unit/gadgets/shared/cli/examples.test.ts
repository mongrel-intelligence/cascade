import { describe, expect, it } from 'vitest';

import {
	buildOclifExamples,
	expectedShapeFor,
	findExampleForParam,
	shellQuote,
} from '../../../../../src/gadgets/shared/cli/examples.js';
import type { ToolDefinition } from '../../../../../src/gadgets/shared/toolDefinition.js';

const reviewDef: ToolDefinition = {
	name: 'CreatePRReview',
	description: 'Review a PR',
	parameters: {
		body: { type: 'string', describe: 'Review body', required: true },
		draft: { type: 'boolean', describe: 'Draft review', optional: true, allowNo: true },
		labels: { type: 'array', items: 'string', describe: 'Labels', optional: true },
		comments: { type: 'array', items: 'object', describe: 'Inline comments', optional: true },
		comment: { type: 'string', describe: 'Internal rationale', gadgetOnly: true },
	},
	examples: [
		{
			params: {
				body: "Don't merge yet",
				draft: false,
				labels: ['needs-work', 'api'],
				comments: [{ path: 'src/a.ts', line: 3, body: 'nit' }],
				comment: 'hidden',
			},
		},
	],
};

describe('CLI examples', () => {
	it('finds the first defined example value for a parameter', () => {
		expect(findExampleForParam(reviewDef.examples, 'comments')).toEqual([
			{ path: 'src/a.ts', line: 3, body: 'nit' },
		]);
		expect(findExampleForParam(reviewDef.examples, 'missing')).toBeUndefined();
	});

	it('shell-quotes embedded single quotes safely', () => {
		expect(shellQuote("don't")).toBe("'don'\\''t'");
	});

	it('renders oclif examples while skipping gadget-only params', () => {
		const [line] = buildOclifExamples(reviewDef, 'cascade-tools scm create-pr-review');
		expect(line).toContain("cascade-tools scm create-pr-review --body 'Don'\\''t merge yet'");
		expect(line).toContain('--no-draft');
		expect(line).toContain("--labels 'needs-work' --labels 'api'");
		expect(line).toContain('--comments \'[{"path":"src/a.ts","line":3,"body":"nit"}]\'');
		expect(line).not.toContain('hidden');
	});

	it('uses examples as JSON expected-shape hints with describe fallback', () => {
		const paramDef = reviewDef.parameters.comments;
		expect(expectedShapeFor(paramDef, [{ path: 'x.ts' }])).toBe('[{"path":"x.ts"}]');
		expect(expectedShapeFor(paramDef)).toBe('Inline comments');
	});
});
