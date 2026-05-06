import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BootFailureError } from '../../../src/agents/shared/bootFailureError.js';
import { executeWithEngine } from '../../../src/backends/adapter.js';
import type { AgentEngine } from '../../../src/backends/types.js';
import { getRunsByProjectId } from '../../../src/db/repositories/runsRepository.js';
import type { AgentInput, CascadeConfig, ProjectConfig } from '../../../src/types/index.js';
import { truncateAll } from '../helpers/db.js';
import { seedOrg, seedProject } from '../helpers/seed.js';

function makeEngine(): AgentEngine {
	return {
		definition: {
			id: 'test-engine',
			label: 'Test Engine',
			description: 'Test engine',
			archetype: 'sdk',
			capabilities: [],
			modelSelection: { type: 'free-text' },
			logLabel: 'Engine Log',
		},
		execute: vi.fn().mockResolvedValue({ success: true, output: 'should not run' }),
		supportsAgentType: () => true,
	};
}

function makeProject(): ProjectConfig {
	return {
		id: 'test-project',
		name: 'Test Project',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		trello: { boardId: 'board-1', lists: {}, labels: {} },
	};
}

function makeInput(logDir: string): AgentInput & { project: ProjectConfig; config: CascadeConfig } {
	return {
		workItemId: 'sentry:issue:117972276',
		triggerType: 'alerting:issue-alert',
		logDir,
		project: makeProject(),
		config: { projects: [] },
	} as AgentInput & { project: ProjectConfig; config: CascadeConfig };
}

describe('executeWithEngine boot failure visibility (integration)', () => {
	let previousWorkspaceDir: string | undefined;
	let workspaceDir: string;
	let repoDir: string;

	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
		await seedProject();

		previousWorkspaceDir = process.env.CASCADE_WORKSPACE_DIR;
		workspaceDir = mkdtempSync(join(tmpdir(), 'cascade-worker-logs-'));
		repoDir = mkdtempSync(join(tmpdir(), 'cascade-worker-repo-'));
		process.env.CASCADE_WORKSPACE_DIR = workspaceDir;
	});

	afterEach(() => {
		if (previousWorkspaceDir === undefined) {
			delete process.env.CASCADE_WORKSPACE_DIR;
		} else {
			process.env.CASCADE_WORKSPACE_DIR = previousWorkspaceDir;
		}
		rmSync(workspaceDir, { recursive: true, force: true });
		rmSync(repoDir, { recursive: true, force: true });
	});

	it('creates and fails a run row when a boot-phase definition lookup fails', async () => {
		const engine = makeEngine();

		try {
			await executeWithEngine(engine, 'missing-agent-type', makeInput(repoDir));
			throw new Error('expected executeWithEngine to throw');
		} catch (err) {
			expect(err).toBeInstanceOf(BootFailureError);
			expect(err).toMatchObject({
				name: 'BootFailureError',
				phase: 'definition-lookup',
			});
		}

		expect(engine.execute).not.toHaveBeenCalled();
		const runs = await getRunsByProjectId('test-project');
		expect(runs).toHaveLength(1);
		for (const run of runs) {
			expect(run).toMatchObject({
				projectId: 'test-project',
				workItemId: 'sentry:issue:117972276',
				agentType: 'missing-agent-type',
				engine: 'test-engine',
				status: 'failed',
				success: false,
			});
			expect(run.error).toContain('missing-agent-type');
		}
	});
});
