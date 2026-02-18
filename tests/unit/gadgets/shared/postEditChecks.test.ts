import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/gadgets/shared/onFileEditHook.js', () => ({
	runOnFileEditHook: vi.fn(),
}));

vi.mock('../../../../src/gadgets/shared/diagnosticState.js', () => ({
	trackModifiedFile: vi.fn(),
	runDiagnosticsWithTracking: vi.fn(),
	recordDiagnosticLoop: vi.fn(),
	clearDiagnosticLoop: vi.fn(),
}));

import {
	clearDiagnosticLoop,
	recordDiagnosticLoop,
	runDiagnosticsWithTracking,
	trackModifiedFile,
} from '../../../../src/gadgets/shared/diagnosticState.js';
import { runOnFileEditHook } from '../../../../src/gadgets/shared/onFileEditHook.js';
import { runPostEditChecks } from '../../../../src/gadgets/shared/postEditChecks.js';

const mockRunOnFileEditHook = vi.mocked(runOnFileEditHook);
const mockRunDiagnosticsWithTracking = vi.mocked(runDiagnosticsWithTracking);
const mockTrackModifiedFile = vi.mocked(trackModifiedFile);
const mockRecordDiagnosticLoop = vi.mocked(recordDiagnosticLoop);
const mockClearDiagnosticLoop = vi.mocked(clearDiagnosticLoop);

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('runPostEditChecks', () => {
	it('always tracks the modified file', () => {
		mockRunOnFileEditHook.mockReturnValue(null);
		mockRunDiagnosticsWithTracking.mockReturnValue(null);

		runPostEditChecks('src/index.ts', '/abs/src/index.ts');

		expect(mockTrackModifiedFile).toHaveBeenCalledWith('src/index.ts');
	});

	describe('when on-file-edit hook is present', () => {
		it('returns null from diagnostics path and uses hook result', () => {
			mockRunOnFileEditHook.mockReturnValue({ exitCode: 0, output: 'All good' });

			const result = runPostEditChecks('src/index.ts', '/abs/src/index.ts');

			expect(result).not.toBeNull();
			expect(mockRunDiagnosticsWithTracking).not.toHaveBeenCalled();
		});

		it('returns success result when hook exits with 0', () => {
			mockRunOnFileEditHook.mockReturnValue({ exitCode: 0, output: 'Checks passed' });

			const result = runPostEditChecks('src/index.ts', '/abs/src/index.ts');

			expect(result?.hasErrors).toBe(false);
			expect(result?.statusMessage).toContain('on-file-edit');
			expect(result?.statusMessage).toContain('Checks passed');
		});

		it('returns error result when hook exits with non-zero', () => {
			mockRunOnFileEditHook.mockReturnValue({ exitCode: 1, output: 'Type error found' });

			const result = runPostEditChecks('src/index.ts', '/abs/src/index.ts');

			expect(result?.hasErrors).toBe(true);
			expect(result?.statusMessage).toContain('on-file-edit');
			expect(result?.statusMessage).toContain('Type error found');
		});

		it('shows default error message when hook has errors but no output', () => {
			mockRunOnFileEditHook.mockReturnValue({ exitCode: 1, output: '' });

			const result = runPostEditChecks('src/index.ts', '/abs/src/index.ts');

			expect(result?.hasErrors).toBe(true);
			expect(result?.statusMessage).toContain('⚠️ Hook exited with errors');
		});

		it('shows success message when hook succeeds with no output', () => {
			mockRunOnFileEditHook.mockReturnValue({ exitCode: 0, output: '' });

			const result = runPostEditChecks('src/index.ts', '/abs/src/index.ts');

			expect(result?.hasErrors).toBe(false);
			expect(result?.statusMessage).toContain('✓ No issues');
		});

		it('sets fullResult.hasTypeErrors true when hook fails', () => {
			mockRunOnFileEditHook.mockReturnValue({ exitCode: 1, output: 'error' });

			const result = runPostEditChecks('src/index.ts', '/abs/src/index.ts');

			expect(result?.fullResult.hasTypeErrors).toBe(true);
			expect(result?.fullResult.hasParseErrors).toBe(false);
			expect(result?.fullResult.hasLintErrors).toBe(false);
		});

		it('records diagnostic loop when hook fails', () => {
			mockRunOnFileEditHook.mockReturnValue({ exitCode: 1, output: 'error' });

			runPostEditChecks('src/index.ts', '/abs/src/index.ts');

			expect(mockRecordDiagnosticLoop).toHaveBeenCalledWith('src/index.ts');
			expect(mockClearDiagnosticLoop).not.toHaveBeenCalled();
		});

		it('clears diagnostic loop when hook succeeds', () => {
			mockRunOnFileEditHook.mockReturnValue({ exitCode: 0, output: 'ok' });

			runPostEditChecks('src/index.ts', '/abs/src/index.ts');

			expect(mockClearDiagnosticLoop).toHaveBeenCalledWith('src/index.ts');
			expect(mockRecordDiagnosticLoop).not.toHaveBeenCalled();
		});
	});

	describe('when on-file-edit hook is absent (null)', () => {
		it('falls back to runDiagnosticsWithTracking', () => {
			mockRunOnFileEditHook.mockReturnValue(null);
			mockRunDiagnosticsWithTracking.mockReturnValue({
				hasErrors: false,
				statusMessage: '✓ No issues',
				fullResult: {
					hasParseErrors: false,
					hasTypeErrors: false,
					hasLintErrors: false,
					output: '',
				},
			});

			const result = runPostEditChecks('src/index.ts', '/abs/src/index.ts');

			expect(mockRunDiagnosticsWithTracking).toHaveBeenCalledWith(
				'src/index.ts',
				'/abs/src/index.ts',
			);
			expect(result?.hasErrors).toBe(false);
		});

		it('records diagnostic loop when diagnostics fail', () => {
			mockRunOnFileEditHook.mockReturnValue(null);
			mockRunDiagnosticsWithTracking.mockReturnValue({
				hasErrors: true,
				statusMessage: '⚠️ errors',
				fullResult: {
					hasParseErrors: false,
					hasTypeErrors: true,
					hasLintErrors: false,
					output: '',
				},
			});

			runPostEditChecks('src/index.ts', '/abs/src/index.ts');

			expect(mockRecordDiagnosticLoop).toHaveBeenCalledWith('src/index.ts');
		});

		it('clears diagnostic loop when diagnostics pass', () => {
			mockRunOnFileEditHook.mockReturnValue(null);
			mockRunDiagnosticsWithTracking.mockReturnValue({
				hasErrors: false,
				statusMessage: '✓ No issues',
				fullResult: {
					hasParseErrors: false,
					hasTypeErrors: false,
					hasLintErrors: false,
					output: '',
				},
			});

			runPostEditChecks('src/index.ts', '/abs/src/index.ts');

			expect(mockClearDiagnosticLoop).toHaveBeenCalledWith('src/index.ts');
		});

		it('returns null when diagnostics return null', () => {
			mockRunOnFileEditHook.mockReturnValue(null);
			mockRunDiagnosticsWithTracking.mockReturnValue(null);

			const result = runPostEditChecks('src/index.ts', '/abs/src/index.ts');

			expect(result).toBeNull();
			expect(mockRecordDiagnosticLoop).not.toHaveBeenCalled();
			expect(mockClearDiagnosticLoop).not.toHaveBeenCalled();
		});
	});
});
