import { afterEach, describe, expect, it } from 'vitest';

import {
	clearDiagnosticState,
	clearEditFailure,
	clearEditFailures,
	recordEditFailure,
} from '../../../../src/gadgets/shared/diagnosticState.js';

describe('editFailureTracking', () => {
	afterEach(() => {
		clearDiagnosticState();
	});

	describe('recordEditFailure', () => {
		it('returns 1 on first failure', () => {
			expect(recordEditFailure('/path/to/file.ts')).toBe(1);
		});

		it('increments on subsequent failures', () => {
			expect(recordEditFailure('/path/to/file.ts')).toBe(1);
			expect(recordEditFailure('/path/to/file.ts')).toBe(2);
			expect(recordEditFailure('/path/to/file.ts')).toBe(3);
		});

		it('tracks files independently', () => {
			recordEditFailure('/path/to/file1.ts');
			recordEditFailure('/path/to/file1.ts');
			expect(recordEditFailure('/path/to/file1.ts')).toBe(3);
			expect(recordEditFailure('/path/to/file2.ts')).toBe(1);
		});
	});

	describe('clearEditFailure', () => {
		it('resets counter for a specific file', () => {
			recordEditFailure('/path/to/file.ts');
			recordEditFailure('/path/to/file.ts');
			clearEditFailure('/path/to/file.ts');
			expect(recordEditFailure('/path/to/file.ts')).toBe(1);
		});

		it('does not affect other files', () => {
			recordEditFailure('/path/to/file1.ts');
			recordEditFailure('/path/to/file2.ts');
			recordEditFailure('/path/to/file2.ts');
			clearEditFailure('/path/to/file1.ts');
			expect(recordEditFailure('/path/to/file2.ts')).toBe(3);
		});

		it('handles clearing files that were not tracked', () => {
			clearEditFailure('/path/to/untracked.ts');
			expect(recordEditFailure('/path/to/untracked.ts')).toBe(1);
		});
	});

	describe('clearEditFailures', () => {
		it('resets all counters', () => {
			recordEditFailure('/path/to/file1.ts');
			recordEditFailure('/path/to/file2.ts');
			recordEditFailure('/path/to/file2.ts');
			clearEditFailures();
			expect(recordEditFailure('/path/to/file1.ts')).toBe(1);
			expect(recordEditFailure('/path/to/file2.ts')).toBe(1);
		});
	});

	describe('clearDiagnosticState includes edit failures', () => {
		it('resets edit failure counters', () => {
			recordEditFailure('/path/to/file.ts');
			recordEditFailure('/path/to/file.ts');
			clearDiagnosticState();
			expect(recordEditFailure('/path/to/file.ts')).toBe(1);
		});
	});
});
