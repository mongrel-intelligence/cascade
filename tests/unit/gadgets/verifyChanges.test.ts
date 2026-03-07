import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state — initialized before vi.mock factories
// ---------------------------------------------------------------------------

const {
	mockGetModifiedFiles,
	mockGetFilesWithErrors,
	mockRunDiagnosticsWithTracking,
	mockShouldRunDiagnostics,
	mockExistsSync,
	mockExecFileSync,
} = vi.hoisted(() => ({
	mockGetModifiedFiles: vi.fn<() => string[]>().mockReturnValue([]),
	mockGetFilesWithErrors: vi.fn().mockReturnValue([]),
	mockRunDiagnosticsWithTracking: vi.fn().mockReturnValue(null),
	mockShouldRunDiagnostics: vi.fn<(filePath: string) => boolean>().mockReturnValue(true),
	mockExistsSync: vi.fn<(path: unknown) => boolean>().mockReturnValue(false),
	mockExecFileSync: vi.fn().mockReturnValue(''),
}));

// Mock diagnosticState module
vi.mock('../../../src/gadgets/shared/diagnosticState.js', () => ({
	getModifiedFiles: mockGetModifiedFiles,
	getFilesWithErrors: mockGetFilesWithErrors,
	runDiagnosticsWithTracking: mockRunDiagnosticsWithTracking,
}));

// Mock diagnostics module
vi.mock('../../../src/gadgets/shared/diagnostics.js', () => ({
	shouldRunDiagnostics: mockShouldRunDiagnostics,
}));

// Mock fs.existsSync for on-verify.sh hook detection
vi.mock('node:fs', () => ({
	existsSync: mockExistsSync,
}));

// Mock child_process.execFileSync for running on-verify.sh
vi.mock('node:child_process', () => ({
	execFileSync: mockExecFileSync,
}));

// ---------------------------------------------------------------------------
// Import (after mocks)
// ---------------------------------------------------------------------------

import { VerifyChanges } from '../../../src/gadgets/VerifyChanges.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let gadget: VerifyChanges;

beforeEach(() => {
	gadget = new VerifyChanges();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('VerifyChanges', () => {
	describe('no modified files', () => {
		it('returns a nothing-to-verify message when no files have been modified', () => {
			mockGetModifiedFiles.mockReturnValue([]);

			const result = gadget.execute({ comment: 'check changes', scope: 'full' });

			expect(result).toContain('No files have been modified');
		});

		it('reports modified file count as 0', () => {
			mockGetModifiedFiles.mockReturnValue([]);

			const result = gadget.execute({ comment: 'check', scope: 'diagnostics' });

			expect(result).toContain('Modified files: 0');
		});
	});

	describe('scope=diagnostics', () => {
		beforeEach(() => {
			mockGetModifiedFiles.mockReturnValue(['src/foo.ts', 'src/bar.ts']);
			mockShouldRunDiagnostics.mockReturnValue(true);
			mockGetFilesWithErrors.mockReturnValue([]);
		});

		it('runs diagnostics on modified TypeScript files', () => {
			gadget.execute({ comment: 'check types', scope: 'diagnostics' });

			expect(mockRunDiagnosticsWithTracking).toHaveBeenCalledWith('src/foo.ts', 'src/foo.ts');
			expect(mockRunDiagnosticsWithTracking).toHaveBeenCalledWith('src/bar.ts', 'src/bar.ts');
		});

		it('does not run on-verify.sh tests', () => {
			gadget.execute({ comment: 'check types', scope: 'diagnostics' });

			expect(mockExecFileSync).not.toHaveBeenCalled();
		});

		it('reports all files pass when no errors', () => {
			mockGetFilesWithErrors.mockReturnValue([]);

			const result = gadget.execute({ comment: 'check types', scope: 'diagnostics' });

			expect(result).toContain('All');
			expect(result).toContain('pass');
		});

		it('reports errors when files have diagnostics issues', () => {
			mockGetFilesWithErrors.mockReturnValue([
				{
					filePath: 'src/foo.ts',
					hasTypeErrors: true,
					hasParseErrors: false,
					hasLintErrors: false,
					errors: [{ type: 'typescript', message: 'Type error', line: 5 }],
					lastChecked: new Date(),
				},
			]);

			const result = gadget.execute({ comment: 'check types', scope: 'diagnostics' });

			expect(result).toContain('src/foo.ts');
			expect(result).toContain('Some checks failed');
		});

		it('skips non-TypeScript files when shouldRunDiagnostics returns false', () => {
			mockGetModifiedFiles.mockReturnValue(['src/foo.ts', 'README.md']);
			mockShouldRunDiagnostics.mockImplementation((f: string) => f.endsWith('.ts'));

			gadget.execute({ comment: 'check types', scope: 'diagnostics' });

			expect(mockRunDiagnosticsWithTracking).toHaveBeenCalledTimes(1);
			expect(mockRunDiagnosticsWithTracking).toHaveBeenCalledWith('src/foo.ts', 'src/foo.ts');
		});

		it('includes --- Diagnostics --- section header', () => {
			const result = gadget.execute({ comment: 'check', scope: 'diagnostics' });

			expect(result).toContain('--- Diagnostics ---');
		});

		it('does not include --- Tests --- section header', () => {
			const result = gadget.execute({ comment: 'check', scope: 'diagnostics' });

			expect(result).not.toContain('--- Tests ---');
		});
	});

	describe('scope=tests', () => {
		beforeEach(() => {
			mockGetModifiedFiles.mockReturnValue(['src/foo.ts']);
		});

		it('runs on-verify.sh when the hook exists', () => {
			mockExistsSync.mockReturnValue(true);
			mockExecFileSync.mockReturnValue('All tests passed');

			gadget.execute({ comment: 'run tests', scope: 'tests' });

			expect(mockExecFileSync).toHaveBeenCalled();
		});

		it('does not run diagnostics', () => {
			mockExistsSync.mockReturnValue(true);
			mockExecFileSync.mockReturnValue('');

			gadget.execute({ comment: 'run tests', scope: 'tests' });

			expect(mockRunDiagnosticsWithTracking).not.toHaveBeenCalled();
		});

		it('returns informative message when on-verify.sh hook is missing', () => {
			mockExistsSync.mockReturnValue(false);

			const result = gadget.execute({ comment: 'run tests', scope: 'tests' });

			expect(result).toContain('No .cascade/on-verify.sh hook found');
		});

		it('reports all checks passed when hook exits successfully', () => {
			mockExistsSync.mockReturnValue(true);
			mockExecFileSync.mockReturnValue('');

			const result = gadget.execute({ comment: 'run tests', scope: 'tests' });

			expect(result).toContain('All checks passed');
		});

		it('reports failure when on-verify.sh exits with non-zero code', () => {
			mockExistsSync.mockReturnValue(true);
			const error = Object.assign(new Error('Command failed'), {
				status: 1,
				stdout: 'test output',
				stderr: '2 tests failed',
			});
			mockExecFileSync.mockImplementation(() => {
				throw error;
			});

			const result = gadget.execute({ comment: 'run tests', scope: 'tests' });

			expect(result).toContain('on-verify.sh failed');
			expect(result).toContain('Some checks failed');
		});

		it('includes --- Tests --- section header', () => {
			mockExistsSync.mockReturnValue(false);

			const result = gadget.execute({ comment: 'run tests', scope: 'tests' });

			expect(result).toContain('--- Tests ---');
		});

		it('does not include --- Diagnostics --- section header', () => {
			mockExistsSync.mockReturnValue(false);

			const result = gadget.execute({ comment: 'run tests', scope: 'tests' });

			expect(result).not.toContain('--- Diagnostics ---');
		});
	});

	describe('scope=full', () => {
		beforeEach(() => {
			mockGetModifiedFiles.mockReturnValue(['src/foo.ts']);
			mockShouldRunDiagnostics.mockReturnValue(true);
			mockGetFilesWithErrors.mockReturnValue([]);
		});

		it('runs both diagnostics and on-verify.sh hook', () => {
			mockExistsSync.mockReturnValue(true);
			mockExecFileSync.mockReturnValue('');

			gadget.execute({ comment: 'full check', scope: 'full' });

			expect(mockRunDiagnosticsWithTracking).toHaveBeenCalled();
			expect(mockExecFileSync).toHaveBeenCalled();
		});

		it('includes both --- Diagnostics --- and --- Tests --- section headers', () => {
			mockExistsSync.mockReturnValue(true);
			mockExecFileSync.mockReturnValue('');

			const result = gadget.execute({ comment: 'full check', scope: 'full' });

			expect(result).toContain('--- Diagnostics ---');
			expect(result).toContain('--- Tests ---');
		});

		it('reports all checks passed when both diagnostics and tests pass', () => {
			mockExistsSync.mockReturnValue(true);
			mockExecFileSync.mockReturnValue('');
			mockGetFilesWithErrors.mockReturnValue([]);

			const result = gadget.execute({ comment: 'full check', scope: 'full' });

			expect(result).toContain('All checks passed');
		});

		it('reports failure when diagnostics fail even if tests pass', () => {
			mockExistsSync.mockReturnValue(true);
			mockExecFileSync.mockReturnValue('');
			mockGetFilesWithErrors.mockReturnValue([
				{
					filePath: 'src/foo.ts',
					hasTypeErrors: true,
					hasParseErrors: false,
					hasLintErrors: false,
					errors: [{ type: 'typescript', message: 'TS error' }],
					lastChecked: new Date(),
				},
			]);

			const result = gadget.execute({ comment: 'full check', scope: 'full' });

			expect(result).toContain('Some checks failed');
		});

		it('reports failure when tests fail even if diagnostics pass', () => {
			mockGetFilesWithErrors.mockReturnValue([]);
			mockExistsSync.mockReturnValue(true);
			const error = Object.assign(new Error('Command failed'), {
				status: 1,
				stdout: '',
				stderr: 'test suite failed',
			});
			mockExecFileSync.mockImplementation(() => {
				throw error;
			});

			const result = gadget.execute({ comment: 'full check', scope: 'full' });

			expect(result).toContain('Some checks failed');
		});

		it('runs both diagnostics and tests when scope=full is explicitly set', () => {
			mockExistsSync.mockReturnValue(true);
			mockExecFileSync.mockReturnValue('');

			const result = gadget.execute({ comment: 'full scope check', scope: 'full' });

			expect(result).toContain('scope=full');
		});
	});

	describe('output header', () => {
		it('includes scope in the output header', () => {
			mockGetModifiedFiles.mockReturnValue([]);

			const result = gadget.execute({ comment: 'verify', scope: 'diagnostics' });

			expect(result).toContain('=== VerifyChanges (scope=diagnostics) ===');
		});

		it('shows modified file count in output header', () => {
			mockGetModifiedFiles.mockReturnValue(['src/a.ts', 'src/b.ts', 'src/c.ts']);
			mockShouldRunDiagnostics.mockReturnValue(true);
			mockGetFilesWithErrors.mockReturnValue([]);

			const result = gadget.execute({ comment: 'verify', scope: 'diagnostics' });

			expect(result).toContain('Modified files: 3');
		});
	});
});
