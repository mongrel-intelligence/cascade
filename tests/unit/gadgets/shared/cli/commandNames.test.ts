import { describe, expect, it } from 'vitest';

import {
	deriveCLICommand,
	toKebabCase,
} from '../../../../../src/gadgets/shared/cli/commandNames.js';

describe('CLI command names', () => {
	it('converts PascalCase and acronym-heavy names to kebab case', () => {
		expect(toKebabCase('PostComment')).toBe('post-comment');
		expect(toKebabCase('ReadWorkItem')).toBe('read-work-item');
		expect(toKebabCase('CreatePR')).toBe('create-pr');
		expect(toKebabCase('GetCIRunLogs')).toBe('get-ci-run-logs');
	});

	it('derives PM, SCM, and session command prefixes from tool names', () => {
		expect(deriveCLICommand('ReadWorkItem')).toBe('cascade-tools pm read-work-item');
		expect(deriveCLICommand('PMUpdateChecklistItem')).toBe(
			'cascade-tools pm update-checklist-item',
		);
		expect(deriveCLICommand('CreatePR')).toBe('cascade-tools scm create-pr');
		expect(deriveCLICommand('GetCIRunLogs')).toBe('cascade-tools scm get-ci-run-logs');
		expect(deriveCLICommand('Finish')).toBe('cascade-tools session finish');
	});

	it('honors explicit command overrides', () => {
		expect(deriveCLICommand('ReadWorkItem', 'cascade-tools custom read')).toBe(
			'cascade-tools custom read',
		);
	});
});
