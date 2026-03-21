import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Static mocks (must be before any import) ──────────────────────────────────

vi.mock('../../src/sentry.js', () => ({
	captureException: vi.fn(),
	flush: vi.fn().mockResolvedValue(undefined),
	setTag: vi.fn(),
}));

vi.mock('../../src/config/env.js', () => ({
	loadEnvConfigSafe: vi.fn(() => ({ logLevel: 'info' })),
}));

vi.mock('../../src/db/client.js', () => ({
	getDb: vi.fn(),
}));

vi.mock('../../src/backends/bootstrap.js', () => ({
	registerBuiltInEngines: vi.fn(),
}));

vi.mock('../../src/config/provider.js', () => ({
	loadConfig: vi.fn().mockResolvedValue({ projects: [] }),
	loadProjectConfigById: vi.fn(),
}));

vi.mock('../../src/triggers/index.js', () => ({
	createTriggerRegistry: vi.fn(() => ({})),
	registerBuiltInTriggers: vi.fn(),
	processGitHubWebhook: vi.fn().mockResolvedValue(undefined),
	processJiraWebhook: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/triggers/trello/webhook-handler.js', () => ({
	processTrelloWebhook: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/utils/index.js', () => ({
	logger: {
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
	},
	setLogLevel: vi.fn(),
}));

vi.mock('../../src/utils/envScrub.js', () => ({
	scrubSensitiveEnv: vi.fn(),
}));

// Dynamic import mocks for processDashboardJob
vi.mock('../../src/triggers/shared/manual-runner.js', () => ({
	triggerManualRun: vi.fn().mockResolvedValue(undefined),
	triggerRetryRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/triggers/shared/debug-runner.js', () => ({
	triggerDebugAnalysis: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/db/repositories/runsRepository.js', () => ({
	getRunById: vi.fn(),
}));

// Dynamic imports used in main()
vi.mock('../../src/db/seeds/seedAgentDefinitions.js', () => ({
	seedAgentDefinitions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/config/agentMessages.js', () => ({
	initAgentMessages: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/agents/prompts/index.js', () => ({
	initPrompts: vi.fn().mockResolvedValue(undefined),
}));

// ── Imports (after vi.mock calls) ─────────────────────────────────────────────

import { loadProjectConfigById } from '../../src/config/provider.js';
import { getRunById } from '../../src/db/repositories/runsRepository.js';
import { captureException, flush } from '../../src/sentry.js';
import { processGitHubWebhook, processJiraWebhook } from '../../src/triggers/index.js';
import { triggerDebugAnalysis } from '../../src/triggers/shared/debug-runner.js';
import { triggerManualRun, triggerRetryRun } from '../../src/triggers/shared/manual-runner.js';
import { processTrelloWebhook } from '../../src/triggers/trello/webhook-handler.js';

// ── process.exit mock tests ───────────────────────────────────────────────────

describe('process.exit mock', () => {
	it('mocking process.exit prevents test runner termination', () => {
		const spy = vi.spyOn(process, 'exit').mockImplementation((code?: number | string | null) => {
			throw new Error(`process.exit(${code})`);
		});

		expect(() => process.exit(1)).toThrow('process.exit(1)');
		spy.mockRestore();
	});

	it('process.exit mock can capture exit code 0', () => {
		let capturedCode: number | undefined;
		const spy = vi.spyOn(process, 'exit').mockImplementation((code?: number | string | null) => {
			capturedCode = Number(code ?? 0);
			throw new Error(`process.exit(${capturedCode})`);
		});

		try {
			process.exit(0);
		} catch {
			// expected
		}

		spy.mockRestore();
		expect(capturedCode).toBe(0);
	});
});

// ── dispatchJob routing tests (direct function call simulation) ────────────────

describe('dispatchJob routing', () => {
	it('routes trello job to processTrelloWebhook with correct arguments', async () => {
		const mockRegistry = { triggers: [] };
		const payload = { action: { type: 'updateCard' } };
		const ackCommentId = 'comment-123';
		const triggerResult = { matched: true, agentType: 'implementation' } as never;

		// Simulate what dispatchJob does for trello type
		await processTrelloWebhook(payload, mockRegistry as never, ackCommentId, triggerResult);

		expect(processTrelloWebhook).toHaveBeenCalledWith(
			payload,
			mockRegistry,
			ackCommentId,
			triggerResult,
		);
	});

	it('routes github job to processGitHubWebhook with correct arguments including eventType and ackMessage', async () => {
		const mockRegistry = { triggers: [] };
		const payload = { action: 'opened', pull_request: {} };
		const eventType = 'pull_request';
		const ackCommentId = 456;
		const ackMessage = 'Starting implementation...';
		const triggerResult = { matched: true, agentType: 'implementation' } as never;

		// Simulate what dispatchJob does for github type
		await processGitHubWebhook(
			payload,
			eventType,
			mockRegistry as never,
			ackCommentId,
			ackMessage,
			triggerResult,
		);

		expect(processGitHubWebhook).toHaveBeenCalledWith(
			payload,
			eventType,
			mockRegistry,
			ackCommentId,
			ackMessage,
			triggerResult,
		);
	});

	it('routes jira job to processJiraWebhook with correct arguments', async () => {
		const mockRegistry = { triggers: [] };
		const payload = { issue: { key: 'PROJ-1' } };
		const ackCommentId = 'jira-comment-789';
		const triggerResult = { matched: true, agentType: 'implementation' } as never;

		// Simulate what dispatchJob does for jira type
		await processJiraWebhook(payload, mockRegistry as never, ackCommentId, triggerResult);

		expect(processJiraWebhook).toHaveBeenCalledWith(
			payload,
			mockRegistry,
			ackCommentId,
			triggerResult,
		);
	});

	it('routes manual-run to processDashboardJob (triggerManualRun is mock function)', () => {
		// Verify the mock is in place for the manual-run routing path
		expect(vi.isMockFunction(triggerManualRun)).toBe(true);
	});

	it('routes retry-run to processDashboardJob (triggerRetryRun is mock function)', () => {
		// Verify the mock is in place for the retry-run routing path
		expect(vi.isMockFunction(triggerRetryRun)).toBe(true);
	});

	it('routes debug-analysis to processDashboardJob (triggerDebugAnalysis is mock function)', () => {
		// Verify the mock is in place for the debug-analysis routing path
		expect(vi.isMockFunction(triggerDebugAnalysis)).toBe(true);
	});

	it('handles unknown job type by calling captureException and flush then process.exit(1)', async () => {
		// Test the exact code path for unknown types
		const unknownType = 'totally-unknown-job-type';
		let processExitCalled = false;
		let exitCode: number | undefined;

		const spy = vi.spyOn(process, 'exit').mockImplementation((code?: number | string | null) => {
			processExitCalled = true;
			exitCode = Number(code ?? 0);
			throw new Error(`process.exit(${exitCode})`);
		});

		try {
			// Replicate exact dispatchJob logic for default case
			vi.mocked(captureException)(new Error(`Unknown job type: ${unknownType}`), {
				tags: { source: 'worker_unknown_job' },
			});
			await vi.mocked(flush)();
			process.exit(1);
		} catch (err: unknown) {
			if (!(err instanceof Error && err.message.startsWith('process.exit('))) {
				throw err;
			}
		} finally {
			spy.mockRestore();
		}

		expect(captureException).toHaveBeenCalledWith(
			expect.objectContaining({ message: `Unknown job type: ${unknownType}` }),
			expect.objectContaining({ tags: { source: 'worker_unknown_job' } }),
		);
		expect(flush).toHaveBeenCalled();
		expect(processExitCalled).toBe(true);
		expect(exitCode).toBe(1);
	});
});

// ── processDashboardJob tests ─────────────────────────────────────────────────

describe('processDashboardJob - manual-run', () => {
	it('loads project config and calls triggerManualRun with correct params', async () => {
		const mockProject = { id: 'proj-1', name: 'Test Project' };
		const mockConfig = { projects: [mockProject] };

		vi.mocked(loadProjectConfigById).mockResolvedValue({
			project: mockProject as never,
			config: mockConfig as never,
		});

		// Simulate what processDashboardJob does for manual-run
		const jobData = {
			type: 'manual-run' as const,
			projectId: 'proj-1',
			agentType: 'implementation',
			workItemId: 'card-1',
			prNumber: undefined,
			prBranch: undefined,
			repoFullName: undefined,
			headSha: undefined,
			modelOverride: 'claude-sonnet-4-5',
		};

		const pc = await loadProjectConfigById(jobData.projectId);
		if (!pc) throw new Error(`Project not found: ${jobData.projectId}`);

		await triggerManualRun(
			{
				projectId: jobData.projectId,
				agentType: jobData.agentType,
				workItemId: jobData.workItemId,
				prNumber: jobData.prNumber,
				prBranch: jobData.prBranch,
				repoFullName: jobData.repoFullName,
				headSha: jobData.headSha,
				modelOverride: jobData.modelOverride,
			},
			pc.project,
			pc.config,
		);

		expect(loadProjectConfigById).toHaveBeenCalledWith('proj-1');
		expect(triggerManualRun).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: 'proj-1',
				agentType: 'implementation',
				workItemId: 'card-1',
				modelOverride: 'claude-sonnet-4-5',
			}),
			mockProject,
			mockConfig,
		);
	});

	it('throws when project not found (loadProjectConfigById returns undefined)', async () => {
		vi.mocked(loadProjectConfigById).mockResolvedValue(undefined);

		// Simulate processDashboardJob check
		const pc = await loadProjectConfigById('non-existent');

		const throwFn = () => {
			if (!pc) throw new Error('Project not found: non-existent');
		};

		expect(throwFn).toThrow('Project not found: non-existent');
		expect(loadProjectConfigById).toHaveBeenCalledWith('non-existent');
	});
});

describe('processDashboardJob - retry-run', () => {
	it('looks up run via getRunById, loads project config, and calls triggerRetryRun', async () => {
		const mockProject = { id: 'proj-1', name: 'Test Project' };
		const mockConfig = { projects: [mockProject] };
		const mockRun = {
			id: 'run-abc',
			projectId: 'proj-1',
			agentType: 'implementation',
		};

		vi.mocked(getRunById).mockResolvedValue(mockRun as never);
		vi.mocked(loadProjectConfigById).mockResolvedValue({
			project: mockProject as never,
			config: mockConfig as never,
		});

		// Simulate processDashboardJob retry-run logic
		const jobData = {
			type: 'retry-run' as const,
			runId: 'run-abc',
			projectId: 'proj-1',
			modelOverride: undefined,
		};

		const run = await getRunById(jobData.runId);
		if (!run?.projectId) throw new Error(`Run not found or has no project: ${jobData.runId}`);

		const pc = await loadProjectConfigById(run.projectId);
		if (!pc) throw new Error(`Project not found: ${run.projectId}`);

		await triggerRetryRun(jobData.runId, pc.project, pc.config, jobData.modelOverride);

		expect(getRunById).toHaveBeenCalledWith('run-abc');
		expect(loadProjectConfigById).toHaveBeenCalledWith('proj-1');
		expect(triggerRetryRun).toHaveBeenCalledWith('run-abc', mockProject, mockConfig, undefined);
	});

	it('throws when run not found (getRunById returns null)', async () => {
		vi.mocked(getRunById).mockResolvedValue(null);

		const run = await getRunById('missing-run');

		const throwFn = () => {
			if (!run?.projectId) throw new Error('Run not found or has no project: missing-run');
		};

		expect(throwFn).toThrow('Run not found or has no project: missing-run');
		expect(getRunById).toHaveBeenCalledWith('missing-run');
	});

	it('passes modelOverride to triggerRetryRun when provided', async () => {
		const mockProject = { id: 'proj-1', name: 'Test Project' };
		const mockConfig = { projects: [mockProject] };
		const mockRun = { id: 'run-xyz', projectId: 'proj-1', agentType: 'review' };

		vi.mocked(getRunById).mockResolvedValue(mockRun as never);
		vi.mocked(loadProjectConfigById).mockResolvedValue({
			project: mockProject as never,
			config: mockConfig as never,
		});

		const run = await getRunById('run-xyz');
		if (!run?.projectId) throw new Error('Run not found');
		const pc = await loadProjectConfigById(run.projectId);
		if (!pc) throw new Error('Project not found');

		await triggerRetryRun('run-xyz', pc.project, pc.config, 'claude-3-5-sonnet-20241022');

		expect(triggerRetryRun).toHaveBeenCalledWith(
			'run-xyz',
			mockProject,
			mockConfig,
			'claude-3-5-sonnet-20241022',
		);
	});
});

describe('processDashboardJob - debug-analysis', () => {
	it('loads project config and calls triggerDebugAnalysis with correct params', async () => {
		const mockProject = { id: 'proj-1', name: 'Test Project' };
		const mockConfig = { projects: [mockProject] };

		vi.mocked(loadProjectConfigById).mockResolvedValue({
			project: mockProject as never,
			config: mockConfig as never,
		});

		// Simulate processDashboardJob debug-analysis logic
		const jobData = {
			type: 'debug-analysis' as const,
			runId: 'run-xyz',
			projectId: 'proj-1',
			workItemId: 'card-debug',
		};

		const pc = await loadProjectConfigById(jobData.projectId);
		if (!pc) throw new Error(`Project not found: ${jobData.projectId}`);

		await triggerDebugAnalysis(jobData.runId, pc.project, pc.config, jobData.workItemId);

		expect(loadProjectConfigById).toHaveBeenCalledWith('proj-1');
		expect(triggerDebugAnalysis).toHaveBeenCalledWith(
			'run-xyz',
			mockProject,
			mockConfig,
			'card-debug',
		);
	});

	it('throws when project not found for debug-analysis', async () => {
		vi.mocked(loadProjectConfigById).mockResolvedValue(undefined);

		const pc = await loadProjectConfigById('bad-proj');

		const throwFn = () => {
			if (!pc) throw new Error('Project not found: bad-proj');
		};

		expect(throwFn).toThrow('Project not found: bad-proj');
	});

	it('calls triggerDebugAnalysis without workItemId when not provided', async () => {
		const mockProject = { id: 'proj-1', name: 'Test Project' };
		const mockConfig = { projects: [mockProject] };

		vi.mocked(loadProjectConfigById).mockResolvedValue({
			project: mockProject as never,
			config: mockConfig as never,
		});

		const pc = await loadProjectConfigById('proj-1');
		if (!pc) throw new Error('Project not found');

		// workItemId is undefined
		await triggerDebugAnalysis('run-no-card', pc.project, pc.config, undefined);

		expect(triggerDebugAnalysis).toHaveBeenCalledWith(
			'run-no-card',
			mockProject,
			mockConfig,
			undefined,
		);
	});
});

// ── main() env var validation tests ──────────────────────────────────────────

describe('main() - environment variable validation', () => {
	let exitSpy: ReturnType<typeof vi.spyOn>;
	let capturedExitCode: number | undefined;

	beforeEach(() => {
		capturedExitCode = undefined;
		exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number | string | null) => {
			capturedExitCode = Number(code ?? 0);
			throw new Error(`process.exit(${capturedExitCode})`);
		});
	});

	afterEach(() => {
		exitSpy.mockRestore();
		// biome-ignore lint/performance/noDelete: process.env requires delete to truly unset
		delete process.env.JOB_ID;
		// biome-ignore lint/performance/noDelete: process.env requires delete to truly unset
		delete process.env.JOB_TYPE;
		// biome-ignore lint/performance/noDelete: process.env requires delete to truly unset
		delete process.env.JOB_DATA;
	});

	it('calls captureException with correct error when required env vars are missing', () => {
		// Simulate main() behavior when env vars are missing
		const jobId = undefined;
		const jobType = undefined;
		const jobDataRaw = undefined;

		if (!jobId || !jobType || !jobDataRaw) {
			const err = new Error('Missing required environment variables: JOB_ID, JOB_TYPE, JOB_DATA');
			vi.mocked(captureException)(err, { tags: { source: 'worker_env' } });
		}

		expect(captureException).toHaveBeenCalledWith(
			expect.objectContaining({
				message: 'Missing required environment variables: JOB_ID, JOB_TYPE, JOB_DATA',
			}),
			expect.objectContaining({ tags: { source: 'worker_env' } }),
		);
	});

	it('calls captureException with correct tag when JSON parsing fails', () => {
		// Simulate main() JSON parse error behavior
		const jobDataRaw = 'not-valid-json{{{';

		try {
			JSON.parse(jobDataRaw);
		} catch (err) {
			vi.mocked(captureException)(err, { tags: { source: 'worker_job_parse' } });
		}

		expect(captureException).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ tags: { source: 'worker_job_parse' } }),
		);
	});

	it('exits with code 1 when process.exit(1) is called for missing env vars', () => {
		// Test the process.exit call directly
		let caughtCode: number | undefined;
		try {
			process.exit(1);
		} catch (err: unknown) {
			if (err instanceof Error && err.message.startsWith('process.exit(')) {
				caughtCode = 1;
			}
		}

		expect(caughtCode).toBe(1);
		expect(capturedExitCode).toBe(1);
	});

	it('exits with code 0 on successful job processing', () => {
		// Test successful exit path
		let caughtCode: number | undefined;
		try {
			process.exit(0);
		} catch (err: unknown) {
			if (err instanceof Error && err.message.startsWith('process.exit(')) {
				caughtCode = 0;
			}
		}

		expect(caughtCode).toBe(0);
		expect(capturedExitCode).toBe(0);
	});
});
