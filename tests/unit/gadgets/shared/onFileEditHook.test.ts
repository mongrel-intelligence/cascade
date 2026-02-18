import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mocks before imports
const { mockExecFileSync, mockExistsSync } = vi.hoisted(() => ({
	mockExecFileSync: vi.fn(),
	mockExistsSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
	execFileSync: mockExecFileSync,
}));

vi.mock('node:fs', () => ({
	existsSync: mockExistsSync,
}));

import {
	clearOnFileEditHookCache,
	runOnFileEditHook,
} from '../../../../src/gadgets/shared/onFileEditHook.js';

describe('runOnFileEditHook', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		clearOnFileEditHookCache();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('when hook does not exist', () => {
		it('returns null when .cascade/on-file-edit.sh does not exist', () => {
			mockExistsSync.mockReturnValue(false);

			const result = runOnFileEditHook('src/file.ts');

			expect(result).toBeNull();
		});

		it('does not call execFileSync when hook does not exist', () => {
			mockExistsSync.mockReturnValue(false);

			runOnFileEditHook('src/file.ts');

			expect(mockExecFileSync).not.toHaveBeenCalled();
		});
	});

	describe('when hook exists and succeeds', () => {
		it('returns exitCode 0 and output when hook succeeds', () => {
			mockExistsSync.mockReturnValue(true);
			mockExecFileSync.mockReturnValue('All checks passed\n');

			const result = runOnFileEditHook('src/file.ts');

			expect(result).toEqual({ exitCode: 0, output: 'All checks passed\n' });
		});

		it('calls bash with the hook path and file path as arguments', () => {
			const cwd = process.cwd();
			mockExistsSync.mockReturnValue(true);
			mockExecFileSync.mockReturnValue('');

			runOnFileEditHook('src/some-file.ts');

			expect(mockExecFileSync).toHaveBeenCalledWith(
				'bash',
				[`${cwd}/.cascade/on-file-edit.sh`, 'src/some-file.ts'],
				expect.objectContaining({ cwd, timeout: 30000, encoding: 'utf-8' }),
			);
		});

		it('returns empty string output when hook outputs nothing', () => {
			mockExistsSync.mockReturnValue(true);
			mockExecFileSync.mockReturnValue(null); // execFileSync can return null

			const result = runOnFileEditHook('src/file.ts');

			expect(result).toEqual({ exitCode: 0, output: '' });
		});
	});

	describe('when hook exits with non-zero code', () => {
		it('returns the exit code and combined stdout/stderr', () => {
			mockExistsSync.mockReturnValue(true);
			const execError = Object.assign(new Error('Command failed'), {
				status: 1,
				stdout: 'stdout output',
				stderr: 'stderr output',
			});
			mockExecFileSync.mockImplementation(() => {
				throw execError;
			});

			const result = runOnFileEditHook('src/file.ts');

			expect(result).toEqual({ exitCode: 1, output: 'stdout output\nstderr output' });
		});

		it('handles non-zero exit with only stderr', () => {
			mockExistsSync.mockReturnValue(true);
			const execError = Object.assign(new Error('Command failed'), {
				status: 2,
				stdout: '',
				stderr: 'error details',
			});
			mockExecFileSync.mockImplementation(() => {
				throw execError;
			});

			const result = runOnFileEditHook('src/file.ts');

			expect(result).toEqual({ exitCode: 2, output: 'error details' });
		});

		it('handles non-zero exit with only stdout', () => {
			mockExistsSync.mockReturnValue(true);
			const execError = Object.assign(new Error('Command failed'), {
				status: 1,
				stdout: 'lint errors found',
				stderr: '',
			});
			mockExecFileSync.mockImplementation(() => {
				throw execError;
			});

			const result = runOnFileEditHook('src/file.ts');

			expect(result).toEqual({ exitCode: 1, output: 'lint errors found' });
		});
	});

	describe('when hook spawn/timeout fails', () => {
		it('returns exitCode 1 with error message on spawn failure', () => {
			mockExistsSync.mockReturnValue(true);
			const spawnError = new Error('spawn ENOENT');
			// No status property = spawn/timeout error
			mockExecFileSync.mockImplementation(() => {
				throw spawnError;
			});

			const result = runOnFileEditHook('src/file.ts');

			expect(result).toEqual({ exitCode: 1, output: 'spawn ENOENT' });
		});

		it('returns exitCode 1 with fallback message when error has no message', () => {
			mockExistsSync.mockReturnValue(true);
			const unknownError = {};
			mockExecFileSync.mockImplementation(() => {
				throw unknownError;
			});

			const result = runOnFileEditHook('src/file.ts');

			expect(result).toEqual({ exitCode: 1, output: 'Unknown error running on-file-edit hook' });
		});
	});

	describe('caching behavior', () => {
		it('only checks existence once (caches hook existence)', () => {
			mockExistsSync.mockReturnValue(true);
			mockExecFileSync.mockReturnValue('ok');

			runOnFileEditHook('src/file1.ts');
			runOnFileEditHook('src/file2.ts');

			// existsSync should only be called once — result is cached
			expect(mockExistsSync).toHaveBeenCalledTimes(1);
		});

		it('caches "does not exist" result as well', () => {
			mockExistsSync.mockReturnValue(false);

			runOnFileEditHook('src/file1.ts');
			runOnFileEditHook('src/file2.ts');

			expect(mockExistsSync).toHaveBeenCalledTimes(1);
			expect(mockExecFileSync).not.toHaveBeenCalled();
		});

		it('clearOnFileEditHookCache resets the cache so existsSync is called again', () => {
			mockExistsSync.mockReturnValue(false);

			runOnFileEditHook('src/file.ts');
			clearOnFileEditHookCache();
			runOnFileEditHook('src/file.ts');

			expect(mockExistsSync).toHaveBeenCalledTimes(2);
		});
	});
});
