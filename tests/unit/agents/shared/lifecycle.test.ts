import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock all external dependencies
vi.mock('../../../../src/agents/utils/agentLoop.js', () => ({
	runAgentLoop: vi.fn(),
}));

vi.mock('../../../../src/utils/fileLogger.js', () => ({
	createFileLogger: vi.fn(),
	cleanupLogFile: vi.fn(),
	cleanupLogDirectory: vi.fn(),
}));

vi.mock('../../../../src/agents/utils/logging.js', () => ({
	createAgentLogger: vi.fn(),
}));

vi.mock('../../../../src/utils/cascadeEnv.js', () => ({
	loadCascadeEnv: vi.fn(),
	unloadCascadeEnv: vi.fn(),
}));

vi.mock('../../../../src/utils/repo.js', () => ({
	cleanupTempDir: vi.fn(),
}));

vi.mock('../../../../src/utils/lifecycle.js', () => ({
	setWatchdogCleanup: vi.fn(),
	clearWatchdogCleanup: vi.fn(),
}));

vi.mock('../../../../src/db/repositories/runsRepository.js', () => ({
	createRun: vi.fn(),
	completeRun: vi.fn(),
	storeRunLogs: vi.fn(),
	storeLlmCallsBulk: vi.fn(),
}));

vi.mock('llmist', () => ({
	LLMist: vi.fn().mockImplementation(() => ({})),
	createLogger: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../../../src/agents/utils/tracking.js', () => ({
	createTrackingContext: vi.fn().mockReturnValue({}),
}));

import { executeAgentLifecycle } from '../../../../src/agents/shared/lifecycle.js';
import { runAgentLoop } from '../../../../src/agents/utils/agentLoop.js';
import { createAgentLogger } from '../../../../src/agents/utils/logging.js';
import {
	completeRun,
	createRun,
	storeLlmCallsBulk,
	storeRunLogs,
} from '../../../../src/db/repositories/runsRepository.js';
import { loadCascadeEnv, unloadCascadeEnv } from '../../../../src/utils/cascadeEnv.js';
import {
	cleanupLogDirectory,
	cleanupLogFile,
	createFileLogger,
} from '../../../../src/utils/fileLogger.js';
import { clearWatchdogCleanup } from '../../../../src/utils/lifecycle.js';
import { cleanupTempDir } from '../../../../src/utils/repo.js';

const mockRunAgentLoop = vi.mocked(runAgentLoop);
const mockCreateFileLogger = vi.mocked(createFileLogger);
const mockCreateAgentLogger = vi.mocked(createAgentLogger);
const mockLoadCascadeEnv = vi.mocked(loadCascadeEnv);
const mockUnloadCascadeEnv = vi.mocked(unloadCascadeEnv);
const mockCleanupTempDir = vi.mocked(cleanupTempDir);
const mockCleanupLogFile = vi.mocked(cleanupLogFile);
const mockCleanupLogDirectory = vi.mocked(cleanupLogDirectory);
const mockClearWatchdogCleanup = vi.mocked(clearWatchdogCleanup);
const mockCreateRun = vi.mocked(createRun);
const mockCompleteRun = vi.mocked(completeRun);
const mockStoreRunLogs = vi.mocked(storeRunLogs);
const mockStoreLlmCallsBulk = vi.mocked(storeLlmCallsBulk);

function setupMocks() {
	const mockLoggerInstance = {
		write: vi.fn(),
		close: vi.fn(),
		getZippedBuffer: vi.fn().mockResolvedValue(Buffer.from('logs')),
		logPath: '/tmp/test.log',
		llmistLogPath: '/tmp/test-llmist.log',
		llmCallLogger: {
			logDir: '/tmp/llm-calls',
			getLogFiles: vi.fn().mockReturnValue([]),
		},
	};
	mockCreateFileLogger.mockReturnValue(mockLoggerInstance as never);
	mockCreateAgentLogger.mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never);
	mockLoadCascadeEnv.mockReturnValue({});
	mockRunAgentLoop.mockResolvedValue({
		output: 'Task completed',
		iterations: 5,
		gadgetCalls: 10,
		cost: 0.5,
		loopTerminated: false,
	} as never);

	return mockLoggerInstance;
}

beforeEach(() => {
	vi.clearAllMocks();
	process.env.CASCADE_LOCAL_MODE = '';
});

describe('executeAgentLifecycle', () => {
	it('returns durationMs in successful result', async () => {
		setupMocks();

		const result = await executeAgentLifecycle({
			loggerIdentifier: 'test-run',
			onWatchdogTimeout: vi.fn(),
			setupRepoDir: vi.fn().mockResolvedValue(process.cwd()),
			buildContext: vi.fn().mockResolvedValue({
				model: 'test-model',
				maxIterations: 50,
				prompt: 'Do something',
			}),
			createBuilder: vi.fn().mockReturnValue({
				ask: vi.fn().mockReturnValue({}),
			} as never),
			injectSyntheticCalls: vi.fn().mockImplementation(({ builder }) => Promise.resolve(builder)),
		});

		expect(result.success).toBe(true);
		expect(result.durationMs).toBeDefined();
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(typeof result.durationMs).toBe('number');
	});

	it('returns durationMs in error result', async () => {
		setupMocks();

		const result = await executeAgentLifecycle({
			loggerIdentifier: 'test-run',
			onWatchdogTimeout: vi.fn(),
			setupRepoDir: vi.fn().mockRejectedValue(new Error('Setup failed')),
			buildContext: vi.fn().mockResolvedValue({
				model: 'test-model',
				maxIterations: 50,
				prompt: 'Do something',
			}),
			createBuilder: vi.fn().mockReturnValue({
				ask: vi.fn().mockReturnValue({}),
			} as never),
			injectSyntheticCalls: vi.fn().mockImplementation(({ builder }) => Promise.resolve(builder)),
		});

		expect(result.success).toBe(false);
		expect(result.durationMs).toBeDefined();
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(typeof result.durationMs).toBe('number');
	});

	it('returns durationMs when loop is terminated', async () => {
		const loggerInstance = setupMocks();
		mockRunAgentLoop.mockResolvedValue({
			output: 'Loop detected',
			iterations: 50,
			gadgetCalls: 100,
			cost: 2.0,
			loopTerminated: true,
		} as never);

		const result = await executeAgentLifecycle({
			loggerIdentifier: 'test-run',
			onWatchdogTimeout: vi.fn(),
			setupRepoDir: vi.fn().mockResolvedValue(process.cwd()),
			buildContext: vi.fn().mockResolvedValue({
				model: 'test-model',
				maxIterations: 50,
				prompt: 'Do something',
			}),
			createBuilder: vi.fn().mockReturnValue({
				ask: vi.fn().mockReturnValue({}),
			} as never),
			injectSyntheticCalls: vi.fn().mockImplementation(({ builder }) => Promise.resolve(builder)),
		});

		expect(result.success).toBe(false);
		expect(result.error).toBe('Agent terminated due to persistent loop');
		expect(result.durationMs).toBeDefined();
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(typeof result.durationMs).toBe('number');
	});

	it('passes durationMs to completeRun on success', async () => {
		setupMocks();
		mockCreateRun.mockResolvedValue('run123');

		await executeAgentLifecycle({
			loggerIdentifier: 'test-run',
			onWatchdogTimeout: vi.fn(),
			setupRepoDir: vi.fn().mockResolvedValue(process.cwd()),
			buildContext: vi.fn().mockResolvedValue({
				model: 'test-model',
				maxIterations: 50,
				prompt: 'Do something',
			}),
			createBuilder: vi.fn().mockReturnValue({
				ask: vi.fn().mockReturnValue({}),
			} as never),
			injectSyntheticCalls: vi.fn().mockImplementation(({ builder }) => Promise.resolve(builder)),
			runTracking: {
				projectId: 'test-project',
				agentType: 'implementation',
				backendName: 'llmist',
			},
		});

		expect(mockCompleteRun).toHaveBeenCalledWith(
			'run123',
			expect.objectContaining({
				status: 'completed',
				durationMs: expect.any(Number),
			}),
		);
	});

	it('passes durationMs to completeRun on agent loop error', async () => {
		const loggerInstance = setupMocks();
		mockCreateRun.mockResolvedValue('run123');
		mockRunAgentLoop.mockRejectedValue(new Error('Agent crashed'));

		await executeAgentLifecycle({
			loggerIdentifier: 'test-run',
			onWatchdogTimeout: vi.fn(),
			setupRepoDir: vi.fn().mockResolvedValue(process.cwd()),
			buildContext: vi.fn().mockResolvedValue({
				model: 'test-model',
				maxIterations: 50,
				prompt: 'Do something',
			}),
			createBuilder: vi.fn().mockReturnValue({
				ask: vi.fn().mockReturnValue({}),
			} as never),
			injectSyntheticCalls: vi.fn().mockImplementation(({ builder }) => Promise.resolve(builder)),
			runTracking: {
				projectId: 'test-project',
				agentType: 'implementation',
				backendName: 'llmist',
			},
		});

		expect(mockCompleteRun).toHaveBeenCalledWith(
			'run123',
			expect.objectContaining({
				status: 'failed',
				durationMs: expect.any(Number),
				success: false,
			}),
		);
	});
});
