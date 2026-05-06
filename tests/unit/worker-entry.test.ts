import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Static mocks (must be before any import, hoisted by Vitest) ───────────────

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

vi.mock('../../src/triggers/sentry/webhook-handler.js', () => ({
	processSentryWebhook: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/triggers/linear/webhook-handler.js', () => ({
	processLinearWebhook: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/router/pm-ack-dispatch.js', () => ({
	dispatchPMAck: vi.fn(),
}));

vi.mock('../../src/router/ackMessageGenerator.js', () => ({
	extractTrelloContext: vi.fn().mockReturnValue(''),
	extractJiraContext: vi.fn().mockReturnValue(''),
	extractLinearContext: vi.fn().mockReturnValue(''),
	generateAckMessage: vi.fn().mockResolvedValue('🔨 Generated ack message'),
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

import { BootFailureError } from '../../src/agents/shared/bootFailureError.js';
import { loadProjectConfigById } from '../../src/config/provider.js';
import { getRunById } from '../../src/db/repositories/runsRepository.js';
import {
	extractJiraContext,
	extractLinearContext,
	extractTrelloContext,
	generateAckMessage,
} from '../../src/router/ackMessageGenerator.js';
import { dispatchPMAck } from '../../src/router/pm-ack-dispatch.js';
import { captureException, flush } from '../../src/sentry.js';
import { processGitHubWebhook, processJiraWebhook } from '../../src/triggers/index.js';
import { processLinearWebhook } from '../../src/triggers/linear/webhook-handler.js';
import { processSentryWebhook } from '../../src/triggers/sentry/webhook-handler.js';
import { triggerDebugAnalysis } from '../../src/triggers/shared/debug-runner.js';
import { triggerManualRun, triggerRetryRun } from '../../src/triggers/shared/manual-runner.js';
import { processTrelloWebhook } from '../../src/triggers/trello/webhook-handler.js';
import {
	type DebugAnalysisJobData,
	dispatchJob,
	type GitHubJobData,
	type JiraJobData,
	type LinearJobData,
	type ManualRunJobData,
	main,
	processDashboardJob,
	type RetryRunJobData,
	type SentryJobData,
	type TrelloJobData,
} from '../../src/worker-entry.js';

// ── dispatchJob routing tests ─────────────────────────────────────────────────

describe('dispatchJob routing', () => {
	it('routes trello job to processTrelloWebhook with payload, registry, ackCommentId, triggerResult', async () => {
		const mockRegistry = {};
		const jobPayload = { action: { type: 'updateCard' } };
		const triggerResult = { matched: true, agentType: 'implementation' } as never;

		const jobData: TrelloJobData = {
			type: 'trello',
			source: 'trello',
			payload: jobPayload,
			projectId: 'proj-1',
			workItemId: 'card-1',
			actionType: 'updateCard',
			receivedAt: '2024-01-01T00:00:00Z',
			ackCommentId: 'comment-123',
			triggerResult,
		};

		await dispatchJob('job-1', jobData, mockRegistry as never);

		expect(processTrelloWebhook).toHaveBeenCalledWith(
			jobPayload,
			mockRegistry,
			'comment-123',
			triggerResult,
		);
	});

	it('routes github job to processGitHubWebhook with payload, eventType, registry, ackCommentId, ackMessage, triggerResult', async () => {
		const mockRegistry = {};
		const jobPayload = { action: 'opened', pull_request: {} };
		const triggerResult = { matched: true, agentType: 'review' } as never;

		const jobData: GitHubJobData = {
			type: 'github',
			source: 'github',
			payload: jobPayload,
			eventType: 'pull_request',
			repoFullName: 'org/repo',
			receivedAt: '2024-01-01T00:00:00Z',
			ackCommentId: 456,
			ackMessage: 'Starting implementation...',
			triggerResult,
		};

		await dispatchJob('job-2', jobData, mockRegistry as never);

		expect(processGitHubWebhook).toHaveBeenCalledWith(
			jobPayload,
			'pull_request',
			mockRegistry,
			456,
			'Starting implementation...',
			triggerResult,
		);
	});

	it('routes jira job to processJiraWebhook with payload, registry, ackCommentId, triggerResult', async () => {
		const mockRegistry = {};
		const jobPayload = { issue: { key: 'PROJ-1' } };
		const triggerResult = { matched: true, agentType: 'implementation' } as never;

		const jobData: JiraJobData = {
			type: 'jira',
			source: 'jira',
			payload: jobPayload,
			projectId: 'proj-1',
			issueKey: 'PROJ-1',
			webhookEvent: 'jira:issue_updated',
			receivedAt: '2024-01-01T00:00:00Z',
			ackCommentId: 'jira-comment-789',
			triggerResult,
		};

		await dispatchJob('job-3', jobData, mockRegistry as never);

		expect(processJiraWebhook).toHaveBeenCalledWith(
			jobPayload,
			mockRegistry,
			'jira-comment-789',
			triggerResult,
		);
	});

	it('routes sentry job to processSentryWebhook with payload, projectId, registry, and triggerResult', async () => {
		const mockRegistry = {};
		const jobPayload = { resource: 'event_alert', cascadeProjectId: 'proj-sentry' };
		const triggerResult = { matched: true, agentType: 'alerting' } as never;

		const jobData: SentryJobData = {
			type: 'sentry',
			source: 'sentry',
			payload: jobPayload,
			projectId: 'proj-sentry',
			eventType: 'event_alert',
			receivedAt: '2024-01-01T00:00:00Z',
			triggerResult,
		};

		await dispatchJob('job-sentry-1', jobData, mockRegistry as never);

		expect(processSentryWebhook).toHaveBeenCalledWith(
			jobPayload,
			'proj-sentry',
			mockRegistry,
			triggerResult,
		);
	});

	it('routes manual-run job to processDashboardJob (calls triggerManualRun)', async () => {
		const mockProject = { id: 'proj-1', name: 'Test Project' };
		const mockConfig = { projects: [mockProject] };
		vi.mocked(loadProjectConfigById).mockResolvedValue({
			project: mockProject as never,
			config: mockConfig as never,
		});

		const jobData: ManualRunJobData = {
			type: 'manual-run',
			projectId: 'proj-1',
			agentType: 'implementation',
			workItemId: 'card-1',
			modelOverride: 'claude-sonnet-4-5',
		};

		await dispatchJob('job-4', jobData, {} as never);

		expect(triggerManualRun).toHaveBeenCalledWith(
			expect.objectContaining({ projectId: 'proj-1', agentType: 'implementation' }),
			mockProject,
			mockConfig,
		);
	});

	it('routes retry-run job to processDashboardJob (calls triggerRetryRun)', async () => {
		const mockProject = { id: 'proj-1', name: 'Test Project' };
		const mockConfig = { projects: [mockProject] };
		const mockRun = { id: 'run-abc', projectId: 'proj-1', agentType: 'implementation' };
		vi.mocked(getRunById).mockResolvedValue(mockRun as never);
		vi.mocked(loadProjectConfigById).mockResolvedValue({
			project: mockProject as never,
			config: mockConfig as never,
		});

		const jobData: RetryRunJobData = {
			type: 'retry-run',
			runId: 'run-abc',
			projectId: 'proj-1',
		};

		await dispatchJob('job-5', jobData, {} as never);

		expect(triggerRetryRun).toHaveBeenCalledWith('run-abc', mockProject, mockConfig, undefined);
	});

	it('routes debug-analysis job to processDashboardJob (calls triggerDebugAnalysis)', async () => {
		const mockProject = { id: 'proj-1', name: 'Test Project' };
		const mockConfig = { projects: [mockProject] };
		vi.mocked(loadProjectConfigById).mockResolvedValue({
			project: mockProject as never,
			config: mockConfig as never,
		});

		const jobData: DebugAnalysisJobData = {
			type: 'debug-analysis',
			runId: 'run-xyz',
			projectId: 'proj-1',
			workItemId: 'card-debug',
		};

		await dispatchJob('job-6', jobData, {} as never);

		expect(triggerDebugAnalysis).toHaveBeenCalledWith(
			'run-xyz',
			mockProject,
			mockConfig,
			'card-debug',
		);
	});

	it('routes linear job to processLinearWebhook with payload, registry, ackCommentId, triggerResult', async () => {
		const mockRegistry = {};
		const jobPayload = { type: 'Issue', data: { id: 'lin-1' } };
		const triggerResult = { matched: true, agentType: 'implementation' } as never;

		const jobData: LinearJobData = {
			type: 'linear',
			source: 'linear',
			payload: jobPayload,
			projectId: 'proj-1',
			workItemId: 'lin-1',
			eventType: 'create/Issue',
			receivedAt: '2024-01-01T00:00:00Z',
			ackCommentId: 'lin-comment-789',
			triggerResult,
		};

		await dispatchJob('job-linear-1', jobData, mockRegistry as never);

		expect(processLinearWebhook).toHaveBeenCalledWith(
			jobPayload,
			mockRegistry,
			'lin-comment-789',
			triggerResult,
		);
		// Without pendingAck, the deferred-ack path is NOT taken
		expect(dispatchPMAck).not.toHaveBeenCalled();
	});

	it('handles unknown job type by calling captureException with worker_unknown_job tag', async () => {
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?) => {
			throw new Error(`process.exit(${code})`);
		});

		try {
			await dispatchJob('job-unknown', { type: 'totally-unknown-job-type' } as never, {} as never);
		} catch (err: unknown) {
			if (!(err instanceof Error && err.message.startsWith('process.exit('))) {
				throw err;
			}
		} finally {
			exitSpy.mockRestore();
		}

		expect(captureException).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'Unknown job type: totally-unknown-job-type' }),
			expect.objectContaining({ tags: { source: 'worker_unknown_job' } }),
		);
		expect(flush).toHaveBeenCalled();
	});
});

// ── deferred ack tests (postDeferredAck via dispatchJob) ──────────────────────

describe('dispatchJob - deferred ack (pendingAck=true)', () => {
	beforeEach(() => {
		vi.mocked(dispatchPMAck).mockReset();
		vi.mocked(extractJiraContext).mockReset().mockReturnValue('');
		vi.mocked(extractLinearContext).mockReset().mockReturnValue('');
		vi.mocked(extractTrelloContext).mockReset().mockReturnValue('');
		vi.mocked(generateAckMessage).mockReset().mockResolvedValue('🔨 Generated ack');
	});

	it('trello pendingAck: extracts context, generates ack message, posts via dispatchPMAck, passes new commentId to processTrelloWebhook', async () => {
		vi.mocked(extractTrelloContext).mockReturnValueOnce('Card: do the thing');
		vi.mocked(generateAckMessage).mockResolvedValueOnce('🔨 Working on the thing');
		vi.mocked(dispatchPMAck).mockResolvedValueOnce({
			commentId: 'trello-deferred-1',
			message: '🔨 Working on the thing',
		});

		const jobData: TrelloJobData = {
			type: 'trello',
			source: 'trello',
			payload: { action: { data: { card: { name: 'do the thing' } } } },
			projectId: 'proj-1',
			workItemId: 'card-1',
			actionType: 'updateCard',
			receivedAt: '2024-01-01T00:00:00Z',
			pendingAck: true,
			ackContextHint: 'do the thing',
			triggerResult: { agentType: 'implementation' } as never,
		};

		await dispatchJob('job-trello-deferred', jobData, {} as never);

		expect(extractTrelloContext).toHaveBeenCalledWith(jobData.payload);
		expect(generateAckMessage).toHaveBeenCalledWith(
			'implementation',
			'Card: do the thing',
			'proj-1',
		);
		expect(dispatchPMAck).toHaveBeenCalledWith({
			projectId: 'proj-1',
			workItemId: 'card-1',
			pmType: 'trello',
			message: '🔨 Working on the thing',
			agentType: 'implementation',
		});
		expect(processTrelloWebhook).toHaveBeenCalledWith(
			jobData.payload,
			expect.anything(),
			'trello-deferred-1',
			jobData.triggerResult,
		);
	});

	it('jira pendingAck: extracts context, generates ack, posts via dispatchPMAck, passes new commentId to processJiraWebhook', async () => {
		vi.mocked(extractJiraContext).mockReturnValueOnce('Issue: PROJ-1 — Fix bug');
		vi.mocked(generateAckMessage).mockResolvedValueOnce('🔨 On the bug fix');
		vi.mocked(dispatchPMAck).mockResolvedValueOnce({
			commentId: 'jira-deferred-1',
			message: '🔨 On the bug fix',
		});

		const jobData: JiraJobData = {
			type: 'jira',
			source: 'jira',
			payload: { issue: { key: 'PROJ-1', fields: { summary: 'Fix bug' } } },
			projectId: 'proj-1',
			issueKey: 'PROJ-1',
			webhookEvent: 'jira:issue_updated',
			receivedAt: '2024-01-01T00:00:00Z',
			pendingAck: true,
			ackContextHint: 'Fix bug',
			triggerResult: { agentType: 'implementation' } as never,
		};

		await dispatchJob('job-jira-deferred', jobData, {} as never);

		expect(extractJiraContext).toHaveBeenCalledWith(jobData.payload);
		expect(generateAckMessage).toHaveBeenCalledWith(
			'implementation',
			'Issue: PROJ-1 — Fix bug',
			'proj-1',
		);
		expect(dispatchPMAck).toHaveBeenCalledWith({
			projectId: 'proj-1',
			workItemId: 'PROJ-1',
			pmType: 'jira',
			message: '🔨 On the bug fix',
			agentType: 'implementation',
		});
		expect(processJiraWebhook).toHaveBeenCalledWith(
			jobData.payload,
			expect.anything(),
			'jira-deferred-1',
			jobData.triggerResult,
		);
	});

	it('linear pendingAck: extracts context, generates ack, posts via dispatchPMAck, passes new commentId to processLinearWebhook', async () => {
		vi.mocked(extractLinearContext).mockReturnValueOnce('Issue: TEAM-12 — Add feature');
		vi.mocked(generateAckMessage).mockResolvedValueOnce('🔨 Building the feature');
		vi.mocked(dispatchPMAck).mockResolvedValueOnce({
			commentId: 'linear-deferred-1',
			message: '🔨 Building the feature',
		});

		const jobData: LinearJobData = {
			type: 'linear',
			source: 'linear',
			payload: { type: 'Issue', data: { id: 'lin-1', title: 'Add feature' } },
			projectId: 'proj-1',
			workItemId: 'lin-1',
			eventType: 'update/Issue',
			receivedAt: '2024-01-01T00:00:00Z',
			pendingAck: true,
			ackContextHint: 'Add feature',
			triggerResult: { agentType: 'implementation' } as never,
		};

		await dispatchJob('job-linear-deferred', jobData, {} as never);

		expect(extractLinearContext).toHaveBeenCalledWith(jobData.payload);
		expect(generateAckMessage).toHaveBeenCalledWith(
			'implementation',
			'Issue: TEAM-12 — Add feature',
			'proj-1',
		);
		expect(dispatchPMAck).toHaveBeenCalledWith({
			projectId: 'proj-1',
			workItemId: 'lin-1',
			pmType: 'linear',
			message: '🔨 Building the feature',
			agentType: 'implementation',
		});
		expect(processLinearWebhook).toHaveBeenCalledWith(
			jobData.payload,
			expect.anything(),
			'linear-deferred-1',
			jobData.triggerResult,
		);
	});

	it('falls back to ackContextHint when payload extractor returns empty', async () => {
		vi.mocked(extractJiraContext).mockReturnValueOnce('');
		vi.mocked(generateAckMessage).mockResolvedValueOnce('🔨 generic');
		vi.mocked(dispatchPMAck).mockResolvedValueOnce({
			commentId: 'jira-fallback-1',
			message: '🔨 generic',
		});

		const jobData: JiraJobData = {
			type: 'jira',
			source: 'jira',
			payload: { issue: {} },
			projectId: 'proj-1',
			issueKey: 'PROJ-1',
			webhookEvent: 'jira:issue_updated',
			receivedAt: '2024-01-01T00:00:00Z',
			pendingAck: true,
			ackContextHint: 'Fallback Title',
			triggerResult: { agentType: 'implementation' } as never,
		};

		await dispatchJob('job-jira-fallback', jobData, {} as never);

		expect(generateAckMessage).toHaveBeenCalledWith(
			'implementation',
			'Issue: Fallback Title',
			'proj-1',
		);
	});

	it('passes empty agentType when triggerResult.agentType is missing', async () => {
		vi.mocked(extractTrelloContext).mockReturnValueOnce('Card: x');
		vi.mocked(generateAckMessage).mockResolvedValueOnce('msg');
		vi.mocked(dispatchPMAck).mockResolvedValueOnce({ commentId: 't', message: 'msg' });

		const jobData: TrelloJobData = {
			type: 'trello',
			source: 'trello',
			payload: {},
			projectId: 'proj-1',
			workItemId: 'card-1',
			actionType: 'updateCard',
			receivedAt: '2024-01-01T00:00:00Z',
			pendingAck: true,
			// no triggerResult and no ackContextHint
		};

		await dispatchJob('job-no-agent', jobData, {} as never);

		expect(generateAckMessage).toHaveBeenCalledWith('', 'Card: x', 'proj-1');
		expect(dispatchPMAck).toHaveBeenCalledWith(expect.objectContaining({ agentType: undefined }));
	});

	it('preserves original ackCommentId when dispatchPMAck rejects (non-fatal)', async () => {
		vi.mocked(extractJiraContext).mockReturnValueOnce('Issue: x');
		vi.mocked(dispatchPMAck).mockRejectedValueOnce(new Error('PM API down'));

		const jobData: JiraJobData = {
			type: 'jira',
			source: 'jira',
			payload: {},
			projectId: 'proj-1',
			issueKey: 'PROJ-2',
			webhookEvent: 'jira:issue_updated',
			receivedAt: '2024-01-01T00:00:00Z',
			ackCommentId: 'pre-existing',
			pendingAck: true,
			triggerResult: { agentType: 'implementation' } as never,
		};

		// Must not throw — deferred ack failure is non-fatal
		await expect(dispatchJob('job-ack-fail', jobData, {} as never)).resolves.toBeUndefined();

		// Falls back to the pre-existing ackCommentId from the job data
		expect(processJiraWebhook).toHaveBeenCalledWith(
			jobData.payload,
			expect.anything(),
			'pre-existing',
			jobData.triggerResult,
		);
	});

	it('preserves original ackCommentId when dispatchPMAck returns undefined (no comment posted)', async () => {
		vi.mocked(extractTrelloContext).mockReturnValueOnce('Card: x');
		vi.mocked(dispatchPMAck).mockResolvedValueOnce(undefined);

		const jobData: TrelloJobData = {
			type: 'trello',
			source: 'trello',
			payload: {},
			projectId: 'proj-1',
			workItemId: 'card-1',
			actionType: 'updateCard',
			receivedAt: '2024-01-01T00:00:00Z',
			ackCommentId: 'fallback-comment',
			pendingAck: true,
			triggerResult: { agentType: 'implementation' } as never,
		};

		await dispatchJob('job-undef-ack', jobData, {} as never);

		expect(processTrelloWebhook).toHaveBeenCalledWith(
			jobData.payload,
			expect.anything(),
			'fallback-comment',
			jobData.triggerResult,
		);
	});

	it('linear pendingAck without workItemId: skips deferred ack entirely', async () => {
		const jobData: LinearJobData = {
			type: 'linear',
			source: 'linear',
			payload: {},
			projectId: 'proj-1',
			// workItemId is missing
			eventType: 'create/Comment',
			receivedAt: '2024-01-01T00:00:00Z',
			pendingAck: true,
			triggerResult: { agentType: 'implementation' } as never,
		};

		await dispatchJob('job-linear-no-id', jobData, {} as never);

		// Without workItemId, the deferred-ack branch is skipped
		expect(dispatchPMAck).not.toHaveBeenCalled();
		expect(processLinearWebhook).toHaveBeenCalled();
	});
});

// ── processDashboardJob tests ─────────────────────────────────────────────────

describe('processDashboardJob - manual-run', () => {
	it('loads project config via loadProjectConfigById and calls triggerManualRun with all params', async () => {
		const mockProject = { id: 'proj-1', name: 'Test Project' };
		const mockConfig = { projects: [mockProject] };

		vi.mocked(loadProjectConfigById).mockResolvedValue({
			project: mockProject as never,
			config: mockConfig as never,
		});

		const jobData: ManualRunJobData = {
			type: 'manual-run',
			projectId: 'proj-1',
			agentType: 'implementation',
			workItemId: 'card-1',
			workItemUrl: 'https://linear.app/org/issue/TEAM-123/example',
			workItemTitle: 'Implement example',
			prNumber: undefined,
			prBranch: undefined,
			repoFullName: undefined,
			headSha: undefined,
			modelOverride: 'claude-sonnet-4-5',
		};

		await processDashboardJob('job-manual-1', jobData);

		expect(loadProjectConfigById).toHaveBeenCalledWith('proj-1');
		expect(triggerManualRun).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: 'proj-1',
				agentType: 'implementation',
				workItemId: 'card-1',
				workItemUrl: 'https://linear.app/org/issue/TEAM-123/example',
				workItemTitle: 'Implement example',
				modelOverride: 'claude-sonnet-4-5',
			}),
			mockProject,
			mockConfig,
		);
	});

	it('throws when project not found (loadProjectConfigById returns undefined)', async () => {
		vi.mocked(loadProjectConfigById).mockResolvedValue(undefined);

		const jobData: ManualRunJobData = {
			type: 'manual-run',
			projectId: 'non-existent',
			agentType: 'implementation',
		};

		await expect(processDashboardJob('job-no-proj', jobData)).rejects.toThrow(
			'Project not found: non-existent',
		);

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

		const jobData: RetryRunJobData = {
			type: 'retry-run',
			runId: 'run-abc',
			projectId: 'proj-1',
			modelOverride: undefined,
		};

		await processDashboardJob('job-retry-1', jobData);

		expect(getRunById).toHaveBeenCalledWith('run-abc');
		expect(loadProjectConfigById).toHaveBeenCalledWith('proj-1');
		expect(triggerRetryRun).toHaveBeenCalledWith('run-abc', mockProject, mockConfig, undefined);
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

		const jobData: RetryRunJobData = {
			type: 'retry-run',
			runId: 'run-xyz',
			projectId: 'proj-1',
			modelOverride: 'claude-3-5-sonnet-20241022',
		};

		await processDashboardJob('job-retry-model', jobData);

		expect(triggerRetryRun).toHaveBeenCalledWith(
			'run-xyz',
			mockProject,
			mockConfig,
			'claude-3-5-sonnet-20241022',
		);
	});

	it('throws when run not found (getRunById returns null)', async () => {
		vi.mocked(getRunById).mockResolvedValue(null);

		const jobData: RetryRunJobData = {
			type: 'retry-run',
			runId: 'missing-run',
			projectId: 'proj-1',
		};

		await expect(processDashboardJob('job-no-run', jobData)).rejects.toThrow(
			'Run not found or has no project: missing-run',
		);

		expect(getRunById).toHaveBeenCalledWith('missing-run');
	});
});

describe('processDashboardJob - debug-analysis', () => {
	it('loads project config and calls triggerDebugAnalysis with runId, project, config, workItemId', async () => {
		const mockProject = { id: 'proj-1', name: 'Test Project' };
		const mockConfig = { projects: [mockProject] };

		vi.mocked(loadProjectConfigById).mockResolvedValue({
			project: mockProject as never,
			config: mockConfig as never,
		});

		const jobData: DebugAnalysisJobData = {
			type: 'debug-analysis',
			runId: 'run-xyz',
			projectId: 'proj-1',
			workItemId: 'card-debug',
		};

		await processDashboardJob('job-debug-1', jobData);

		expect(loadProjectConfigById).toHaveBeenCalledWith('proj-1');
		expect(triggerDebugAnalysis).toHaveBeenCalledWith(
			'run-xyz',
			mockProject,
			mockConfig,
			'card-debug',
		);
	});

	it('calls triggerDebugAnalysis with undefined workItemId when not provided', async () => {
		const mockProject = { id: 'proj-1', name: 'Test Project' };
		const mockConfig = { projects: [mockProject] };

		vi.mocked(loadProjectConfigById).mockResolvedValue({
			project: mockProject as never,
			config: mockConfig as never,
		});

		const jobData: DebugAnalysisJobData = {
			type: 'debug-analysis',
			runId: 'run-no-card',
			projectId: 'proj-1',
		};

		await processDashboardJob('job-debug-nocard', jobData);

		expect(triggerDebugAnalysis).toHaveBeenCalledWith(
			'run-no-card',
			mockProject,
			mockConfig,
			undefined,
		);
	});

	it('throws when project not found for debug-analysis', async () => {
		vi.mocked(loadProjectConfigById).mockResolvedValue(undefined);

		const jobData: DebugAnalysisJobData = {
			type: 'debug-analysis',
			runId: 'run-xyz',
			projectId: 'bad-proj',
		};

		await expect(processDashboardJob('job-debug-noproj', jobData)).rejects.toThrow(
			'Project not found: bad-proj',
		);
	});
});

// ── main() tests ──────────────────────────────────────────────────────────────

describe('main() - environment variable validation', () => {
	let exitSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		// Clear JOB_* env vars before each test — they may be inherited from the outer
		// process (e.g. when running inside a CASCADE worker container). Tests that need
		// specific values set them explicitly inside the test body; afterEach cleans up.
		delete process.env.JOB_ID;
		delete process.env.JOB_TYPE;
		delete process.env.JOB_DATA;
		exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?) => {
			throw new Error(`process.exit(${code ?? 0})`);
		});
	});

	afterEach(() => {
		exitSpy.mockRestore();
		delete process.env.JOB_ID;
		delete process.env.JOB_TYPE;
		delete process.env.JOB_DATA;
	});

	it('calls captureException with worker_env tag and exits 1 when all env vars are absent', async () => {
		await expect(main()).rejects.toThrow('process.exit(1)');

		expect(captureException).toHaveBeenCalledWith(
			expect.objectContaining({
				message: 'Missing required environment variables: JOB_ID, JOB_TYPE, JOB_DATA',
			}),
			expect.objectContaining({ tags: { source: 'worker_env' } }),
		);
		expect(flush).toHaveBeenCalled();
	});

	it('calls captureException with worker_env tag when only JOB_ID is missing', async () => {
		process.env.JOB_TYPE = 'trello';
		process.env.JOB_DATA = '{}';

		await expect(main()).rejects.toThrow('process.exit(1)');

		expect(captureException).toHaveBeenCalledWith(
			expect.objectContaining({ message: expect.stringContaining('Missing required') }),
			expect.objectContaining({ tags: { source: 'worker_env' } }),
		);
	});

	it('calls captureException with worker_job_parse tag and exits 1 when JOB_DATA is invalid JSON', async () => {
		process.env.JOB_ID = 'job-bad-json';
		process.env.JOB_TYPE = 'trello';
		process.env.JOB_DATA = 'not-valid-json{{{';

		await expect(main()).rejects.toThrow('process.exit(1)');

		expect(captureException).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ tags: { source: 'worker_job_parse' } }),
		);
		expect(flush).toHaveBeenCalled();
	});

	it('dispatches a trello job and calls flush then exits 0 on success', async () => {
		process.env.JOB_ID = 'job-trello-1';
		process.env.JOB_TYPE = 'trello';
		process.env.JOB_DATA = JSON.stringify({
			type: 'trello',
			source: 'trello',
			payload: { action: { type: 'updateCard' } },
			projectId: 'proj-1',
			workItemId: 'card-1',
			actionType: 'updateCard',
			receivedAt: '2024-01-01T00:00:00Z',
			ackCommentId: 'comment-123',
		});

		// process.exit(0) throws via our spy, but main() catches and re-throws as exit(1)
		// We only care that process.exit was called with 0 (before the catch block fires)
		await expect(main()).rejects.toThrow('process.exit(');

		expect(processTrelloWebhook).toHaveBeenCalledWith(
			{ action: { type: 'updateCard' } },
			expect.anything(),
			'comment-123',
			undefined,
		);
		// flush is called before exit(0)
		expect(flush).toHaveBeenCalled();
	});

	it('calls captureException with worker_job_failure tag and exits 1 when dispatchJob throws', async () => {
		vi.mocked(processGitHubWebhook).mockRejectedValue(new Error('Webhook processing failed'));

		process.env.JOB_ID = 'job-fail-1';
		process.env.JOB_TYPE = 'github';
		process.env.JOB_DATA = JSON.stringify({
			type: 'github',
			source: 'github',
			payload: {},
			eventType: 'push',
			repoFullName: 'org/repo',
			receivedAt: '2024-01-01T00:00:00Z',
		});

		await expect(main()).rejects.toThrow('process.exit(1)');

		expect(captureException).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'Webhook processing failed' }),
			expect.objectContaining({ tags: { source: 'worker_job_failure' } }),
		);
	});

	it('exits 2 when dispatchJob throws BootFailureError', async () => {
		vi.mocked(processGitHubWebhook).mockRejectedValue(
			new BootFailureError('plan resolution failed', {
				phase: 'plan-resolution',
				cause: new Error('ENOENT: alerting.eta'),
			}),
		);

		process.env.JOB_ID = 'job-boot-fail-1';
		process.env.JOB_TYPE = 'github';
		process.env.JOB_DATA = JSON.stringify({
			type: 'github',
			source: 'github',
			payload: {},
			eventType: 'push',
			repoFullName: 'org/repo',
			receivedAt: '2024-01-01T00:00:00Z',
		});

		await expect(main()).rejects.toThrow('process.exit(2)');
		expect(flush).toHaveBeenCalled();
	});
});
