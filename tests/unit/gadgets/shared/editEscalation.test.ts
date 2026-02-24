import { afterEach, describe, expect, it } from 'vitest';

import { clearDiagnosticState } from '../../../../src/gadgets/shared/diagnosticState.js';
import {
	ESCALATION_HINT,
	withEscalationHint,
} from '../../../../src/gadgets/shared/editEscalation.js';

describe('editEscalation', () => {
	afterEach(() => {
		clearDiagnosticState();
	});

	describe('ESCALATION_HINT', () => {
		it('is a non-empty string', () => {
			expect(typeof ESCALATION_HINT).toBe('string');
			expect(ESCALATION_HINT.length).toBeGreaterThan(0);
		});

		it('contains guidance about ReadFile/WriteFile', () => {
			expect(ESCALATION_HINT).toContain('ReadFile');
			expect(ESCALATION_HINT).toContain('WriteFile');
		});
	});

	describe('withEscalationHint', () => {
		it('returns message unchanged on first failure', () => {
			const result = withEscalationHint('Some error', '/path/to/file.ts');
			expect(result).toBe('Some error');
		});

		it('returns message unchanged on second failure', () => {
			withEscalationHint('first failure', '/path/to/file.ts');
			// The second call records failure count 2 — hint kicks in at >= 2
			const result = withEscalationHint('second failure', '/path/to/file.ts');
			expect(result).toBe(`second failure${ESCALATION_HINT}`);
		});

		it('appends escalation hint from the second failure onward', () => {
			withEscalationHint('msg', '/path/to/file.ts'); // count = 1
			const second = withEscalationHint('msg', '/path/to/file.ts'); // count = 2
			const third = withEscalationHint('msg', '/path/to/file.ts'); // count = 3

			expect(second).toContain(ESCALATION_HINT);
			expect(third).toContain(ESCALATION_HINT);
		});

		it('tracks failure counts per file independently', () => {
			withEscalationHint('msg', '/path/to/file1.ts'); // file1: count = 1
			const resultFile2 = withEscalationHint('msg', '/path/to/file2.ts'); // file2: count = 1

			// file2 count is only 1, so no hint
			expect(resultFile2).toBe('msg');

			// file1 second failure triggers hint
			const resultFile1 = withEscalationHint('msg', '/path/to/file1.ts'); // file1: count = 2
			expect(resultFile1).toContain(ESCALATION_HINT);
		});
	});
});
