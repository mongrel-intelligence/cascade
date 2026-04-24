import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', async () => {
	const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
	return {
		...actual,
		execSync: vi.fn(),
	};
});

vi.mock('node:fs', () => ({
	existsSync: vi.fn(),
	mkdirSync: vi.fn(),
	rmSync: vi.fn(),
}));

vi.mock('execa', () => ({
	execa: vi.fn(),
}));

vi.mock('tree-kill', () => ({
	default: vi.fn((_pid: number, _signal: string, cb?: (err?: Error) => void) => {
		if (cb) cb();
	}),
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

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { Readable } from 'node:stream';
import { execa } from 'execa';
import treeKill from 'tree-kill';
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
			delete process.env.CASCADE_WORKSPACE_DIR;
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
		it('clones repo on baseBranch and configures git user', async () => {
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
				expect.stringContaining('git clone --branch main'),
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

		it('clones repo on non-default baseBranch', async () => {
			const project = {
				id: 'test',
				name: 'Test',
				repo: 'owner/repo',
				baseBranch: 'develop',
				branchPrefix: 'feature/',
				trello: { boardId: 'board', lists: {}, labels: {} },
			};

			await cloneRepo(project, '/tmp/repo');

			expect(execSync).toHaveBeenCalledWith(
				expect.stringContaining('git clone --branch develop'),
				expect.objectContaining({ stdio: 'pipe' }),
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
		/**
		 * Build a fake execa Subprocess: awaitable + has readable stdout/stderr + pid.
		 * `resolveExec` / `rejectExec` are test hooks to settle the subprocess when done.
		 */
		function createMockSubprocess() {
			const stdout = new Readable({ read() {} });
			const stderr = new Readable({ read() {} });
			let resolveExec: (r: { stdout: string; stderr: string; exitCode: number }) => void;
			let rejectExec: (e: Error) => void;
			const promise = new Promise<{ stdout: string; stderr: string; exitCode: number }>(
				(res, rej) => {
					resolveExec = res;
					rejectExec = rej;
				},
			);
			const subprocess = promise as Promise<{
				stdout: string;
				stderr: string;
				exitCode: number;
			}> & {
				stdout: Readable;
				stderr: Readable;
				pid: number;
				resolveExec: typeof resolveExec;
				rejectExec: typeof rejectExec;
			};
			subprocess.stdout = stdout;
			subprocess.stderr = stderr;
			subprocess.pid = 12345;
			subprocess.resolveExec = (r) => resolveExec(r);
			subprocess.rejectExec = (e) => rejectExec(e);
			return subprocess;
		}

		let stderrSpy: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
			vi.mocked(execa).mockReset();
			vi.mocked(treeKill).mockClear();
		});

		afterEach(() => {
			stderrSpy.mockRestore();
			vi.useRealTimers();
		});

		it('streams child stdout to parent stderr line-by-line as it arrives', async () => {
			const child = createMockSubprocess();
			vi.mocked(execa).mockReturnValue(child as unknown as ReturnType<typeof execa>);

			const promise = runCommand('echo', ['a'], '/tmp');
			await new Promise((r) => setTimeout(r, 0));

			child.stdout.push('line1\n');
			child.stdout.push('line2\n');
			await new Promise((r) => setTimeout(r, 0));

			expect(stderrSpy).toHaveBeenCalledWith('line1\n');
			expect(stderrSpy).toHaveBeenCalledWith('line2\n');

			child.stdout.push(null);
			child.stderr.push(null);
			child.resolveExec({ stdout: 'line1\nline2\n', stderr: '', exitCode: 0 });
			await promise;
		});

		it('streams child stderr to parent stderr line-by-line', async () => {
			const child = createMockSubprocess();
			vi.mocked(execa).mockReturnValue(child as unknown as ReturnType<typeof execa>);

			const promise = runCommand('cmd', [], '/tmp');
			await new Promise((r) => setTimeout(r, 0));

			child.stderr.push('err1\n');
			await new Promise((r) => setTimeout(r, 0));

			expect(stderrSpy).toHaveBeenCalledWith('err1\n');

			child.stdout.push(null);
			child.stderr.push(null);
			child.resolveExec({ stdout: '', stderr: 'err1\n', exitCode: 0 });
			await promise;
		});

		it('emits a heartbeat to parent stderr after heartbeatMs of child silence, citing elapsed time and command label', async () => {
			vi.useFakeTimers();
			const child = createMockSubprocess();
			vi.mocked(execa).mockReturnValue(child as unknown as ReturnType<typeof execa>);

			const promise = runCommand('git', ['push'], '/tmp', undefined, {
				heartbeatMs: 1000,
				label: 'git-push',
			});
			await Promise.resolve();

			vi.advanceTimersByTime(1000);

			const heartbeatCall = stderrSpy.mock.calls.find((c) =>
				/\[git-push\] still running \(1s\)/.test(String(c[0])),
			);
			expect(heartbeatCall).toBeTruthy();

			child.stdout.push(null);
			child.stderr.push(null);
			child.resolveExec({ stdout: '', stderr: '', exitCode: 0 });
			vi.useRealTimers();
			await promise;
		});

		it('resets the heartbeat timer when child emits output', async () => {
			vi.useFakeTimers();
			const child = createMockSubprocess();
			vi.mocked(execa).mockReturnValue(child as unknown as ReturnType<typeof execa>);

			const promise = runCommand('cmd', [], '/tmp', undefined, {
				heartbeatMs: 1000,
				label: 'cmd',
			});
			await Promise.resolve();

			// 900ms of silence — no heartbeat yet
			vi.advanceTimersByTime(900);
			let heartbeats = stderrSpy.mock.calls.filter((c) =>
				/still running/.test(String(c[0])),
			).length;
			expect(heartbeats).toBe(0);

			// Child output at 900ms → resets idle + heartbeat timers.
			// Use emit('data', ...) rather than push() because push queues the
			// 'data' event on process.nextTick, which vi.advanceTimersByTime
			// does not flush — the heartbeat timer would fire before onChunk runs.
			child.stdout.emit('data', 'tick\n');

			// Advance 900ms more (total silence since last child output: 900ms) — still no heartbeat
			vi.advanceTimersByTime(900);
			heartbeats = stderrSpy.mock.calls.filter((c) => /still running/.test(String(c[0]))).length;
			expect(heartbeats).toBe(0);

			// Advance to 1000ms since last child output — one heartbeat fires
			vi.advanceTimersByTime(100);
			heartbeats = stderrSpy.mock.calls.filter((c) => /still running/.test(String(c[0]))).length;
			expect(heartbeats).toBe(1);

			child.stdout.push(null);
			child.stderr.push(null);
			child.resolveExec({ stdout: 'tick\n', stderr: '', exitCode: 0 });
			vi.useRealTimers();
			await promise;
		});

		it('does not emit heartbeat when child exits before heartbeatMs elapses', async () => {
			const child = createMockSubprocess();
			vi.mocked(execa).mockReturnValue(child as unknown as ReturnType<typeof execa>);

			const promise = runCommand('cmd', [], '/tmp', undefined, {
				heartbeatMs: 10_000,
				label: 'cmd',
			});
			await new Promise((r) => setTimeout(r, 0));

			child.stdout.push('done\n');
			child.stdout.push(null);
			child.stderr.push(null);
			child.resolveExec({ stdout: 'done\n', stderr: '', exitCode: 0 });
			await promise;

			const heartbeats = stderrSpy.mock.calls.filter((c) =>
				/still running/.test(String(c[0])),
			).length;
			expect(heartbeats).toBe(0);
		});

		it('kills the child via tree-kill with SIGTERM when idleTimeoutMs elapses with no output', async () => {
			vi.useFakeTimers();
			const child = createMockSubprocess();
			vi.mocked(execa).mockReturnValue(child as unknown as ReturnType<typeof execa>);

			const promise = runCommand('cmd', [], '/tmp', undefined, {
				idleTimeoutMs: 5000,
				heartbeatMs: 0,
				forceKillAfterMs: 5000,
			});
			await Promise.resolve();

			vi.advanceTimersByTime(5000);
			await Promise.resolve();

			// After idle fires, helper kills with SIGTERM
			expect(vi.mocked(treeKill)).toHaveBeenCalledWith(12345, 'SIGTERM', expect.any(Function));

			// Settle the subprocess so the awaiting runCommand resolves
			child.stdout.push(null);
			child.stderr.push(null);
			child.resolveExec({ stdout: '', stderr: '', exitCode: 143 });
			vi.useRealTimers();
			const result = await promise;
			expect(result.reason).toBe('idle-timeout');
			expect(result.exitCode).not.toBe(0);
		});

		it('escalates to SIGKILL after forceKillAfterMs if the child did not exit on SIGTERM', async () => {
			vi.useFakeTimers();
			const child = createMockSubprocess();
			vi.mocked(execa).mockReturnValue(child as unknown as ReturnType<typeof execa>);

			const promise = runCommand('cmd', [], '/tmp', undefined, {
				idleTimeoutMs: 1000,
				heartbeatMs: 0,
				forceKillAfterMs: 2000,
			});
			await Promise.resolve();

			vi.advanceTimersByTime(1000);
			await Promise.resolve();
			expect(vi.mocked(treeKill)).toHaveBeenCalledWith(12345, 'SIGTERM', expect.any(Function));
			expect(vi.mocked(treeKill)).toHaveBeenCalledTimes(1);

			// Child does NOT exit; advance the force-kill window
			vi.advanceTimersByTime(2000);
			await Promise.resolve();
			expect(vi.mocked(treeKill)).toHaveBeenCalledWith(12345, 'SIGKILL', expect.any(Function));
			expect(vi.mocked(treeKill)).toHaveBeenCalledTimes(2);

			// Settle
			child.stdout.push(null);
			child.stderr.push(null);
			child.resolveExec({ stdout: '', stderr: '', exitCode: 137 });
			vi.useRealTimers();
			await promise;
		});

		// ─── Regression: wallTimeoutMs / idleTimeoutMs set to 0 must disable ──
		// Spec contract at `runCommand` docstring: "Setting a timing field to 0
		// disables it."  Callers like CreatePR rely on this to keep pre-push
		// hooks alive for minutes.  A regression that re-enables the timer when
		// 0 is passed would silently bring back the "PUSH FAILED at 2 min"
		// incident that motivated removing the caps in the first place.

		it('does NOT kill the child when idleTimeoutMs is 0 — even after 10 min of silence', async () => {
			vi.useFakeTimers();
			const child = createMockSubprocess();
			vi.mocked(execa).mockReturnValue(child as unknown as ReturnType<typeof execa>);

			const promise = runCommand('long-cmd', [], '/tmp', undefined, {
				idleTimeoutMs: 0,
				heartbeatMs: 0,
				wallTimeoutMs: 0,
			});
			await Promise.resolve();

			// 10 minutes of silence — would trip any armed idle timer (default 2m).
			vi.advanceTimersByTime(10 * 60 * 1000);
			await Promise.resolve();

			expect(vi.mocked(treeKill)).not.toHaveBeenCalled();

			// Settle successfully.
			child.stdout.push(null);
			child.stderr.push(null);
			child.resolveExec({ stdout: 'done\n', stderr: '', exitCode: 0 });
			vi.useRealTimers();
			const result = await promise;
			expect(result.reason).toBeUndefined();
			expect(result.exitCode).toBe(0);
		});

		it('does NOT kill the child when wallTimeoutMs is 0 — even after 10 min of continuous output', async () => {
			vi.useFakeTimers();
			const child = createMockSubprocess();
			vi.mocked(execa).mockReturnValue(child as unknown as ReturnType<typeof execa>);

			const promise = runCommand('long-cmd', [], '/tmp', undefined, {
				wallTimeoutMs: 0,
				idleTimeoutMs: 0,
				heartbeatMs: 0,
			});
			await Promise.resolve();

			// 10 minutes of constant chatter — would blow past the default 10m wall
			// and the spec-013 230s cap, and would trip any armed wall timer.
			for (let t = 0; t < 10 * 60 * 1000; t += 1000) {
				child.stdout.push(`tick ${t}\n`);
				await Promise.resolve();
				vi.advanceTimersByTime(1000);
				await Promise.resolve();
			}

			expect(vi.mocked(treeKill)).not.toHaveBeenCalled();

			child.stdout.push(null);
			child.stderr.push(null);
			child.resolveExec({ stdout: '', stderr: '', exitCode: 0 });
			vi.useRealTimers();
			const result = await promise;
			expect(result.reason).toBeUndefined();
			expect(result.exitCode).toBe(0);
		});

		it('kills the child via tree-kill with SIGTERM when wallTimeoutMs elapses even with ongoing output', async () => {
			vi.useFakeTimers();
			const child = createMockSubprocess();
			vi.mocked(execa).mockReturnValue(child as unknown as ReturnType<typeof execa>);

			const promise = runCommand('cmd', [], '/tmp', undefined, {
				wallTimeoutMs: 5000,
				idleTimeoutMs: 100_000,
				heartbeatMs: 0,
				forceKillAfterMs: 5000,
			});
			await Promise.resolve();

			// Tick every 500ms with output — idle timer keeps resetting but wall ticks down
			for (let t = 0; t < 5000; t += 500) {
				child.stdout.push(`tick ${t}\n`);
				await Promise.resolve();
				vi.advanceTimersByTime(500);
				await Promise.resolve();
			}

			expect(vi.mocked(treeKill)).toHaveBeenCalledWith(12345, 'SIGTERM', expect.any(Function));

			child.stdout.push(null);
			child.stderr.push(null);
			child.resolveExec({ stdout: '', stderr: '', exitCode: 143 });
			vi.useRealTimers();
			const result = await promise;
			expect(result.reason).toBe('wall-timeout');
		});

		it('returns captured stdout and stderr in the result on success', async () => {
			const child = createMockSubprocess();
			vi.mocked(execa).mockReturnValue(child as unknown as ReturnType<typeof execa>);

			const promise = runCommand('cmd', [], '/tmp');
			await new Promise((r) => setTimeout(r, 0));

			child.stdout.push('ok\n');
			child.stdout.push(null);
			child.stderr.push(null);
			child.resolveExec({ stdout: 'ok\n', stderr: '', exitCode: 0 });

			const result = await promise;
			expect(result.stdout).toBe('ok\n');
			expect(result.stderr).toBe('');
			expect(result.exitCode).toBe(0);
		});

		it('returns captured stdout and stderr in the result on non-zero exit', async () => {
			const child = createMockSubprocess();
			vi.mocked(execa).mockReturnValue(child as unknown as ReturnType<typeof execa>);

			const promise = runCommand('cmd', [], '/tmp');
			await new Promise((r) => setTimeout(r, 0));

			child.stderr.push('failed\n');
			child.stdout.push(null);
			child.stderr.push(null);
			child.resolveExec({ stdout: '', stderr: 'failed\n', exitCode: 1 });

			const result = await promise;
			expect(result.stderr).toBe('failed\n');
			expect(result.exitCode).toBe(1);
		});

		it('does not stream when options.silent is true', async () => {
			const child = createMockSubprocess();
			vi.mocked(execa).mockReturnValue(child as unknown as ReturnType<typeof execa>);

			const promise = runCommand('cmd', [], '/tmp', undefined, { silent: true });
			await new Promise((r) => setTimeout(r, 0));

			child.stdout.push('silent-stdout\n');
			child.stderr.push('silent-stderr\n');
			await new Promise((r) => setTimeout(r, 0));

			const forwardedChild = stderrSpy.mock.calls.filter(
				(c) => String(c[0]) === 'silent-stdout\n' || String(c[0]) === 'silent-stderr\n',
			).length;
			expect(forwardedChild).toBe(0);

			child.stdout.push(null);
			child.stderr.push(null);
			child.resolveExec({
				stdout: 'silent-stdout\n',
				stderr: 'silent-stderr\n',
				exitCode: 0,
			});
			const result = await promise;

			// Capture still works despite silent mode
			expect(result.stdout).toBe('silent-stdout\n');
			expect(result.stderr).toBe('silent-stderr\n');
		});

		it('backward-compatible signature: runCommand(cmd, args, cwd) returns { stdout, stderr, exitCode }', async () => {
			const child = createMockSubprocess();
			vi.mocked(execa).mockReturnValue(child as unknown as ReturnType<typeof execa>);

			const promise = runCommand('cmd', [], '/tmp');
			await new Promise((r) => setTimeout(r, 0));

			child.stdout.push(null);
			child.stderr.push(null);
			child.resolveExec({ stdout: '', stderr: '', exitCode: 0 });

			const result = await promise;
			expect(result).toMatchObject({ stdout: '', stderr: '', exitCode: 0 });
			expect(typeof result.stdout).toBe('string');
			expect(typeof result.stderr).toBe('string');
			expect(typeof result.exitCode).toBe('number');
			// reason is optional; undefined on natural exit
			expect(result.reason).toBeUndefined();
		});
	});
});
