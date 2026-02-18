import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mocks before imports
const {
	mockRunOnFileEditHook,
	mockRunDiagnosticsWithTracking,
	mockTrackModifiedFile,
	mockRecordDiagnosticLoop,
	mockClearDiagnosticLoop,
} = vi.hoisted(() => ({
	mockRunOnFileEditHook: vi.fn(),
	mockRunDiagnosticsWithTracking: vi.fn(),
	mockTrackModifiedFile: vi.fn(),
	mockRecordDiagnosticLoop: vi.fn(),
	mockClearDiagnosticLoop: vi.fn(),
}));

vi.mock('../../../../src/gadgets/shared/onFileEditHook.js', () => ({
	runOnFileEditHook: mockRunOnFileEditHook,
}));

vi.mock('../../../../src/gadgets/shared/diagnosticState.js', () => ({
	runDiagnosticsWithTracking: mockRunDiagnosticsWithTracking,
	trackModifiedFile: mockTrackModifiedFile,
	recordDiagnosticLoop: mockRecordDiagnosticLoop,
	clearDiagnosticLoop: mockClearDiagnosticLoop,
}));

import { runPostEditChecks } from '../../../../src/gadgets/shared/postEditChecks.js';

describe('runPostEditChecks', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('always calls trackModifiedFile with the file path', () => {
		mockRunOnFileEditHook.mockReturnValue(null);
		mockRunDiagnosticsWithTracking.mockReturnValue(null);

		runPostEditChecks('src/file.ts', '/abs/src/file.ts');

		expect(mockTrackModifiedFile).toHaveBeenCalledWith('src/file.ts');
	});

	describe('when on-file-edit hook is present', () => {
		it('routes to hook and returns hook result when hook succeeds', () => {
			mockRunOnFileEditHook.mockReturnValue({ exitCode: 0, output: 'all good' });

			const result = runPostEditChecks('src/file.ts', '/abs/src/file.ts');

			expect(result).not.toBeNull();
			expect(result?.hasErrors).toBe(false);
			expect(result?.statusMessage).toContain('on-file-edit');
			expect(mockRunDiagnosticsWithTracking).not.toHaveBeenCalled();
		});

		it('returns hasErrors=true when hook exits with non-zero code', () => {
			mockRunOnFileEditHook.mockReturnValue({ exitCode: 1, output: 'lint error found' });

			const result = runPostEditChecks('src/file.ts', '/abs/src/file.ts');

			expect(result?.hasErrors).toBe(true);
			expect(result?.statusMessage).toContain('lint error found');
		});

		it('calls recordDiagnosticLoop when hook has errors', () => {
			mockRunOnFileEditHook.mockReturnValue({ exitCode: 1, output: 'error' });

			runPostEditChecks('src/file.ts', '/abs/src/file.ts');

			expect(mockRecordDiagnosticLoop).toHaveBeenCalledWith('src/file.ts');
			expect(mockClearDiagnosticLoop).not.toHaveBeenCalled();
		});

		it('calls clearDiagnosticLoop when hook succeeds', () => {
			mockRunOnFileEditHook.mockReturnValue({ exitCode: 0, output: '' });

			runPostEditChecks('src/file.ts', '/abs/src/file.ts');

			expect(mockClearDiagnosticLoop).toHaveBeenCalledWith('src/file.ts');
			expect(mockRecordDiagnosticLoop).not.toHaveBeenCalled();
		});

		it('includes output in statusMessage when hook has output', () => {
			mockRunOnFileEditHook.mockReturnValue({ exitCode: 0, output: 'formatted 3 files' });

			const result = runPostEditChecks('src/file.ts', '/abs/src/file.ts');

			expect(result?.statusMessage).toContain('formatted 3 files');
		});

		it('shows warning message in statusMessage when hook errors with no output', () => {
			mockRunOnFileEditHook.mockReturnValue({ exitCode: 1, output: '' });

			const result = runPostEditChecks('src/file.ts', '/abs/src/file.ts');

			expect(result?.statusMessage).toContain('⚠️ Hook exited with errors');
		});

		it('shows success message in statusMessage when hook succeeds with no output', () => {
			mockRunOnFileEditHook.mockReturnValue({ exitCode: 0, output: '' });

			const result = runPostEditChecks('src/file.ts', '/abs/src/file.ts');

			expect(result?.statusMessage).toContain('✓ No issues');
		});

		it('sets hasTypeErrors=true and other error flags=false in fullResult', () => {
			mockRunOnFileEditHook.mockReturnValue({ exitCode: 1, output: 'type error' });

			const result = runPostEditChecks('src/file.ts', '/abs/src/file.ts');

			expect(result?.fullResult.hasTypeErrors).toBe(true);
			expect(result?.fullResult.hasParseErrors).toBe(false);
			expect(result?.fullResult.hasLintErrors).toBe(false);
		});
	});

	describe('when no hook is present (falls back to diagnostics)', () => {
		it('calls runDiagnosticsWithTracking when hook returns null', () => {
			mockRunOnFileEditHook.mockReturnValue(null);
			mockRunDiagnosticsWithTracking.mockReturnValue(null);

			runPostEditChecks('src/file.ts', '/abs/src/file.ts');

			expect(mockRunDiagnosticsWithTracking).toHaveBeenCalledWith(
				'src/file.ts',
				'/abs/src/file.ts',
			);
		});

		it('returns diagnostics result when no hook exists', () => {
			mockRunOnFileEditHook.mockReturnValue(null);
			const diagResult = {
				hasErrors: false,
				statusMessage: '✓ No issues',
				fullResult: {
					output: '',
					hasParseErrors: false,
					hasTypeErrors: false,
					hasLintErrors: false,
				},
			};
			mockRunDiagnosticsWithTracking.mockReturnValue(diagResult);

			const result = runPostEditChecks('src/file.ts', '/abs/src/file.ts');

			expect(result).toEqual(diagResult);
		});

		it('calls recordDiagnosticLoop when diagnostics have errors', () => {
			mockRunOnFileEditHook.mockReturnValue(null);
			mockRunDiagnosticsWithTracking.mockReturnValue({
				hasErrors: true,
				statusMessage: '⚠️ 1 error',
				fullResult: {
					output: '',
					hasParseErrors: false,
					hasTypeErrors: true,
					hasLintErrors: false,
				},
			});

			runPostEditChecks('src/file.ts', '/abs/src/file.ts');

			expect(mockRecordDiagnosticLoop).toHaveBeenCalledWith('src/file.ts');
		});

		it('calls clearDiagnosticLoop when diagnostics pass', () => {
			mockRunOnFileEditHook.mockReturnValue(null);
			mockRunDiagnosticsWithTracking.mockReturnValue({
				hasErrors: false,
				statusMessage: '✓ No issues',
				fullResult: {
					output: '',
					hasParseErrors: false,
					hasTypeErrors: false,
					hasLintErrors: false,
				},
			});

			runPostEditChecks('src/file.ts', '/abs/src/file.ts');

			expect(mockClearDiagnosticLoop).toHaveBeenCalledWith('src/file.ts');
		});

		it('returns null when diagnostics do not apply (non-TS file)', () => {
			mockRunOnFileEditHook.mockReturnValue(null);
			mockRunDiagnosticsWithTracking.mockReturnValue(null);

			const result = runPostEditChecks('README.md', '/abs/README.md');

			expect(result).toBeNull();
		});
	});
});
