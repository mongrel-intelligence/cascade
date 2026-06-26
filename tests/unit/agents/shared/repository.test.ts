import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock external dependencies before imports
vi.mock('../../../../src/utils/repo.js', () => ({
	cloneRepo: vi.fn(),
	createTempDir: vi.fn(),
	runCommand: vi.fn(),
	getWorkspaceDir: vi.fn(),
}));

vi.mock('../../../../src/agents/utils/setup.js', () => ({
	warmTypeScriptCache: vi.fn(),
}));

vi.mock('node:fs', () => ({
	existsSync: vi.fn(),
	readdirSync: vi.fn(),
}));

import { existsSync, readdirSync } from 'node:fs';

import {
	fetchAndCheckoutPR,
	findSnapshotWorkspaceDir,
	setupRepository,
} from '../../../../src/agents/shared/repository.js';
import { warmTypeScriptCache } from '../../../../src/agents/utils/setup.js';
import type { ProjectConfig } from '../../../../src/types/index.js';
import {
	cloneRepo,
	createTempDir,
	getWorkspaceDir,
	runCommand,
} from '../../../../src/utils/repo.js';

const mockCreateTempDir = vi.mocked(createTempDir);
const mockCloneRepo = vi.mocked(cloneRepo);
const mockRunCommand = vi.mocked(runCommand);
const mockWarmTypeScriptCache = vi.mocked(warmTypeScriptCache);
const mockExistsSync = vi.mocked(existsSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockGetWorkspaceDir = vi.mocked(getWorkspaceDir);

function makeProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
	return {
		id: 'test-project',
		orgId: 'test-org',
		name: 'Test Project',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		pm: { type: 'trello' },
		...overrides,
	} as ProjectConfig;
}

function makeLog() {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
}

beforeEach(() => {
	mockCreateTempDir.mockReturnValue('/tmp/cascade-test-project-12345');
	mockCloneRepo.mockResolvedValue(undefined);
	mockRunCommand.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
	mockExistsSync.mockReturnValue(false);
	mockReaddirSync.mockReturnValue([]);
	mockWarmTypeScriptCache.mockResolvedValue(null);
	mockGetWorkspaceDir.mockReturnValue('/workspace');
	delete process.env.CASCADE_SNAPSHOT_REUSE;
});

afterEach(() => {
	delete process.env.CASCADE_SNAPSHOT_REUSE;
});

// ── fetchAndCheckoutPR ────────────────────────────────────────────────────────

describe('fetchAndCheckoutPR', () => {
	const repoDir = '/workspace/cascade-test-project-12345';

	it('fetches refs/pull/N/head with the + force-update prefix on origin (github)', async () => {
		const log = makeLog();
		mockRunCommand.mockResolvedValue({ stdout: 'abc123\n', stderr: '', exitCode: 0 });

		await fetchAndCheckoutPR(repoDir, 1092, undefined, 'github', log);

		expect(mockRunCommand).toHaveBeenNthCalledWith(
			1,
			'git',
			['fetch', 'origin', '+refs/pull/1092/head:refs/remotes/pr/1092'],
			repoDir,
		);
	});

	it('checks out detached pr/N after fetch', async () => {
		const log = makeLog();
		mockRunCommand.mockResolvedValue({ stdout: 'abc123\n', stderr: '', exitCode: 0 });

		await fetchAndCheckoutPR(repoDir, 1092, undefined, 'github', log);

		expect(mockRunCommand).toHaveBeenNthCalledWith(
			2,
			'git',
			['checkout', '--detach', 'pr/1092'],
			repoDir,
		);
	});

	it('throws when git fetch returns non-zero exit code', async () => {
		const log = makeLog();
		mockRunCommand.mockResolvedValueOnce({
			stdout: '',
			stderr: 'fatal: couldn’t find remote ref refs/pull/1092/head',
			exitCode: 128,
		});

		await expect(fetchAndCheckoutPR(repoDir, 1092, undefined, 'github', log)).rejects.toThrow(
			/git fetch PR ref failed.*128.*couldn.t find remote ref/s,
		);
	});

	it('throws when git checkout returns non-zero exit code', async () => {
		const log = makeLog();
		mockRunCommand
			.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // fetch ok
			.mockResolvedValueOnce({ stdout: '', stderr: 'unmerged paths', exitCode: 1 }); // checkout fail

		await expect(fetchAndCheckoutPR(repoDir, 1092, undefined, 'github', log)).rejects.toThrow(
			/git checkout PR failed.*1.*unmerged paths/s,
		);
	});

	it('verifies HEAD SHA matches expected when prHeadSha is provided', async () => {
		const log = makeLog();
		const expectedSha = '96f5136213d7a435e4b6e27b3d868f7b622b3dc0';
		mockRunCommand
			.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // fetch
			.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // checkout
			.mockResolvedValueOnce({ stdout: `${expectedSha}\n`, stderr: '', exitCode: 0 }); // rev-parse

		await expect(
			fetchAndCheckoutPR(repoDir, 1092, expectedSha, 'github', log),
		).resolves.toBeUndefined();

		expect(mockRunCommand).toHaveBeenNthCalledWith(3, 'git', ['rev-parse', 'HEAD'], repoDir);
	});

	it('throws on HEAD SHA mismatch with both SHAs in the message', async () => {
		const log = makeLog();
		const expectedSha = '96f5136213d7a435e4b6e27b3d868f7b622b3dc0';
		const actualSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
		mockRunCommand
			.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
			.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
			.mockResolvedValueOnce({ stdout: `${actualSha}\n`, stderr: '', exitCode: 0 });

		await expect(fetchAndCheckoutPR(repoDir, 1092, expectedSha, 'github', log)).rejects.toThrow(
			new RegExp(`HEAD SHA mismatch.*${expectedSha}.*${actualSha}`),
		);
	});

	it('skips SHA check when prHeadSha is undefined', async () => {
		const log = makeLog();
		mockRunCommand.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

		await fetchAndCheckoutPR(repoDir, 1092, undefined, 'github', log);

		// Only fetch + checkout — no rev-parse call
		expect(mockRunCommand).toHaveBeenCalledTimes(2);
		expect(mockRunCommand).not.toHaveBeenCalledWith(
			'git',
			['rev-parse', 'HEAD'],
			expect.any(String),
		);
	});

	it('logs fetched ref and resolved HEAD on success', async () => {
		const log = makeLog();
		const expectedSha = '96f5136213d7a435e4b6e27b3d868f7b622b3dc0';
		mockRunCommand
			.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
			.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
			.mockResolvedValueOnce({ stdout: `${expectedSha}\n`, stderr: '', exitCode: 0 });

		await fetchAndCheckoutPR(repoDir, 1092, expectedSha, 'github', log);

		expect(log.info).toHaveBeenCalledWith(
			'PR checked out',
			expect.objectContaining({
				prNumber: 1092,
				ref: 'refs/pull/1092/head',
				headSha: expectedSha,
			}),
		);
	});

	it('throws when scmProvider is gitlab (not yet supported)', async () => {
		const log = makeLog();

		await expect(fetchAndCheckoutPR(repoDir, 1092, undefined, 'gitlab', log)).rejects.toThrow(
			/only GitHub is currently supported.*GitLab support follows PR #1092/,
		);
		// No git commands run
		expect(mockRunCommand).not.toHaveBeenCalled();
	});

	it('defaults to github when scmProvider is undefined', async () => {
		const log = makeLog();
		mockRunCommand.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

		await fetchAndCheckoutPR(repoDir, 1092, undefined, undefined, log);

		// First call should be the GitHub-style fetch
		expect(mockRunCommand).toHaveBeenNthCalledWith(
			1,
			'git',
			['fetch', 'origin', '+refs/pull/1092/head:refs/remotes/pr/1092'],
			repoDir,
		);
	});
});

// ── findSnapshotWorkspaceDir ───────────────────────────────────────────────────

describe('findSnapshotWorkspaceDir', () => {
	it('returns the matching directory path when a cascade-<projectId>-* entry exists', () => {
		mockGetWorkspaceDir.mockReturnValue('/workspace');
		mockReaddirSync.mockReturnValue([
			'cascade-other-project-111',
			'cascade-test-project-99999',
			'some-other-dir',
		] as never);

		const result = findSnapshotWorkspaceDir('test-project');

		expect(result).toBe('/workspace/cascade-test-project-99999');
	});

	it('returns the first matching entry when multiple candidates exist', () => {
		mockGetWorkspaceDir.mockReturnValue('/workspace');
		mockReaddirSync.mockReturnValue([
			'cascade-test-project-100',
			'cascade-test-project-200',
		] as never);

		const result = findSnapshotWorkspaceDir('test-project');

		expect(result).toBe('/workspace/cascade-test-project-100');
	});

	it('returns null when no matching directory exists', () => {
		mockGetWorkspaceDir.mockReturnValue('/workspace');
		mockReaddirSync.mockReturnValue(['cascade-other-project-111', 'unrelated'] as never);

		const result = findSnapshotWorkspaceDir('test-project');

		expect(result).toBeNull();
	});

	it('returns null when workspace directory cannot be read (throws)', () => {
		mockGetWorkspaceDir.mockReturnValue('/workspace');
		mockReaddirSync.mockImplementation(() => {
			throw new Error('ENOENT');
		});

		const result = findSnapshotWorkspaceDir('test-project');

		expect(result).toBeNull();
	});

	it('uses getWorkspaceDir to determine the base path', () => {
		mockGetWorkspaceDir.mockReturnValue('/custom-workspace');
		mockReaddirSync.mockReturnValue(['cascade-test-project-55555'] as never);

		const result = findSnapshotWorkspaceDir('test-project');

		expect(mockGetWorkspaceDir).toHaveBeenCalled();
		expect(result).toBe('/custom-workspace/cascade-test-project-55555');
	});

	it('does not match a directory whose suffix is not all digits (prevents cross-project prefix collision)', () => {
		// cascade-foo-bar-<timestamp> must NOT match projectId="foo" even though it starts with "cascade-foo-"
		mockGetWorkspaceDir.mockReturnValue('/workspace');
		mockReaddirSync.mockReturnValue([
			'cascade-foo-bar-1711234567890', // wrong project: foo-bar
			'cascade-foo-1711234567890', // correct project: foo
		] as never);

		const result = findSnapshotWorkspaceDir('foo');

		expect(result).toBe('/workspace/cascade-foo-1711234567890');
	});

	it('returns null when only non-numeric-suffix entries match the prefix', () => {
		mockGetWorkspaceDir.mockReturnValue('/workspace');
		mockReaddirSync.mockReturnValue([
			'cascade-foo-bar-1711234567890', // prefix matches "foo-" but suffix "bar-1711234567890" is not all digits
		] as never);

		const result = findSnapshotWorkspaceDir('foo');

		expect(result).toBeNull();
	});
});

// ── setupRepository (cold-start path) ─────────────────────────────────────────

describe('setupRepository', () => {
	it('calls createTempDir with project.id', async () => {
		const project = makeProject();
		const log = makeLog();

		await setupRepository({ project, log, agentType: 'coder' });

		expect(mockCreateTempDir).toHaveBeenCalledWith('test-project');
	});

	it('calls cloneRepo when project.repo is configured', async () => {
		const project = makeProject({ repo: 'owner/myrepo' });
		const log = makeLog();

		await setupRepository({ project, log, agentType: 'coder' });

		expect(mockCloneRepo).toHaveBeenCalledWith(project, '/tmp/cascade-test-project-12345');
	});

	it('skips clone when project.repo is not configured (email-only agents)', async () => {
		const project = makeProject({ repo: undefined });
		const log = makeLog();

		const result = await setupRepository({ project, log, agentType: 'email' });

		expect(mockCloneRepo).not.toHaveBeenCalled();
		expect(result).toBe('/tmp/cascade-test-project-12345');
	});

	it('returns repoDir early when project.repo is not configured', async () => {
		const project = makeProject({ repo: undefined });
		const log = makeLog();

		const result = await setupRepository({ project, log, agentType: 'email' });

		expect(result).toBe('/tmp/cascade-test-project-12345');
		expect(mockRunCommand).not.toHaveBeenCalled();
	});

	it('fetches and checks out PR via refs/pull/N/head when prNumber is provided', async () => {
		const project = makeProject();
		const log = makeLog();

		await setupRepository({ project, log, agentType: 'coder', prNumber: 1092 });

		// fetch refs/pull/N/head, then detached checkout pr/N
		expect(mockRunCommand).toHaveBeenCalledWith(
			'git',
			['fetch', 'origin', '+refs/pull/1092/head:refs/remotes/pr/1092'],
			'/tmp/cascade-test-project-12345',
		);
		expect(mockRunCommand).toHaveBeenCalledWith(
			'git',
			['checkout', '--detach', 'pr/1092'],
			'/tmp/cascade-test-project-12345',
		);
	});

	it('verifies HEAD SHA when both prNumber and prHeadSha are provided', async () => {
		const project = makeProject();
		const log = makeLog();
		const sha = '96f5136213d7a435e4b6e27b3d868f7b622b3dc0';
		mockRunCommand
			.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // fetch
			.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // checkout
			.mockResolvedValueOnce({ stdout: `${sha}\n`, stderr: '', exitCode: 0 }); // rev-parse

		await setupRepository({ project, log, agentType: 'coder', prNumber: 1092, prHeadSha: sha });

		expect(mockRunCommand).toHaveBeenCalledWith(
			'git',
			['rev-parse', 'HEAD'],
			'/tmp/cascade-test-project-12345',
		);
	});

	it('throws and stops when PR fetch fails (no silent continuation)', async () => {
		const project = makeProject();
		const log = makeLog();
		mockRunCommand.mockResolvedValueOnce({
			stdout: '',
			stderr: 'fatal: couldn’t find ref',
			exitCode: 128,
		});

		await expect(
			setupRepository({ project, log, agentType: 'coder', prNumber: 1092 }),
		).rejects.toThrow(/git fetch PR ref failed/);
	});

	it('throws on HEAD SHA mismatch', async () => {
		const project = makeProject();
		const log = makeLog();
		mockRunCommand
			.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
			.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
			.mockResolvedValueOnce({ stdout: 'wrongsha\n', stderr: '', exitCode: 0 });

		await expect(
			setupRepository({
				project,
				log,
				agentType: 'coder',
				prNumber: 1092,
				prHeadSha: 'expectedsha',
			}),
		).rejects.toThrow(/HEAD SHA mismatch/);
	});

	it('does not invoke git when prNumber is not provided (non-PR runs)', async () => {
		const project = makeProject();
		const log = makeLog();

		await setupRepository({ project, log, agentType: 'coder' });

		expect(mockRunCommand).not.toHaveBeenCalledWith(
			'git',
			expect.arrayContaining(['fetch']),
			expect.any(String),
		);
		expect(mockRunCommand).not.toHaveBeenCalledWith(
			'git',
			expect.arrayContaining(['checkout']),
			expect.any(String),
		);
	});

	it('ignores prBranch when prNumber is not provided (legacy field, log-only)', async () => {
		const project = makeProject();
		const log = makeLog();

		await setupRepository({
			project,
			log,
			agentType: 'coder',
			prBranch: 'feature/legacy-branch',
		});

		// Should NOT do `git checkout feature/legacy-branch` — that path is removed.
		expect(mockRunCommand).not.toHaveBeenCalledWith(
			'git',
			['checkout', 'feature/legacy-branch'],
			expect.any(String),
		);
	});

	it('runs .cascade/setup.sh when it exists', async () => {
		const project = makeProject();
		const log = makeLog();
		mockExistsSync.mockReturnValue(true);

		await setupRepository({ project, log, agentType: 'coder' });

		expect(mockRunCommand).toHaveBeenCalledWith(
			'bash',
			['/tmp/cascade-test-project-12345/.cascade/setup.sh'],
			'/tmp/cascade-test-project-12345',
			{ AGENT_PROFILE_NAME: 'coder' },
			{ idleTimeoutMs: 0 },
		);
	});

	it('does not run setup.sh when it does not exist', async () => {
		const project = makeProject();
		const log = makeLog();
		mockExistsSync.mockReturnValue(false);

		await setupRepository({ project, log, agentType: 'coder' });

		expect(mockRunCommand).not.toHaveBeenCalledWith(
			'bash',
			expect.any(Array),
			expect.any(String),
			expect.any(Object),
		);
	});

	it('warms TS cache when warmTsCache=true', async () => {
		const project = makeProject();
		const log = makeLog();
		mockWarmTypeScriptCache.mockResolvedValue({
			success: true,
			durationMs: 1234,
		});

		await setupRepository({ project, log, agentType: 'coder', warmTsCache: true });

		expect(mockWarmTypeScriptCache).toHaveBeenCalledWith('/tmp/cascade-test-project-12345');
	});

	it('does not warm TS cache when warmTsCache is not set', async () => {
		const project = makeProject();
		const log = makeLog();

		await setupRepository({ project, log, agentType: 'coder' });

		expect(mockWarmTypeScriptCache).not.toHaveBeenCalled();
	});

	it('does not warm TS cache when warmTsCache=false', async () => {
		const project = makeProject();
		const log = makeLog();

		await setupRepository({ project, log, agentType: 'coder', warmTsCache: false });

		expect(mockWarmTypeScriptCache).not.toHaveBeenCalled();
	});

	it('handles setup.sh failure (non-zero exit code) — logs warning but continues', async () => {
		const project = makeProject();
		const log = makeLog();
		mockExistsSync.mockReturnValue(true);
		mockRunCommand.mockResolvedValue({
			stdout: 'some output',
			stderr: 'error output',
			exitCode: 1,
		});

		// Should not throw
		const result = await setupRepository({ project, log, agentType: 'coder' });

		expect(result).toBe('/tmp/cascade-test-project-12345');
		expect(log.warn).toHaveBeenCalledWith(
			'Setup script exited with non-zero code',
			expect.objectContaining({ exitCode: 1 }),
		);
	});

	it('returns the repoDir on success', async () => {
		const project = makeProject();
		const log = makeLog();

		const result = await setupRepository({ project, log, agentType: 'coder' });

		expect(result).toBe('/tmp/cascade-test-project-12345');
	});

	it('logs info when warming TypeScript cache with result', async () => {
		const project = makeProject();
		const log = makeLog();
		mockWarmTypeScriptCache.mockResolvedValue({
			success: true,
			durationMs: 2500,
		});

		await setupRepository({ project, log, agentType: 'coder', warmTsCache: true });

		expect(log.info).toHaveBeenCalledWith(
			'TypeScript cache warmed',
			expect.objectContaining({ durationMs: 2500 }),
		);
	});

	it('skips TS cache log when warmTypeScriptCache returns null', async () => {
		const project = makeProject();
		const log = makeLog();
		mockWarmTypeScriptCache.mockResolvedValue(null);

		await setupRepository({ project, log, agentType: 'coder', warmTsCache: true });

		// Should not log "TypeScript cache warmed" when result is null
		const infoCalls = log.info.mock.calls.map((c) => c[0]);
		expect(infoCalls).not.toContain('TypeScript cache warmed');
	});
});

// ── setupRepository (snapshot-reuse path) ─────────────────────────────────────

describe('setupRepository — snapshot-reuse path', () => {
	beforeEach(() => {
		process.env.CASCADE_SNAPSHOT_REUSE = 'true';
		mockGetWorkspaceDir.mockReturnValue('/workspace');
	});

	it('uses the baked-in snapshot directory instead of creating a new one', async () => {
		mockReaddirSync.mockReturnValue(['cascade-test-project-99999'] as never);
		const project = makeProject();
		const log = makeLog();

		const result = await setupRepository({ project, log, agentType: 'coder' });

		expect(result).toBe('/workspace/cascade-test-project-99999');
		expect(mockCreateTempDir).not.toHaveBeenCalled();
		expect(mockCloneRepo).not.toHaveBeenCalled();
	});

	it('runs git fetch, git reset --hard, and git checkout on the snapshot directory', async () => {
		mockReaddirSync.mockReturnValue(['cascade-test-project-99999'] as never);
		const project = makeProject({ baseBranch: 'main' });
		const log = makeLog();

		await setupRepository({ project, log, agentType: 'coder' });

		expect(mockRunCommand).toHaveBeenCalledWith(
			'git',
			['fetch', 'origin'],
			'/workspace/cascade-test-project-99999',
		);
		expect(mockRunCommand).toHaveBeenCalledWith(
			'git',
			['reset', '--hard', 'origin/main'],
			'/workspace/cascade-test-project-99999',
		);
		expect(mockRunCommand).toHaveBeenCalledWith(
			'git',
			['checkout', 'main'],
			'/workspace/cascade-test-project-99999',
		);
	});

	it('uses fetchAndCheckoutPR (refs/pull/N/head) when prNumber is provided, instead of base-branch fetch+reset', async () => {
		mockReaddirSync.mockReturnValue(['cascade-test-project-99999'] as never);
		const project = makeProject({ baseBranch: 'main' });
		const log = makeLog();

		await setupRepository({
			project,
			log,
			agentType: 'coder',
			prNumber: 1092,
		});

		// PR ref fetch + detached checkout
		expect(mockRunCommand).toHaveBeenCalledWith(
			'git',
			['fetch', 'origin', '+refs/pull/1092/head:refs/remotes/pr/1092'],
			'/workspace/cascade-test-project-99999',
		);
		expect(mockRunCommand).toHaveBeenCalledWith(
			'git',
			['checkout', '--detach', 'pr/1092'],
			'/workspace/cascade-test-project-99999',
		);
		// Should NOT do the base-branch fetch+reset+checkout when PR is set
		expect(mockRunCommand).not.toHaveBeenCalledWith('git', ['fetch', 'origin'], expect.any(String));
		expect(mockRunCommand).not.toHaveBeenCalledWith(
			'git',
			['reset', '--hard', 'origin/main'],
			expect.any(String),
		);
	});

	it('verifies HEAD SHA on snapshot-reuse path when prNumber + prHeadSha provided', async () => {
		mockReaddirSync.mockReturnValue(['cascade-test-project-99999'] as never);
		const project = makeProject({ baseBranch: 'main' });
		const log = makeLog();
		const sha = '96f5136213d7a435e4b6e27b3d868f7b622b3dc0';
		mockRunCommand
			.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // fetch
			.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // checkout
			.mockResolvedValueOnce({ stdout: `${sha}\n`, stderr: '', exitCode: 0 }); // rev-parse

		await setupRepository({
			project,
			log,
			agentType: 'coder',
			prNumber: 1092,
			prHeadSha: sha,
		});

		expect(mockRunCommand).toHaveBeenCalledWith(
			'git',
			['rev-parse', 'HEAD'],
			'/workspace/cascade-test-project-99999',
		);
	});

	it('falls back to baseBranch "main" when project.baseBranch is not set', async () => {
		mockReaddirSync.mockReturnValue(['cascade-test-project-99999'] as never);
		const project = makeProject({ baseBranch: undefined });
		const log = makeLog();

		await setupRepository({ project, log, agentType: 'coder' });

		expect(mockRunCommand).toHaveBeenCalledWith(
			'git',
			['reset', '--hard', 'origin/main'],
			'/workspace/cascade-test-project-99999',
		);
	});

	it('does not run setup.sh or clone on snapshot-reuse path', async () => {
		mockReaddirSync.mockReturnValue(['cascade-test-project-99999'] as never);
		mockExistsSync.mockReturnValue(true); // setup.sh exists but should not run
		const project = makeProject();
		const log = makeLog();

		await setupRepository({ project, log, agentType: 'coder' });

		// Only git commands should run, not bash setup.sh
		expect(mockRunCommand).not.toHaveBeenCalledWith(
			'bash',
			expect.any(Array),
			expect.any(String),
			expect.any(Object),
		);
	});

	it('warms TS cache on snapshot dir when warmTsCache=true', async () => {
		mockReaddirSync.mockReturnValue(['cascade-test-project-99999'] as never);
		mockWarmTypeScriptCache.mockResolvedValue({ success: true, durationMs: 800 });
		const project = makeProject();
		const log = makeLog();

		await setupRepository({ project, log, agentType: 'coder', warmTsCache: true });

		expect(mockWarmTypeScriptCache).toHaveBeenCalledWith('/workspace/cascade-test-project-99999');
	});

	it('logs a warning and falls back to cold-start clone when no snapshot dir is found', async () => {
		mockReaddirSync.mockReturnValue([] as never); // no matching dir
		const project = makeProject();
		const log = makeLog();

		const result = await setupRepository({ project, log, agentType: 'coder' });

		expect(log.warn).toHaveBeenCalledWith(
			expect.stringContaining('falling back to clone'),
			expect.objectContaining({ projectId: 'test-project' }),
		);
		// Falls through to clone path
		expect(mockCreateTempDir).toHaveBeenCalledWith('test-project');
		expect(mockCloneRepo).toHaveBeenCalled();
		expect(result).toBe('/tmp/cascade-test-project-12345');
	});

	it('does not enter snapshot path when CASCADE_SNAPSHOT_REUSE is absent', async () => {
		delete process.env.CASCADE_SNAPSHOT_REUSE;
		const project = makeProject();
		const log = makeLog();

		await setupRepository({ project, log, agentType: 'coder' });

		expect(mockReaddirSync).not.toHaveBeenCalled();
		expect(mockCreateTempDir).toHaveBeenCalled();
		expect(mockCloneRepo).toHaveBeenCalled();
	});

	it('does not enter snapshot path when project.repo is not set', async () => {
		const project = makeProject({ repo: undefined });
		const log = makeLog();

		// Even with CASCADE_SNAPSHOT_REUSE=true, skip if no repo configured
		await setupRepository({ project, log, agentType: 'coder' });

		expect(mockReaddirSync).not.toHaveBeenCalled();
		expect(mockCreateTempDir).toHaveBeenCalled();
	});

	it('throws (no longer warns-and-continues) when git fetch exits non-zero on snapshot-reuse path', async () => {
		mockReaddirSync.mockReturnValue(['cascade-test-project-99999'] as never);
		mockRunCommand.mockResolvedValueOnce({
			stdout: '',
			stderr: 'network error',
			exitCode: 128,
		});
		const project = makeProject();
		const log = makeLog();

		await expect(setupRepository({ project, log, agentType: 'coder' })).rejects.toThrow(
			/git fetch.*128.*network error/s,
		);
	});

	it('throws (no longer warns-and-continues) when git reset --hard exits non-zero on snapshot-reuse path', async () => {
		mockReaddirSync.mockReturnValue(['cascade-test-project-99999'] as never);
		mockRunCommand
			.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // fetch ok
			.mockResolvedValueOnce({ stdout: '', stderr: 'conflict', exitCode: 1 }); // reset fails
		const project = makeProject();
		const log = makeLog();

		await expect(setupRepository({ project, log, agentType: 'coder' })).rejects.toThrow(
			/git reset.*1.*conflict/s,
		);
	});

	it('throws when git checkout exits non-zero on snapshot-reuse path', async () => {
		mockReaddirSync.mockReturnValue(['cascade-test-project-99999'] as never);
		mockRunCommand
			.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // fetch ok
			.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // reset ok
			.mockResolvedValueOnce({ stdout: '', stderr: 'pathspec', exitCode: 128 }); // checkout fails
		const project = makeProject();
		const log = makeLog();

		await expect(setupRepository({ project, log, agentType: 'coder' })).rejects.toThrow(
			/git checkout.*128.*pathspec/s,
		);
	});
});
