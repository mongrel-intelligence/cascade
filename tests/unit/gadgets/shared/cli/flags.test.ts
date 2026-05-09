import { describe, expect, it } from 'vitest';

import {
	buildFlagsRecord,
	collectBooleanFlagNames,
	collectCandidateFlags,
} from '../../../../../src/gadgets/shared/cli/flags.js';
import type { ToolDefinition } from '../../../../../src/gadgets/shared/toolDefinition.js';

const def: ToolDefinition = {
	name: 'TestTool',
	description: 'Test',
	parameters: {
		comment: { type: 'string', describe: 'Internal', gadgetOnly: true },
		owner: { type: 'string', describe: 'Owner', required: true },
		body: { type: 'string', describe: 'Body', required: true },
		draft: { type: 'boolean', describe: 'Draft', optional: true, allowNo: true },
		labels: { type: 'array', items: 'string', describe: 'Labels', optional: true },
		comments: {
			type: 'array',
			items: 'object',
			describe: 'Inline comments',
			optional: true,
			cliAliases: ['comment'],
		},
	},
	cli: {
		autoResolved: [{ paramName: 'owner', resolvedFrom: 'git-remote' }],
		fileInputAlternatives: [{ paramName: 'body', fileFlag: 'body-file' }],
	},
};

describe('CLI flags', () => {
	it('builds flags while preserving optionality for auto-resolved and file-input params', () => {
		const flags = buildFlagsRecord(def);
		expect(flags.comment).toBeUndefined();
		expect(flags.owner).toBeDefined();
		expect(flags.owner.required).toBeFalsy();
		expect(flags.body.required).toBeFalsy();
		expect(flags['body-file']).toBeDefined();
		expect(flags.draft.allowNo).toBe(true);
		expect(flags.labels.multiple).toBe(true);
		expect(flags.comments.multiple).toBe(false);
		expect(flags.comments.aliases).toEqual(['comment']);
	});

	it('collects fuzzy-match candidates and boolean metadata', () => {
		expect(collectCandidateFlags(def)).toEqual([
			{ canonical: 'owner', aliases: [] },
			{ canonical: 'body', aliases: [] },
			{ canonical: 'draft', aliases: [] },
			{ canonical: 'labels', aliases: [] },
			{ canonical: 'comments', aliases: ['comment'] },
			{ canonical: 'body-file', aliases: [] },
		]);
		expect(collectBooleanFlagNames(def)).toEqual(new Map([['draft', true]]));
	});
});
