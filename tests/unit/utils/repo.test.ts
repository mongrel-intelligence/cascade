import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', async () => {
	const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
	return {
		...actual,
		execSync: vi.fn(),
		spawn: vi.fn(),
	};
});

vi.mock('node:fs', () => ({
	existsSync: vi.fn(),
	mkdirSync: vi.fn(),
	rmSync: vi.fn(),
}));

vi.mock('../../../src/config/projects.js', () => ({
	getProjectGitHubToken: vi.fn(() => Promise.resolve('test-token')),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		debug: vi.fn(),
	},
}));

import { execSync, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { Readable } from 'node:stream';
import {
	cleanupTempDir,
	cloneRepo,
	createTempDir,
	getWorkspaceDir,
	parseRepoFullName,
	runCommand,
} from '../../../src/utils/repo.js';

describe('parseRepoFullName', () => {
	it('parses a valid owner/repo string', () => {
		expect(parseRepoFullName('owner/repo')).toEqual({ owner: 'owner', repo: 'repo' });
	});

	it('parses owner with hyphens and numbers', () => {
		expect(parseRepoFullName('my-org-123/my-repo-456')).toEqual({
			owner: 'my-org-123',
			repo: 'my-repo-456',
		});
	});

	it('throws on string with no slash', () => {
		expect(() => parseRepoFullName('noslash')).toThrow('Invalid repository full name');
	});

	it('throws on empty string', () => {
		expect(() => parseRepoFullName('')).toThrow('Invalid repository full name');
	});

	it('throws when owner part is empty', () => {
		expect(() => parseRepoFullName('/repo')).toThrow('Invalid repository full name');
	});

	it('throws when repo part is empty', () => {
		expect(() => parseRepoFullName('owner/')).toThrow('Invalid repository full name');
	});
});

describe('repo utils', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	describe('getWorkspaceDir', () => {
		it('returns CASCADE_WORKSPACE_DIR when set', () => {
			process.env.CASCADE_WORKSPACE_DIR = '/custom/workspace';
			expect(getWorkspaceDir()).toBe('/custom/workspace');
		});

		it('returns /workspace as default', () => {
			process.env.CASCADE_WORKSPACE_DIR = undefined;
			expect(getWorkspaceDir()).toBe('/workspace');
		});
	});

	describe('createTempDir', () => {
		it('creates directory with project ID and timestamp', () => {
			const dir = createTempDir('my-project');

			expect(dir).toMatch(/cascade-my-project-\d+/);
			expect(mkdirSync).toHaveBeenCalledWith(dir, { recursive: true });
		});
	});

	describe('cloneRepo', () => {
		it('clones repo and configures git user', async () => {
			const project = {
				id: 'test',
				name: 'Test',
				repo: 'owner/repo',
				baseBranch: 'main',
				branchPrefix: 'feature/',
				trello: { boardId: 'board', lists: {}, labels: {} },
			};

			await cloneRepo(project, '/tmp/repo');

			expect(execSync).toHaveBeenCalledWith(
				expect.stringContaining('git clone'),
				expect.objectContaining({ stdio: 'pipe' }),
			);
			expect(execSync).toHaveBeenCalledWith(
				expect.stringContaining('git config user.name'),
				expect.objectContaining({ cwd: '/tmp/repo' }),
			);
			expect(execSync).toHaveBeenCalledWith(
				expect.stringContaining('git config user.email'),
				expect.objectContaining({ cwd: '/tmp/repo' }),
			);
		});
	});

	describe('cleanupTempDir', () => {
		it('removes directory when it exists and matches pattern', () => {
			vi.mocked(existsSync).mockReturnValue(true);

			cleanupTempDir('/workspace/cascade-test-123');

			expect(rmSync).toHaveBeenCalledWith('/workspace/cascade-test-123', {
				recursive: true,
				force: true,
			});
		});

		it('does not remove directory that does not exist', () => {
			vi.mocked(existsSync).mockReturnValue(false);

			cleanupTempDir('/workspace/cascade-test-123');

			expect(rmSync).not.toHaveBeenCalled();
		});

		it('does not remove directory that does not match cascade pattern', () => {
			vi.mocked(existsSync).mockReturnValue(true);

			cleanupTempDir('/workspace/other-dir');

			expect(rmSync).not.toHaveBeenCalled();
		});
	});

	describe('runCommand', () => {
		function createMockChild() {
			const stdout = new Readable({ read() {} });
			const stderr = new Readable({ read() {} });
			const child = new EventEmitter() as EventEmitter & {
				stdout: Readable;
				stderr: Readable;
				stdin: { write: vi.Mock; end: vi.Mock };
			};
			child.stdout = stdout;
			child.stderr = stderr;
			child.stdin = { write: vi.fn(), end: vi.fn() };
			return child;
		}

		it('runs command and returns stdout/stderr/exitCode', async () => {
			const mockChild = createMockChild();
			vi.mocked(spawn).mockReturnValue(mockChild as unknown as ReturnType<typeof spawn>);

			const promise = runCommand('echo', ['hello'], '/tmp');

			// Need to yield to allow event handlers to be attached
			await new Promise((r) => setTimeout(r, 0));

			mockChild.stdout.push('hello\n');
			mockChild.stdout.push(null);
			mockChild.stderr.push(null);
			mockChild.emit('close', 0);

			const result = await promise;

			expect(result.stdout).toBe('hello\n');
			expect(result.stderr).toBe('');
			expect(result.exitCode).toBe(0);
		});

		it('handles command error', async () => {
			const mockChild = createMockChild();
			vi.mocked(spawn).mockReturnValue(mockChild as unknown as ReturnType<typeof spawn>);

			const promise = runCommand('bad-command', [], '/tmp');

			await new Promise((r) => setTimeout(r, 0));

			mockChild.stdout.push(null);
			mockChild.stderr.push(null);
			mockChild.emit('error', new Error('spawn ENOENT'));

			const result = await promise;

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain('spawn ENOENT');
		});

		it('handles null exit code', async () => {
			const mockChild = createMockChild();
			vi.mocked(spawn).mockReturnValue(mockChild as unknown as ReturnType<typeof spawn>);

			const promise = runCommand('cmd', [], '/tmp');

			await new Promise((r) => setTimeout(r, 0));

			mockChild.stdout.push(null);
			mockChild.stderr.push(null);
			mockChild.emit('close', null);

			const result = await promise;

			expect(result.exitCode).toBe(1);
		});
	});
});
