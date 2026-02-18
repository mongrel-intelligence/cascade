import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
	execFileSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
	existsSync: vi.fn(),
}));

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
	clearOnFileEditHookCache,
	runOnFileEditHook,
} from '../../../../src/gadgets/shared/onFileEditHook.js';

const mockExecFileSync = vi.mocked(execFileSync);
const mockExistsSync = vi.mocked(existsSync);

const FAKE_CWD = '/workspace/my-project';

beforeEach(() => {
	vi.spyOn(process, 'cwd').mockReturnValue(FAKE_CWD);
	clearOnFileEditHookCache();
	vi.clearAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('runOnFileEditHook', () => {
	describe('when hook does not exist', () => {
		it('returns null when hook file does not exist', () => {
			mockExistsSync.mockReturnValue(false);

			const result = runOnFileEditHook('src/index.ts');

			expect(result).toBeNull();
			expect(mockExecFileSync).not.toHaveBeenCalled();
		});

		it('checks the correct hook path', () => {
			mockExistsSync.mockReturnValue(false);

			runOnFileEditHook('src/index.ts');

			expect(mockExistsSync).toHaveBeenCalledWith(`${FAKE_CWD}/.cascade/on-file-edit.sh`);
		});
	});

	describe('when hook exists', () => {
		beforeEach(() => {
			mockExistsSync.mockReturnValue(true);
		});

		it('runs the hook with the file path', () => {
			mockExecFileSync.mockReturnValue('output' as unknown as Buffer);

			runOnFileEditHook('src/index.ts');

			expect(mockExecFileSync).toHaveBeenCalledWith(
				'bash',
				[`${FAKE_CWD}/.cascade/on-file-edit.sh`, 'src/index.ts'],
				expect.objectContaining({
					cwd: FAKE_CWD,
					timeout: 30000,
					encoding: 'utf-8',
				}),
			);
		});

		it('returns exitCode 0 and output on success', () => {
			mockExecFileSync.mockReturnValue('hook output' as unknown as Buffer);

			const result = runOnFileEditHook('src/index.ts');

			expect(result).toEqual({ exitCode: 0, output: 'hook output' });
		});

		it('returns exitCode 0 with empty output when hook returns undefined/null', () => {
			mockExecFileSync.mockReturnValue(undefined as unknown as Buffer);

			const result = runOnFileEditHook('src/index.ts');

			expect(result).toEqual({ exitCode: 0, output: '' });
		});

		it('returns exitCode and combined output when hook fails with exit code', () => {
			const error = Object.assign(new Error('Command failed'), {
				status: 1,
				stdout: 'stdout text',
				stderr: 'stderr text',
			});
			mockExecFileSync.mockImplementation(() => {
				throw error;
			});

			const result = runOnFileEditHook('src/index.ts');

			expect(result).toEqual({ exitCode: 1, output: 'stdout text\nstderr text' });
		});

		it('returns exitCode from status when only stderr', () => {
			const error = Object.assign(new Error('Command failed'), {
				status: 2,
				stdout: '',
				stderr: 'error message',
			});
			mockExecFileSync.mockImplementation(() => {
				throw error;
			});

			const result = runOnFileEditHook('src/index.ts');

			expect(result).toEqual({ exitCode: 2, output: 'error message' });
		});

		it('returns exitCode 1 and message for spawn/timeout errors', () => {
			const error = new Error('spawn error');
			mockExecFileSync.mockImplementation(() => {
				throw error;
			});

			const result = runOnFileEditHook('src/index.ts');

			expect(result).toEqual({ exitCode: 1, output: 'spawn error' });
		});

		it('returns unknown error message for errors without message', () => {
			const error = {};
			mockExecFileSync.mockImplementation(() => {
				throw error;
			});

			const result = runOnFileEditHook('src/index.ts');

			expect(result?.output).toBe('Unknown error running on-file-edit hook');
		});
	});

	describe('cache behavior', () => {
		it('only checks existence once per session', () => {
			mockExistsSync.mockReturnValue(false);

			runOnFileEditHook('file1.ts');
			runOnFileEditHook('file2.ts');
			runOnFileEditHook('file3.ts');

			// existsSync should only be called once due to caching
			expect(mockExistsSync).toHaveBeenCalledTimes(1);
		});

		it('caches positive result (hook exists)', () => {
			mockExistsSync.mockReturnValue(true);
			mockExecFileSync.mockReturnValue('ok' as unknown as Buffer);

			runOnFileEditHook('file1.ts');
			runOnFileEditHook('file2.ts');

			// existsSync called only once
			expect(mockExistsSync).toHaveBeenCalledTimes(1);
			// but execFileSync called for each file
			expect(mockExecFileSync).toHaveBeenCalledTimes(2);
		});

		it('clearOnFileEditHookCache resets the cache', () => {
			mockExistsSync.mockReturnValue(false);

			runOnFileEditHook('file1.ts');
			clearOnFileEditHookCache();
			runOnFileEditHook('file2.ts');

			// Should be called twice — once before clear, once after
			expect(mockExistsSync).toHaveBeenCalledTimes(2);
		});
	});
});
