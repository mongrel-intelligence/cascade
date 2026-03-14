import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock external dependencies before imports
vi.mock('../../../../src/utils/repo.js', () => ({
	cloneRepo: vi.fn(),
	createTempDir: vi.fn(),
	runCommand: vi.fn(),
}));

vi.mock('../../../../src/agents/utils/setup.js', () => ({
	warmTypeScriptCache: vi.fn(),
}));

vi.mock('node:fs', () => ({
	existsSync: vi.fn(),
}));

import { existsSync } from 'node:fs';

import { setupRepository } from '../../../../src/agents/shared/repository.js';
import { warmTypeScriptCache } from '../../../../src/agents/utils/setup.js';
import type { ProjectConfig } from '../../../../src/types/index.js';
import { cloneRepo, createTempDir, runCommand } from '../../../../src/utils/repo.js';

const mockCreateTempDir = vi.mocked(createTempDir);
const mockCloneRepo = vi.mocked(cloneRepo);
const mockRunCommand = vi.mocked(runCommand);
const mockWarmTypeScriptCache = vi.mocked(warmTypeScriptCache);
const mockExistsSync = vi.mocked(existsSync);

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
	vi.clearAllMocks();
	mockCreateTempDir.mockReturnValue('/tmp/cascade-test-project-12345');
	mockCloneRepo.mockResolvedValue(undefined);
	mockRunCommand.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
	mockExistsSync.mockReturnValue(false);
	mockWarmTypeScriptCache.mockResolvedValue(null);
});

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
