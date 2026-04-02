import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mocks before imports
const { mockRealpathSync } = vi.hoisted(() => ({
	mockRealpathSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
	realpathSync: mockRealpathSync,
}));

vi.mock('../../../../src/utils/repo.js', () => ({
	getWorkspaceDir: () => '/workspace',
}));

import { validatePath } from '../../../../src/gadgets/shared/pathValidation.js';

describe('validatePath', () => {
	const _originalCwd = process.cwd();

	beforeEach(() => {
		vi.resetAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('paths within CWD', () => {
		it('accepts a relative path within CWD', () => {
			const cwd = '/workspace/myproject';
			vi.spyOn(process, 'cwd').mockReturnValue(cwd);
			mockRealpathSync.mockReturnValue('/workspace/myproject/src/file.ts');

			const result = validatePath('src/file.ts');

			expect(result).toBe('/workspace/myproject/src/file.ts');
		});

		it('accepts an absolute path within CWD', () => {
			const cwd = '/workspace/myproject';
			vi.spyOn(process, 'cwd').mockReturnValue(cwd);
			mockRealpathSync.mockReturnValue('/workspace/myproject/src/deep/file.ts');

			const result = validatePath('/workspace/myproject/src/deep/file.ts');

			expect(result).toBe('/workspace/myproject/src/deep/file.ts');
		});

		it('accepts a nested path within CWD', () => {
			const cwd = '/workspace/myproject';
			vi.spyOn(process, 'cwd').mockReturnValue(cwd);
			mockRealpathSync.mockReturnValue('/workspace/myproject/a/b/c/d.ts');

			const result = validatePath('a/b/c/d.ts');

			expect(result).toBe('/workspace/myproject/a/b/c/d.ts');
		});

		it('accepts a path that equals the CWD itself', () => {
			const cwd = '/workspace/myproject';
			vi.spyOn(process, 'cwd').mockReturnValue(cwd);
			mockRealpathSync.mockReturnValue('/workspace/myproject');

			const result = validatePath('.');

			expect(result).toBe('/workspace/myproject');
		});
	});

	describe('/tmp allowed paths', () => {
		it('accepts a path under /tmp', () => {
			const cwd = '/workspace/myproject';
			vi.spyOn(process, 'cwd').mockReturnValue(cwd);
			mockRealpathSync.mockReturnValue('/tmp/my-temp-file.txt');

			const result = validatePath('/tmp/my-temp-file.txt');

			expect(result).toBe('/tmp/my-temp-file.txt');
		});

		it('accepts a nested path under /tmp', () => {
			const cwd = '/workspace/myproject';
			vi.spyOn(process, 'cwd').mockReturnValue(cwd);
			mockRealpathSync.mockReturnValue('/tmp/subdir/file.txt');

			const result = validatePath('/tmp/subdir/file.txt');

			expect(result).toBe('/tmp/subdir/file.txt');
		});
	});

	describe('workspace allowed paths', () => {
		it('accepts a path under /workspace when CWD is elsewhere', () => {
			vi.spyOn(process, 'cwd').mockReturnValue('/app');
			mockRealpathSync.mockReturnValue('/workspace/cascade-damisa-123/src/file.ts');

			const result = validatePath('/workspace/cascade-damisa-123/src/file.ts');

			expect(result).toBe('/workspace/cascade-damisa-123/src/file.ts');
		});

		it('accepts the workspace root directory itself', () => {
			vi.spyOn(process, 'cwd').mockReturnValue('/app');
			mockRealpathSync.mockReturnValue('/workspace');

			const result = validatePath('/workspace');

			expect(result).toBe('/workspace');
		});
	});

	describe('path traversal rejection', () => {
		it('rejects a path outside CWD', () => {
			const cwd = '/workspace/myproject';
			vi.spyOn(process, 'cwd').mockReturnValue(cwd);
			mockRealpathSync.mockReturnValue('/etc/passwd');

			expect(() => validatePath('/etc/passwd')).toThrow('Path access denied');
		});

		it('rejects a path that escapes CWD via traversal', () => {
			const cwd = '/workspace/myproject';
			vi.spyOn(process, 'cwd').mockReturnValue(cwd);
			// Realpath resolves symlinks, but still outside cwd and allowed paths
			mockRealpathSync.mockReturnValue('/var/secrets/key.pem');

			expect(() => validatePath('../../var/secrets/key.pem')).toThrow('Path access denied');
		});

		it('error message includes the original input path', () => {
			const cwd = '/workspace/myproject';
			vi.spyOn(process, 'cwd').mockReturnValue(cwd);
			mockRealpathSync.mockReturnValue('/etc/secret');

			expect(() => validatePath('/etc/secret')).toThrow('/etc/secret');
		});

		it('error message mentions allowed paths', () => {
			const cwd = '/workspace/myproject';
			vi.spyOn(process, 'cwd').mockReturnValue(cwd);
			mockRealpathSync.mockReturnValue('/home/user/file');

			expect(() => validatePath('/home/user/file')).toThrow('/tmp, /workspace');
		});
	});

	describe('ENOENT handling', () => {
		it('uses resolved path when file does not exist (ENOENT)', () => {
			const cwd = '/workspace/myproject';
			vi.spyOn(process, 'cwd').mockReturnValue(cwd);
			const enoentError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
			mockRealpathSync.mockImplementation(() => {
				throw enoentError;
			});

			// The resolved path should be within CWD, so it should succeed
			const result = validatePath('new-file.ts');

			// resolve('cwd', 'new-file.ts') = '/workspace/myproject/new-file.ts'
			expect(result).toBe('/workspace/myproject/new-file.ts');
		});

		it('re-throws non-ENOENT errors', () => {
			const cwd = '/workspace/myproject';
			vi.spyOn(process, 'cwd').mockReturnValue(cwd);
			const permError = Object.assign(new Error('EACCES'), { code: 'EACCES' });
			mockRealpathSync.mockImplementation(() => {
				throw permError;
			});

			expect(() => validatePath('src/file.ts')).toThrow('EACCES');
		});
	});
});
