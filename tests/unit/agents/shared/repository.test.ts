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

	it('checks out PR branch when prBranch option is provided', async () => {
		const project = makeProject();
		const log = makeLog();

		await setupRepository({ project, log, agentType: 'coder', prBranch: 'feature/my-branch' });

		expect(mockRunCommand).toHaveBeenCalledWith(
			'git',
			['checkout', 'feature/my-branch'],
			'/tmp/cascade-test-project-12345',
		);
	});

	it('does not call git checkout when prBranch is not provided', async () => {
		const project = makeProject();
		const log = makeLog();

		await setupRepository({ project, log, agentType: 'coder' });

		expect(mockRunCommand).not.toHaveBeenCalledWith('git', expect.any(Array), expect.any(String));
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

	it('checks out prBranch instead of baseBranch when prBranch is provided', async () => {
		mockReaddirSync.mockReturnValue(['cascade-test-project-99999'] as never);
		const project = makeProject({ baseBranch: 'main' });
		const log = makeLog();

		await setupRepository({
			project,
			log,
			agentType: 'coder',
			prBranch: 'feature/my-branch',
		});

		expect(mockRunCommand).toHaveBeenCalledWith(
			'git',
			['reset', '--hard', 'origin/feature/my-branch'],
			'/workspace/cascade-test-project-99999',
		);
		expect(mockRunCommand).toHaveBeenCalledWith(
			'git',
			['checkout', 'feature/my-branch'],
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

	it('continues gracefully when git fetch exits non-zero', async () => {
		mockReaddirSync.mockReturnValue(['cascade-test-project-99999'] as never);
		mockRunCommand
			.mockResolvedValueOnce({ stdout: '', stderr: 'network error', exitCode: 128 }) // fetch fails
			.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }); // reset+checkout succeed
		const project = makeProject();
		const log = makeLog();

		const result = await setupRepository({ project, log, agentType: 'coder' });

		expect(result).toBe('/workspace/cascade-test-project-99999');
		expect(log.warn).toHaveBeenCalledWith(
			'git fetch exited with non-zero code (continuing)',
			expect.objectContaining({ exitCode: 128 }),
		);
	});

	it('continues gracefully when git reset --hard exits non-zero', async () => {
		mockReaddirSync.mockReturnValue(['cascade-test-project-99999'] as never);
		mockRunCommand
			.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // fetch ok
			.mockResolvedValueOnce({ stdout: '', stderr: 'conflict', exitCode: 1 }) // reset fails
			.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }); // checkout ok
		const project = makeProject();
		const log = makeLog();

		const result = await setupRepository({ project, log, agentType: 'coder' });

		expect(result).toBe('/workspace/cascade-test-project-99999');
		expect(log.warn).toHaveBeenCalledWith(
			'git reset --hard exited with non-zero code (continuing)',
			expect.objectContaining({ exitCode: 1 }),
		);
	});
});
