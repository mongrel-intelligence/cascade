import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock all external dependencies
vi.mock('../../../src/agents/shared/repository.js', () => ({
	setupRepository: vi.fn(),
}));

vi.mock('../../../src/agents/shared/modelResolution.js', () => ({
	resolveModelConfig: vi.fn(),
}));

vi.mock('../../../src/utils/fileLogger.js', () => ({
	createFileLogger: vi.fn(),
	cleanupLogFile: vi.fn(),
	cleanupLogDirectory: vi.fn(),
}));

vi.mock('../../../src/agents/utils/logging.js', () => ({
	createAgentLogger: vi.fn(),
}));

vi.mock('../../../src/utils/cascadeEnv.js', () => ({
	loadCascadeEnv: vi.fn(),
	unloadCascadeEnv: vi.fn(),
}));

vi.mock('../../../src/utils/repo.js', () => ({
	cleanupTempDir: vi.fn(),
	getWorkspaceDir: vi.fn(() => '/tmp/cascade-test'),
	parseRepoFullName: vi.fn((fullName: string) => {
		const [owner, repo] = fullName.split('/');
		return { owner, repo };
	}),
}));

vi.mock('../../../src/utils/lifecycle.js', () => ({
	setWatchdogCleanup: vi.fn(),
	clearWatchdogCleanup: vi.fn(),
}));

vi.mock('../../../src/backends/progress.js', () => ({
	createProgressMonitor: vi.fn(),
}));

vi.mock('../../../src/gadgets/sessionState.js', () => ({
	REVIEW_SIDECAR_FILENAME: '.cascade/review-result.json',
	recordInitialComment: vi.fn(),
	recordReviewSubmission: vi.fn(),
	clearInitialComment: vi.fn(),
}));

vi.mock('../../../src/config/customModels.js', () => ({
	CUSTOM_MODELS: [],
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock('../../../src/config/provider.js', () => ({
	getAllProjectCredentials: vi.fn(),
}));

vi.mock('../../../src/github/client.js', () => ({
	withGitHubToken: vi.fn((_token: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('../../../src/agents/definitions/profiles.js', () => ({
	getAgentProfile: vi.fn(),
	hasFinishValidation: vi.fn(() => false),
	getAgentCapabilities: vi.fn(),
}));

const mockCaptureException = vi.fn();
vi.mock('../../../src/sentry.js', () => ({
	captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

vi.mock('../../../src/agents/prompts/index.js', () => ({}));

vi.mock('../../../src/agents/shared/promptContext.js', () => ({
	buildPromptContext: vi.fn().mockImplementation(
		(
			workItemId: string | undefined,
			project: { id: string },
			triggerType?: string,
			prContext?: {
				prNumber?: number;
				prBranch?: string;
				repoFullName?: string;
				headSha?: string;
			},
		) => ({
			workItemId,
			projectId: project.id,
			pmType: 'trello',
			...(prContext && {
				prNumber: prContext.prNumber,
				prBranch: prContext.prBranch,
				repoFullName: prContext.repoFullName,
				headSha: prContext.headSha,
				triggerType,
			}),
		}),
	),
}));

const mockCreateRun = vi.fn();
const mockCompleteRun = vi.fn();
const mockStoreRunLogs = vi.fn();
vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	createRun: (...args: unknown[]) => mockCreateRun(...args),
	completeRun: (...args: unknown[]) => mockCompleteRun(...args),
	storeRunLogs: (...args: unknown[]) => mockStoreRunLogs(...args),
}));

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { type AgentProfile, getAgentProfile } from '../../../src/agents/definitions/profiles.js';
import { resolveModelConfig } from '../../../src/agents/shared/modelResolution.js';
import { setupRepository } from '../../../src/agents/shared/repository.js';
import { createAgentLogger } from '../../../src/agents/utils/logging.js';
import { executeWithBackend } from '../../../src/backends/adapter.js';
import { createProgressMonitor } from '../../../src/backends/progress.js';
import type { AgentBackend } from '../../../src/backends/types.js';
import { getAllProjectCredentials } from '../../../src/config/provider.js';
import {
	clearInitialComment,
	recordInitialComment,
	recordReviewSubmission,
} from '../../../src/gadgets/sessionState.js';
import type { AgentInput, CascadeConfig, ProjectConfig } from '../../../src/types/index.js';
import { loadCascadeEnv, unloadCascadeEnv } from '../../../src/utils/cascadeEnv.js';
import {
	cleanupLogDirectory,
	cleanupLogFile,
	createFileLogger,
} from '../../../src/utils/fileLogger.js';
import { clearWatchdogCleanup, setWatchdogCleanup } from '../../../src/utils/lifecycle.js';
import { logger } from '../../../src/utils/logging.js';
import { cleanupTempDir } from '../../../src/utils/repo.js';

const mockSetupRepository = vi.mocked(setupRepository);
const mockResolveModelConfig = vi.mocked(resolveModelConfig);
const mockCreateFileLogger = vi.mocked(createFileLogger);
const mockCreateAgentLogger = vi.mocked(createAgentLogger);
const mockLoadCascadeEnv = vi.mocked(loadCascadeEnv);
const mockUnloadCascadeEnv = vi.mocked(unloadCascadeEnv);
const mockCleanupTempDir = vi.mocked(cleanupTempDir);
const mockCleanupLogFile = vi.mocked(cleanupLogFile);
const mockCleanupLogDirectory = vi.mocked(cleanupLogDirectory);
const mockClearWatchdogCleanup = vi.mocked(clearWatchdogCleanup);
const mockCreateProgressMonitor = vi.mocked(createProgressMonitor);
const mockRecordInitialComment = vi.mocked(recordInitialComment);
const mockRecordReviewSubmission = vi.mocked(recordReviewSubmission);
const mockClearInitialComment = vi.mocked(clearInitialComment);
const mockGetAllProjectCredentials = vi.mocked(getAllProjectCredentials);
const mockGetAgentProfile = vi.mocked(getAgentProfile);

function makeProject(): ProjectConfig {
	return {
		id: 'test',
		name: 'Test',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		trello: { boardId: 'b1', lists: {}, labels: {} },
	};
}

function makeConfig(): CascadeConfig {
	return {
		defaults: {
			model: 'test-model',
			agentModels: {},
			maxIterations: 50,
			agentIterations: {},
			watchdogTimeoutMs: 1800000,
			cardBudgetUsd: 5,
			agentBackend: 'llmist',
			progressModel: 'openrouter:google/gemini-2.5-flash-lite',
			progressIntervalMinutes: 5,
		},
		projects: [],
	};
}

function makeInput(
	overrides?: Partial<AgentInput>,
): AgentInput & { project: ProjectConfig; config: CascadeConfig } {
	return {
		workItemId: 'card123',
		project: makeProject(),
		config: makeConfig(),
		...overrides,
	} as AgentInput & { project: ProjectConfig; config: CascadeConfig };
}

function makeMockBackend(): AgentBackend {
	return {
		name: 'test-backend',
		execute: vi.fn().mockResolvedValue({
			success: true,
			output: 'Done',
			prUrl: 'https://github.com/o/r/pull/1',
		}),
		supportsAgentType: () => true,
	};
}

function makeMockProfile(overrides?: Partial<AgentProfile>): AgentProfile {
	return {
		filterTools: (tools) => tools,
		sdkTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
		needsGitHubToken: false,
		finishHooks: {},
		fetchContext: vi.fn().mockResolvedValue([]),
		buildTaskPrompt: () => 'Process the work item',
		capabilities: {
			canEditFiles: true,
			canCreatePR: true,
			canUpdateChecklists: true,
			isReadOnly: false,
		},
		...overrides,
	};
}

function setupMocks() {
	const mockLoggerInstance = {
		write: vi.fn(),
		close: vi.fn(),
		getZippedBuffer: vi.fn().mockResolvedValue(Buffer.from('logs')),
		logPath: '/tmp/test.log',
		llmistLogPath: '/tmp/test-llmist.log',
		llmCallLogger: { logDir: '/tmp/llm-calls' },
	};
	mockCreateFileLogger.mockReturnValue(mockLoggerInstance as never);
	mockCreateAgentLogger.mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never);
	// Use actual cwd so process.chdir() doesn't fail on non-existent dir
	mockSetupRepository.mockResolvedValue(process.cwd());
	mockLoadCascadeEnv.mockReturnValue({});
	mockResolveModelConfig.mockResolvedValue({
		systemPrompt: 'You are an agent',
		model: 'test-model',
		maxIterations: 50,
		contextFiles: [],
	} as never);
	mockCreateProgressMonitor.mockReturnValue(null);
	mockGetAllProjectCredentials.mockResolvedValue({});
	mockGetAgentProfile.mockReturnValue(makeMockProfile());
	return mockLoggerInstance;
}

beforeEach(() => {
	process.env.CASCADE_LOCAL_MODE = '';
	// Default runs repository mocks
	mockCreateRun.mockResolvedValue('run-uuid-123');
	mockCompleteRun.mockResolvedValue(undefined);
	mockStoreRunLogs.mockResolvedValue(undefined);
});

describe('executeWithBackend', () => {
	it('executes backend and returns successful result', async () => {
		setupMocks();
		const backend = makeMockBackend();
		const input = makeInput();

		const result = await executeWithBackend(backend, 'implementation', input);

		expect(result.success).toBe(true);
		expect(result.output).toBe('Done');
		expect(result.prUrl).toBe('https://github.com/o/r/pull/1');
		expect(backend.execute).toHaveBeenCalled();
	});

	it('loads and unloads CASCADE env', async () => {
		setupMocks();
		const backend = makeMockBackend();
		const input = makeInput();

		await executeWithBackend(backend, 'implementation', input);

		expect(mockLoadCascadeEnv).toHaveBeenCalled();
		expect(mockUnloadCascadeEnv).toHaveBeenCalled();
	});

	it('returns error result when backend throws', async () => {
		setupMocks();
		const backend = makeMockBackend();
		vi.mocked(backend.execute).mockRejectedValue(new Error('Backend crashed'));
		const input = makeInput();

		const result = await executeWithBackend(backend, 'implementation', input);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Backend crashed');
	});

	it('reports backend errors to Sentry via captureException', async () => {
		setupMocks();
		const backend = makeMockBackend();
		const error = new Error('HttpError: Not Found');
		vi.mocked(backend.execute).mockRejectedValue(error);
		const input = makeInput();

		await executeWithBackend(backend, 'review', input);

		expect(mockCaptureException).toHaveBeenCalledWith(error, {
			tags: {
				source: 'agent_execution',
				agent: expect.stringContaining('review'),
			},
			extra: {
				runId: 'run-uuid-123',
				durationMs: expect.any(Number),
			},
		});
	});

	it('includes log buffer in result', async () => {
		const loggerInstance = setupMocks();
		const backend = makeMockBackend();
		vi.mocked(backend.execute).mockResolvedValue({
			success: true,
			output: 'Done',
		});
		const input = makeInput();

		const result = await executeWithBackend(backend, 'implementation', input);

		expect(result.logBuffer).toEqual(Buffer.from('logs'));
	});

	it('calls resolveRepoDir → setupRepository when no logDir', async () => {
		setupMocks();
		const backend = makeMockBackend();
		const input = makeInput();

		await executeWithBackend(backend, 'implementation', input);

		expect(mockSetupRepository).toHaveBeenCalled();
	});

	it('uses logDir when provided instead of setupRepository', async () => {
		setupMocks();
		const backend = makeMockBackend();
		const input = makeInput({ logDir: '/existing/dir' });

		await executeWithBackend(backend, 'implementation', input);

		expect(mockSetupRepository).not.toHaveBeenCalled();
	});

	it('cleans up resources in finally block', async () => {
		setupMocks();
		const backend = makeMockBackend();
		const input = makeInput();

		await executeWithBackend(backend, 'implementation', input);

		expect(mockClearWatchdogCleanup).toHaveBeenCalled();
		expect(mockCleanupTempDir).toHaveBeenCalled();
		expect(mockCleanupLogFile).toHaveBeenCalled();
		expect(mockCleanupLogDirectory).toHaveBeenCalled();
	});

	it('skips all cleanup in CASCADE_LOCAL_MODE', async () => {
		process.env.CASCADE_LOCAL_MODE = 'true';
		setupMocks();
		const backend = makeMockBackend();
		const input = makeInput();

		await executeWithBackend(backend, 'implementation', input);

		expect(mockCleanupTempDir).not.toHaveBeenCalled();
		expect(mockCleanupLogFile).not.toHaveBeenCalled();
		expect(mockCleanupLogDirectory).not.toHaveBeenCalled();
	});

	it('skips temp dir cleanup when logDir was provided', async () => {
		setupMocks();
		const backend = makeMockBackend();
		const input = makeInput({ logDir: '/existing/dir' });

		await executeWithBackend(backend, 'implementation', input);

		expect(mockCleanupTempDir).not.toHaveBeenCalled();
		// But log files should still be cleaned up
		expect(mockCleanupLogFile).toHaveBeenCalled();
	});

	it('calls profile.fetchContext for context injection', async () => {
		setupMocks();
		const mockFetchContext = vi.fn().mockResolvedValue([]);
		mockGetAgentProfile.mockReturnValue(makeMockProfile({ fetchContext: mockFetchContext }));
		const backend = makeMockBackend();
		const input = makeInput({ workItemId: 'card123' });

		await executeWithBackend(backend, 'implementation', input);

		expect(mockFetchContext).toHaveBeenCalledWith(
			expect.objectContaining({
				input: expect.objectContaining({ workItemId: 'card123' }),
				contextFiles: [],
			}),
		);
	});

	it('uses profile to filter tools and set sdkTools', async () => {
		setupMocks();
		const filterTools = vi.fn((tools) =>
			tools.filter((t: { name: string }) => t.name === 'Finish'),
		);
		mockGetAgentProfile.mockReturnValue(
			makeMockProfile({
				filterTools,
				sdkTools: ['Read', 'Bash', 'Glob', 'Grep'],
				finishHooks: {},
			}),
		);
		const backend = makeMockBackend();
		const input = makeInput();

		await executeWithBackend(backend, 'implementation', input);

		expect(filterTools).toHaveBeenCalled();
		const backendInput = vi.mocked(backend.execute).mock.calls[0][0];
		expect(backendInput.availableTools).toHaveLength(1);
		expect(backendInput.availableTools[0].name).toBe('Finish');
		expect(backendInput.sdkTools).toEqual(['Read', 'Bash', 'Glob', 'Grep']);
		expect(backendInput.enableStopHooks).toBe(false);
	});

	it('marks implementation agent as failed when no PR was created', async () => {
		setupMocks();
		mockGetAgentProfile.mockReturnValue(makeMockProfile({ finishHooks: { requiresPR: true } }));
		const backend = makeMockBackend();
		vi.mocked(backend.execute).mockResolvedValue({
			success: true,
			output: 'Done',
			// No prUrl
		});
		const input = makeInput();

		const result = await executeWithBackend(backend, 'implementation', input);

		expect(result.success).toBe(false);
		expect(result.error).toBe('Agent completed but no PR was created');
		expect(logger.warn).toHaveBeenCalledWith(
			'implementation agent completed without creating a PR',
			expect.objectContaining({ backend: 'test-backend' }),
		);
	});

	it('does not validate PR creation for non-implementation agents', async () => {
		setupMocks();
		const backend = makeMockBackend();
		vi.mocked(backend.execute).mockResolvedValue({
			success: true,
			output: 'Done',
			// No prUrl
		});
		const input = makeInput();

		const result = await executeWithBackend(backend, 'splitting', input);

		expect(result.success).toBe(true);
	});

	it('passes through when implementation agent creates a PR', async () => {
		setupMocks();
		const backend = makeMockBackend();
		vi.mocked(backend.execute).mockResolvedValue({
			success: true,
			output: 'Done',
			prUrl: 'https://github.com/o/r/pull/5',
		});
		const input = makeInput();

		const result = await executeWithBackend(backend, 'implementation', input);

		expect(result.success).toBe(true);
		expect(result.prUrl).toBe('https://github.com/o/r/pull/5');
	});

	it('does not validate PR creation when implementation agent already failed', async () => {
		setupMocks();
		const backend = makeMockBackend();
		vi.mocked(backend.execute).mockResolvedValue({
			success: false,
			output: '',
			error: 'Budget exceeded',
		});
		const input = makeInput();

		const result = await executeWithBackend(backend, 'implementation', input);

		expect(result.success).toBe(false);
		expect(result.error).toBe('Budget exceeded');
	});

	it('zeroes cost when subscriptionCostZero is true and backend is claude-code', async () => {
		setupMocks();
		const backend = makeMockBackend();
		backend.name = 'claude-code';
		vi.mocked(backend.execute).mockResolvedValue({
			success: true,
			output: 'Done',
			cost: 1.5,
		});
		const input = makeInput();
		input.project.agentBackend = {
			default: 'claude-code',
			overrides: {},
			subscriptionCostZero: true,
		};

		const result = await executeWithBackend(backend, 'implementation', input);

		expect(result.cost).toBe(0);
		expect(logger.info).toHaveBeenCalledWith(
			'Zeroing Claude Code cost (subscription mode)',
			expect.objectContaining({ originalCost: 1.5 }),
		);
	});

	it('preserves cost when subscriptionCostZero is false', async () => {
		setupMocks();
		const backend = makeMockBackend();
		backend.name = 'claude-code';
		vi.mocked(backend.execute).mockResolvedValue({
			success: true,
			output: 'Done',
			cost: 2.0,
		});
		const input = makeInput();
		input.project.agentBackend = {
			default: 'claude-code',
			overrides: {},
			subscriptionCostZero: false,
		};

		const result = await executeWithBackend(backend, 'implementation', input);

		expect(result.cost).toBe(2.0);
	});

	it('preserves cost for non-claude-code backends even with subscriptionCostZero', async () => {
		setupMocks();
		const backend = makeMockBackend();
		backend.name = 'llmist';
		vi.mocked(backend.execute).mockResolvedValue({
			success: true,
			output: 'Done',
			cost: 3.0,
		});
		const input = makeInput();
		input.project.agentBackend = {
			default: 'llmist',
			overrides: {},
			subscriptionCostZero: true,
		};

		const result = await executeWithBackend(backend, 'implementation', input);

		expect(result.cost).toBe(3.0);
	});

	it('preserves cost when agentBackend config is undefined', async () => {
		setupMocks();
		const backend = makeMockBackend();
		backend.name = 'claude-code';
		vi.mocked(backend.execute).mockResolvedValue({
			success: true,
			output: 'Done',
			cost: 1.0,
		});
		const input = makeInput();
		// agentBackend is not set (default from makeProject)

		const result = await executeWithBackend(backend, 'implementation', input);

		expect(result.cost).toBe(1.0);
	});

	it('resolves per-project secrets and passes them to backend', async () => {
		setupMocks();
		mockGetAllProjectCredentials.mockResolvedValue({
			GITHUB_TOKEN: 'proj-gh-token',
			TRELLO_API_KEY: 'proj-trello-key',
		});

		const backend = makeMockBackend();
		const input = makeInput();

		await executeWithBackend(backend, 'implementation', input);

		expect(mockGetAllProjectCredentials).toHaveBeenCalledWith('test');

		const backendInput = vi.mocked(backend.execute).mock.calls[0][0];
		expect(backendInput.projectSecrets).toEqual({
			GITHUB_TOKEN: 'proj-gh-token',
			TRELLO_API_KEY: 'proj-trello-key',
			CASCADE_BASE_BRANCH: 'main',
			CASCADE_REPO_OWNER: 'owner',
			CASCADE_REPO_NAME: 'repo',
			CASCADE_AGENT_TYPE: 'implementation',
			CASCADE_PM_TYPE: 'trello',
		});
	});

	it('passes PR context fields to promptContext for respond-to-ci agent', async () => {
		setupMocks();
		const backend = makeMockBackend();
		const input = makeInput({
			prNumber: 42,
			prBranch: 'fix/ci-errors',
			repoFullName: 'acme/widgets',
			headSha: 'abc123',
			triggerType: 'check-failure',
		});

		await executeWithBackend(backend, 'respond-to-ci', input);

		const resolveCall = mockResolveModelConfig.mock.calls[0][0] as {
			promptContext: Record<string, unknown>;
		};
		expect(resolveCall.promptContext).toMatchObject({
			prNumber: 42,
			prBranch: 'fix/ci-errors',
			repoFullName: 'acme/widgets',
			headSha: 'abc123',
			triggerType: 'check-failure',
		});
	});

	it('includes CASCADE_BASE_BRANCH even when no other per-project secrets exist', async () => {
		setupMocks();
		mockGetAllProjectCredentials.mockResolvedValue({});

		const backend = makeMockBackend();
		const input = makeInput();

		await executeWithBackend(backend, 'implementation', input);

		const backendInput = vi.mocked(backend.execute).mock.calls[0][0];
		expect(backendInput.projectSecrets).toEqual({
			CASCADE_BASE_BRANCH: 'main',
			CASCADE_REPO_OWNER: 'owner',
			CASCADE_REPO_NAME: 'repo',
			CASCADE_AGENT_TYPE: 'implementation',
			CASCADE_PM_TYPE: 'trello',
		});
	});

	it('returns durationMs in successful result', async () => {
		setupMocks();
		const backend = makeMockBackend();
		const input = makeInput();

		const result = await executeWithBackend(backend, 'implementation', input);

		expect(result.success).toBe(true);
		expect(result.durationMs).toBeDefined();
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(typeof result.durationMs).toBe('number');
	});

	it('returns durationMs in error result', async () => {
		setupMocks();
		const backend = makeMockBackend();
		vi.mocked(backend.execute).mockRejectedValue(new Error('Backend crashed'));
		const input = makeInput();

		const result = await executeWithBackend(backend, 'implementation', input);

		expect(result.success).toBe(false);
		expect(result.durationMs).toBeDefined();
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(typeof result.durationMs).toBe('number');
	});

	it('forwards runId to backendInput after tryCreateBackendRun resolves', async () => {
		setupMocks();
		mockCreateRun.mockResolvedValue('test-run-id');
		const backend = makeMockBackend();
		const input = makeInput();

		await executeWithBackend(backend, 'implementation', input);

		const backendInput = vi.mocked(backend.execute).mock.calls[0][0];
		expect(backendInput.runId).toBe('test-run-id');
	});

	it('forwards undefined runId to backendInput when createRun fails', async () => {
		setupMocks();
		mockCreateRun.mockRejectedValue(new Error('DB unavailable'));
		const backend = makeMockBackend();
		const input = makeInput();

		await executeWithBackend(backend, 'implementation', input);

		const backendInput = vi.mocked(backend.execute).mock.calls[0][0];
		expect(backendInput.runId).toBeUndefined();
	});

	it('returns durationMs when backend returns error', async () => {
		setupMocks();
		const backend = makeMockBackend();
		vi.mocked(backend.execute).mockResolvedValue({
			success: false,
			output: '',
			error: 'Budget exceeded',
		});
		const input = makeInput();

		const result = await executeWithBackend(backend, 'implementation', input);

		expect(result.success).toBe(false);
		expect(result.error).toBe('Budget exceeded');
		expect(result.durationMs).toBeDefined();
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(typeof result.durationMs).toBe('number');
	});

	describe('GitHub ack comment routing', () => {
		it('calls recordInitialComment and passes github config when ack is a GitHub PR comment', async () => {
			setupMocks();
			const backend = makeMockBackend();
			const input = makeInput({
				prNumber: 42,
				repoFullName: 'acme/widgets',
				ackCommentId: 12345,
				ackMessage: 'Reviewing code...',
			});

			await executeWithBackend(backend, 'review', input);

			expect(mockRecordInitialComment).toHaveBeenCalledWith(12345);
			expect(mockCreateProgressMonitor).toHaveBeenCalledWith(
				expect.objectContaining({
					preSeededCommentId: undefined,
					github: {
						owner: 'acme',
						repo: 'widgets',
					},
				}),
			);
		});

		it('does not call recordInitialComment for PM (string) ack comment IDs', async () => {
			setupMocks();
			const backend = makeMockBackend();
			const input = makeInput({
				ackCommentId: 'trello-comment-abc',
			});

			await executeWithBackend(backend, 'implementation', input);

			expect(mockRecordInitialComment).not.toHaveBeenCalled();
			expect(mockCreateProgressMonitor).toHaveBeenCalledWith(
				expect.objectContaining({
					preSeededCommentId: 'trello-comment-abc',
				}),
			);
		});

		it('passes preSeededCommentId for PM ack even when PR context is absent', async () => {
			setupMocks();
			const backend = makeMockBackend();
			const input = makeInput({
				ackCommentId: 'pm-comment-id',
			});

			await executeWithBackend(backend, 'implementation', input);

			expect(mockCreateProgressMonitor).toHaveBeenCalledWith(
				expect.objectContaining({
					preSeededCommentId: 'pm-comment-id',
				}),
			);
			// No github config when no PR context
			const callArgs = mockCreateProgressMonitor.mock.calls[0][0];
			expect(callArgs).not.toHaveProperty('github');
		});

		it('does not pass preSeededCommentId when ack is a GitHub comment (numeric)', async () => {
			setupMocks();
			const backend = makeMockBackend();
			const input = makeInput({
				prNumber: 10,
				repoFullName: 'org/repo',
				ackCommentId: 999,
			});

			await executeWithBackend(backend, 'review', input);

			expect(mockCreateProgressMonitor).toHaveBeenCalledWith(
				expect.objectContaining({
					preSeededCommentId: undefined,
				}),
			);
		});

		it('passes github config when ackMessage is undefined', async () => {
			setupMocks();
			const backend = makeMockBackend();
			const input = makeInput({
				prNumber: 7,
				repoFullName: 'org/repo',
				ackCommentId: 555,
			});

			await executeWithBackend(backend, 'review', input);

			expect(mockCreateProgressMonitor).toHaveBeenCalledWith(
				expect.objectContaining({
					github: {
						owner: 'org',
						repo: 'repo',
					},
				}),
			);
		});

		it('does not call recordInitialComment when ackCommentId is absent', async () => {
			setupMocks();
			const backend = makeMockBackend();
			const input = makeInput({
				prNumber: 42,
				repoFullName: 'acme/widgets',
				// no ackCommentId
			});

			await executeWithBackend(backend, 'review', input);

			expect(mockRecordInitialComment).not.toHaveBeenCalled();
		});

		it('injects CASCADE_GITHUB_ACK_COMMENT_ID into secrets when ack is a GitHub PR comment', async () => {
			setupMocks();
			const backend = makeMockBackend();
			const input = makeInput({
				prNumber: 42,
				repoFullName: 'acme/widgets',
				ackCommentId: 98765,
			});

			await executeWithBackend(backend, 'review', input);

			const backendInput = vi.mocked(backend.execute).mock.calls[0][0];
			expect(backendInput.projectSecrets?.CASCADE_GITHUB_ACK_COMMENT_ID).toBe('98765');
		});

		it('does not inject CASCADE_GITHUB_ACK_COMMENT_ID for PM (string) ack comment IDs', async () => {
			setupMocks();
			const backend = makeMockBackend();
			const input = makeInput({
				ackCommentId: 'pm-comment-abc',
			});

			await executeWithBackend(backend, 'implementation', input);

			const backendInput = vi.mocked(backend.execute).mock.calls[0][0];
			expect(backendInput.projectSecrets?.CASCADE_GITHUB_ACK_COMMENT_ID).toBeUndefined();
		});
	});

	describe('review sidecar hydration', () => {
		function writeSidecar(data: Record<string, unknown>): void {
			const dir = join(process.cwd(), '.cascade');
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, 'review-result.json'), JSON.stringify(data));
		}

		// Only remove the sidecar file, not the .cascade/ directory — setupMocks sets
		// repoDir to process.cwd() (the actual repo root) which has a real .cascade/ dir.
		function cleanupSidecar(): void {
			try {
				rmSync(join(process.cwd(), '.cascade', 'review-result.json'), { force: true });
			} catch {
				// ignore
			}
		}

		afterEach(() => {
			cleanupSidecar();
		});

		it('calls recordReviewSubmission when sidecar exists for review agent', async () => {
			setupMocks();
			const backend = makeMockBackend();
			vi.mocked(backend.execute).mockImplementation(async () => {
				writeSidecar({
					reviewUrl: 'https://github.com/o/r/pull/1#pullrequestreview-99',
					event: 'REQUEST_CHANGES',
					body: 'Please fix the null check',
				});
				return { success: true, output: 'Done' };
			});
			const input = makeInput();

			await executeWithBackend(backend, 'review', input);

			expect(mockRecordReviewSubmission).toHaveBeenCalledWith(
				'https://github.com/o/r/pull/1#pullrequestreview-99',
				'Please fix the null check',
				'REQUEST_CHANGES',
			);
		});

		it('does not error when sidecar file is absent (llmist backend)', async () => {
			setupMocks();
			const backend = makeMockBackend();
			const input = makeInput();

			const result = await executeWithBackend(backend, 'review', input);

			expect(result.success).toBe(true);
			expect(mockRecordReviewSubmission).not.toHaveBeenCalled();
		});

		it('does not error when sidecar file is malformed JSON', async () => {
			setupMocks();
			const backend = makeMockBackend();
			vi.mocked(backend.execute).mockImplementation(async () => {
				const dir = join(process.cwd(), '.cascade');
				mkdirSync(dir, { recursive: true });
				writeFileSync(join(dir, 'review-result.json'), 'not valid json');
				return { success: true, output: 'Done' };
			});
			const input = makeInput();

			const result = await executeWithBackend(backend, 'review', input);

			expect(result.success).toBe(true);
			expect(mockRecordReviewSubmission).not.toHaveBeenCalled();
		});

		it('does not read sidecar for non-review agent types', async () => {
			setupMocks();
			const backend = makeMockBackend();
			vi.mocked(backend.execute).mockImplementation(async () => {
				writeSidecar({
					reviewUrl: 'https://github.com/o/r/pull/1#pullrequestreview-99',
					event: 'APPROVE',
					body: 'LGTM',
				});
				return { success: true, output: 'Done' };
			});
			const input = makeInput();

			await executeWithBackend(backend, 'implementation', input);

			expect(mockRecordReviewSubmission).not.toHaveBeenCalled();
		});

		it('skips hydration when sidecar body is missing', async () => {
			setupMocks();
			const backend = makeMockBackend();
			vi.mocked(backend.execute).mockImplementation(async () => {
				writeSidecar({
					reviewUrl: 'https://github.com/o/r/pull/1#pullrequestreview-99',
					event: 'APPROVE',
					// no body
				});
				return { success: true, output: 'Done' };
			});
			const input = makeInput();

			await executeWithBackend(backend, 'review', input);

			expect(mockRecordReviewSubmission).not.toHaveBeenCalled();
		});

		it('clears initialCommentId when sidecar has ackCommentDeleted: true', async () => {
			setupMocks();
			const backend = makeMockBackend();
			vi.mocked(backend.execute).mockImplementation(async () => {
				writeSidecar({
					reviewUrl: 'https://github.com/o/r/pull/1#pullrequestreview-42',
					event: 'REQUEST_CHANGES',
					body: 'Please fix this',
					ackCommentDeleted: true,
				});
				return { success: true, output: 'Done' };
			});
			const input = makeInput();

			await executeWithBackend(backend, 'review', input);

			expect(mockClearInitialComment).toHaveBeenCalled();
		});

		it('does not clear initialCommentId when sidecar has ackCommentDeleted absent', async () => {
			setupMocks();
			const backend = makeMockBackend();
			vi.mocked(backend.execute).mockImplementation(async () => {
				writeSidecar({
					reviewUrl: 'https://github.com/o/r/pull/1#pullrequestreview-42',
					event: 'APPROVE',
					body: 'LGTM',
					// no ackCommentDeleted
				});
				return { success: true, output: 'Done' };
			});
			const input = makeInput();

			await executeWithBackend(backend, 'review', input);

			expect(mockClearInitialComment).not.toHaveBeenCalled();
		});

		it('backward compatible — no clearInitialComment when sidecar is absent', async () => {
			setupMocks();
			const backend = makeMockBackend();
			// No sidecar written
			const input = makeInput();

			await executeWithBackend(backend, 'review', input);

			expect(mockClearInitialComment).not.toHaveBeenCalled();
		});
	});
});
