import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// We need to mock fs for path resolution
vi.mock('node:fs', () => ({
	realpathSync: vi.fn(),
}));

import { realpathSync } from 'node:fs';
import { validatePath } from '../../../../src/gadgets/shared/pathValidation.js';

const mockRealpathSync = vi.mocked(realpathSync);

const FAKE_CWD = '/workspace/my-project';

beforeEach(() => {
	vi.spyOn(process, 'cwd').mockReturnValue(FAKE_CWD);
	// Default: realpathSync returns the resolved path
	mockRealpathSync.mockImplementation((p: unknown) => String(p));
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('validatePath', () => {
	describe('paths within CWD', () => {
		it('allows a relative path within CWD', () => {
			const result = validatePath('src/index.ts');
			expect(result).toBe(`${FAKE_CWD}/src/index.ts`);
		});

		it('allows an absolute path within CWD', () => {
			const result = validatePath(`${FAKE_CWD}/src/utils.ts`);
			expect(result).toBe(`${FAKE_CWD}/src/utils.ts`);
		});

		it('allows the CWD itself', () => {
			mockRealpathSync.mockReturnValue(FAKE_CWD);
			const result = validatePath('.');
			expect(result).toBe(FAKE_CWD);
		});

		it('allows nested paths within CWD', () => {
			const result = validatePath('a/b/c/d.ts');
			expect(result).toBe(`${FAKE_CWD}/a/b/c/d.ts`);
		});
	});

	describe('paths within /tmp', () => {
		it('allows /tmp path', () => {
			mockRealpathSync.mockReturnValue('/tmp/file.txt');
			const result = validatePath('/tmp/file.txt');
			expect(result).toBe('/tmp/file.txt');
		});

		it('allows nested /tmp path', () => {
			mockRealpathSync.mockReturnValue('/tmp/subdir/file.txt');
			const result = validatePath('/tmp/subdir/file.txt');
			expect(result).toBe('/tmp/subdir/file.txt');
		});
	});

	describe('paths outside allowed directories', () => {
		it('rejects path outside CWD', () => {
			expect(() => validatePath('/etc/passwd')).toThrow('Path access denied');
		});

		it('rejects parent directory traversal', () => {
			expect(() => validatePath('../outside/file.ts')).toThrow('Path access denied');
		});

		it('rejects path to /home directory', () => {
			expect(() => validatePath('/home/user/secret.txt')).toThrow('Path access denied');
		});

		it('includes the input path in error message', () => {
			expect(() => validatePath('/etc/passwd')).toThrow('/etc/passwd');
		});

		it('mentions allowed paths in error message', () => {
			expect(() => validatePath('/etc/passwd')).toThrow('/tmp');
		});
	});

	describe('ENOENT handling', () => {
		it('uses resolved path (not realpathSync result) when ENOENT', () => {
			const enoentError = Object.assign(new Error('no such file'), { code: 'ENOENT' });
			mockRealpathSync.mockImplementation(() => {
				throw enoentError;
			});

			// Path that resolves within CWD should be allowed
			const result = validatePath('new-file.ts');
			expect(result).toBe(`${FAKE_CWD}/new-file.ts`);
		});

		it('rejects ENOENT path outside CWD', () => {
			const enoentError = Object.assign(new Error('no such file'), { code: 'ENOENT' });
			mockRealpathSync.mockImplementation(() => {
				throw enoentError;
			});

			expect(() => validatePath('/etc/new-file.ts')).toThrow('Path access denied');
		});
	});

	describe('non-ENOENT fs errors', () => {
		it('re-throws non-ENOENT errors', () => {
			const permError = Object.assign(new Error('Permission denied'), { code: 'EACCES' });
			mockRealpathSync.mockImplementation(() => {
				throw permError;
			});

			expect(() => validatePath('some-file.ts')).toThrow('Permission denied');
		});
	});

	describe('path traversal attacks', () => {
		it('rejects path that traverses outside via symlink resolution', () => {
			// Simulate symlink pointing outside CWD
			mockRealpathSync.mockReturnValue('/etc/sensitive');
			expect(() => validatePath('link-to-outside')).toThrow('Path access denied');
		});

		it('handles paths that look like they start with CWD but are not within it', () => {
			// e.g. CWD is /workspace/project and path is /workspace/project-evil
			mockRealpathSync.mockReturnValue(`${FAKE_CWD}-evil/file.ts`);
			expect(() => validatePath(`${FAKE_CWD}-evil/file.ts`)).toThrow('Path access denied');
		});
	});
});
