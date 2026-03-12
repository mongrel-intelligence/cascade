import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock all external dependencies
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

vi.mock('../../../../src/utils/squintDb.js', () => ({
	setupRemoteSquintDb: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

const mockCaptureException = vi.fn();
vi.mock('../../../../src/sentry.js', () => ({
	captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

vi.mock('../../../../src/db/repositories/runsRepository.js', () => ({
	createRun: vi.fn(),
	completeRun: vi.fn(),
	storeRunLogs: vi.fn(),
}));

import {
	createLogWriter,
	executeAgentPipeline,
} from '../../../../src/agents/shared/executionPipeline.js';
import { createAgentLogger } from '../../../../src/agents/utils/logging.js';
import { loadCascadeEnv, unloadCascadeEnv } from '../../../../src/utils/cascadeEnv.js';
import {
	cleanupLogDirectory,
	cleanupLogFile,
	createFileLogger,
} from '../../../../src/utils/fileLogger.js';
import { clearWatchdogCleanup, setWatchdogCleanup } from '../../../../src/utils/lifecycle.js';
import { logger } from '../../../../src/utils/logging.js';
import { cleanupTempDir } from '../../../../src/utils/repo.js';
import { setupRemoteSquintDb } from '../../../../src/utils/squintDb.js';

const mockCreateFileLogger = vi.mocked(createFileLogger);
const mockCreateAgentLogger = vi.mocked(createAgentLogger);
const mockLoadCascadeEnv = vi.mocked(loadCascadeEnv);
const mockUnloadCascadeEnv = vi.mocked(unloadCascadeEnv);
const mockCleanupTempDir = vi.mocked(cleanupTempDir);
const mockCleanupLogFile = vi.mocked(cleanupLogFile);
const mockCleanupLogDirectory = vi.mocked(cleanupLogDirectory);
const mockClearWatchdogCleanup = vi.mocked(clearWatchdogCleanup);
const mockSetWatchdogCleanup = vi.mocked(setWatchdogCleanup);
const mockSetupRemoteSquintDb = vi.mocked(setupRemoteSquintDb);

function setupMocks() {
	const mockLoggerInstance = {
		write: vi.fn(),
		close: vi.fn(),
		getZippedBuffer: vi.fn().mockResolvedValue(Buffer.from('logs')),
		logPath: '/tmp/test.log',
		engineLogPath: '/tmp/test-engine.log',
		llmCallLogger: { logDir: '/tmp/llm-calls' },
	};
	mockCreateFileLogger.mockReturnValue(mockLoggerInstance as never);
	mockCreateAgentLogger.mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never);
	mockLoadCascadeEnv.mockReturnValue({});
	mockSetupRemoteSquintDb.mockResolvedValue(null);
	return mockLoggerInstance;
}

beforeEach(() => {
	process.env.CASCADE_LOCAL_MODE = '';
});

describe('executeAgentPipeline', () => {
	it('returns successful result from execute callback', async () => {
		setupMocks();

		const result = await executeAgentPipeline({
			loggerIdentifier: 'test-run',
			setupRepoDir: vi.fn().mockResolvedValue(process.cwd()),
			finalizeRun: vi.fn(),
			execute: async () => ({ success: true, output: 'Done', cost: 0.5 }),
		});

		expect(result.success).toBe(true);
		expect(result.output).toBe('Done');
		expect(result.cost).toBe(0.5);
	});

	it('returns error result when execute callback throws', async () => {
		setupMocks();

		const result = await executeAgentPipeline({
			loggerIdentifier: 'test-run',
			setupRepoDir: vi.fn().mockResolvedValue(process.cwd()),
			finalizeRun: vi.fn(),
			execute: async () => {
				throw new Error('Execute failed');
			},
		});

		expect(result.success).toBe(false);
		expect(result.error).toContain('Execute failed');
	});

	it('returns error result when setupRepoDir throws', async () => {
		setupMocks();

		const result = await executeAgentPipeline({
			loggerIdentifier: 'test-run',
			setupRepoDir: vi.fn().mockRejectedValue(new Error('Repo setup failed')),
			finalizeRun: vi.fn(),
			execute: async () => ({ success: true, output: 'Done' }),
		});

		expect(result.success).toBe(false);
		expect(result.error).toContain('Repo setup failed');
	});

	it('loads and unloads cascade env around execution', async () => {
		setupMocks();

		await executeAgentPipeline({
			loggerIdentifier: 'test-run',
			setupRepoDir: vi.fn().mockResolvedValue(process.cwd()),
			finalizeRun: vi.fn(),
			execute: async () => ({ success: true, output: 'Done' }),
		});

		expect(mockLoadCascadeEnv).toHaveBeenCalled();
		expect(mockUnloadCascadeEnv).toHaveBeenCalled();
	});

	it('restores CWD even when execute throws', async () => {
		setupMocks();
		const originalCwd = process.cwd();

		await executeAgentPipeline({
			loggerIdentifier: 'test-run',
			setupRepoDir: vi.fn().mockResolvedValue(process.cwd()),
			finalizeRun: vi.fn(),
			execute: async () => {
				throw new Error('Failed mid-execution');
			},
		});

		expect(process.cwd()).toBe(originalCwd);
	});

	it('calls setWatchdogCleanup with a cleanup function', async () => {
		setupMocks();

		await executeAgentPipeline({
			loggerIdentifier: 'test-run',
			setupRepoDir: vi.fn().mockResolvedValue(process.cwd()),
			finalizeRun: vi.fn(),
			execute: async () => ({ success: true, output: 'Done' }),
		});

		expect(mockSetWatchdogCleanup).toHaveBeenCalledWith(expect.any(Function));
	});

	it('cleans up resources in finally block', async () => {
		setupMocks();

		await executeAgentPipeline({
			loggerIdentifier: 'test-run',
			setupRepoDir: vi.fn().mockResolvedValue(process.cwd()),
			finalizeRun: vi.fn(),
			execute: async () => ({ success: true, output: 'Done' }),
		});

		expect(mockClearWatchdogCleanup).toHaveBeenCalled();
		expect(mockCleanupTempDir).toHaveBeenCalled();
		expect(mockCleanupLogFile).toHaveBeenCalled();
		expect(mockCleanupLogDirectory).toHaveBeenCalled();
	});

	it('skips temp dir cleanup when skipRepoDeletion is true', async () => {
		setupMocks();

		await executeAgentPipeline({
			loggerIdentifier: 'test-run',
			setupRepoDir: vi.fn().mockResolvedValue(process.cwd()),
			finalizeRun: vi.fn(),
			skipRepoDeletion: true,
			execute: async () => ({ success: true, output: 'Done' }),
		});

		expect(mockCleanupTempDir).not.toHaveBeenCalled();
		expect(mockCleanupLogFile).toHaveBeenCalled();
	});

	it('skips cleanup in CASCADE_LOCAL_MODE', async () => {
		process.env.CASCADE_LOCAL_MODE = 'true';
		setupMocks();

		await executeAgentPipeline({
			loggerIdentifier: 'test-run',
			setupRepoDir: vi.fn().mockResolvedValue(process.cwd()),
			finalizeRun: vi.fn(),
			execute: async () => ({ success: true, output: 'Done' }),
		});

		expect(mockCleanupTempDir).not.toHaveBeenCalled();
		expect(mockCleanupLogFile).not.toHaveBeenCalled();
		expect(mockCleanupLogDirectory).not.toHaveBeenCalled();
	});

	it('calls finalizeRun with completed status on success', async () => {
		setupMocks();
		const mockFinalizeRun = vi.fn();

		await executeAgentPipeline({
			loggerIdentifier: 'test-run',
			setupRepoDir: vi.fn().mockResolvedValue(process.cwd()),
			finalizeRun: mockFinalizeRun,
			execute: async () => ({ success: true, output: 'Done', cost: 1.0 }),
		});

		expect(mockFinalizeRun).toHaveBeenCalledWith(
			undefined,
			expect.anything(),
			expect.objectContaining({
				status: 'completed',
				success: true,
				durationMs: expect.any(Number),
				costUsd: 1.0,
			}),
		);
	});

	it('calls finalizeRun with failed status when execute returns failure', async () => {
		setupMocks();
		const mockFinalizeRun = vi.fn();

		await executeAgentPipeline({
			loggerIdentifier: 'test-run',
			setupRepoDir: vi.fn().mockResolvedValue(process.cwd()),
			finalizeRun: mockFinalizeRun,
			execute: async () => ({ success: false, output: '', error: 'Agent failed' }),
		});

		expect(mockFinalizeRun).toHaveBeenCalledWith(
			undefined,
			expect.anything(),
			expect.objectContaining({
				status: 'failed',
				success: false,
				error: 'Agent failed',
			}),
		);
	});

	it('calls finalizeRun with failed status when execute throws', async () => {
		setupMocks();
		const mockFinalizeRun = vi.fn();

		await executeAgentPipeline({
			loggerIdentifier: 'test-run',
			setupRepoDir: vi.fn().mockResolvedValue(process.cwd()),
			finalizeRun: mockFinalizeRun,
			execute: async () => {
				throw new Error('Unexpected crash');
			},
		});

		expect(mockFinalizeRun).toHaveBeenCalledWith(
			undefined,
			expect.anything(),
			expect.objectContaining({
				status: 'failed',
				success: false,
				error: expect.stringContaining('Unexpected crash'),
			}),
		);
	});

	it('reports errors to Sentry when execute throws', async () => {
		setupMocks();
		const error = new Error('Test error');

		await executeAgentPipeline({
			loggerIdentifier: 'test-agent',
			setupRepoDir: vi.fn().mockResolvedValue(process.cwd()),
			finalizeRun: vi.fn(),
			execute: async () => {
				throw error;
			},
		});

		expect(mockCaptureException).toHaveBeenCalledWith(error, {
			tags: {
				source: 'agent_execution',
				agent: 'test-agent',
			},
			extra: {
				runId: undefined,
				durationMs: expect.any(Number),
			},
		});
	});

	it('returns durationMs in successful result', async () => {
		setupMocks();

		const result = await executeAgentPipeline({
			loggerIdentifier: 'test-run',
			setupRepoDir: vi.fn().mockResolvedValue(process.cwd()),
			finalizeRun: vi.fn(),
			execute: async () => ({ success: true, output: 'Done' }),
		});

		expect(result.durationMs).toBeDefined();
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(typeof result.durationMs).toBe('number');
	});

	it('returns durationMs in error result', async () => {
		setupMocks();

		const result = await executeAgentPipeline({
			loggerIdentifier: 'test-run',
			setupRepoDir: vi.fn().mockResolvedValue(process.cwd()),
			finalizeRun: vi.fn(),
			execute: async () => {
				throw new Error('Failed');
			},
		});

		expect(result.durationMs).toBeDefined();
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(typeof result.durationMs).toBe('number');
	});

	it('provides logBuffer from fileLogger.getZippedBuffer', async () => {
		const mockLogger = setupMocks();
		mockLogger.getZippedBuffer.mockResolvedValue(Buffer.from('log-data'));

		const result = await executeAgentPipeline({
			loggerIdentifier: 'test-run',
			setupRepoDir: vi.fn().mockResolvedValue(process.cwd()),
			finalizeRun: vi.fn(),
			execute: async () => ({ success: true, output: 'Done' }),
		});

		expect(result.logBuffer).toEqual(Buffer.from('log-data'));
	});

	it('uses logBuffer from execute result if provided', async () => {
		setupMocks();
		const customBuffer = Buffer.from('custom-log');

		const result = await executeAgentPipeline({
			loggerIdentifier: 'test-run',
			setupRepoDir: vi.fn().mockResolvedValue(process.cwd()),
			finalizeRun: vi.fn(),
			execute: async () => ({ success: true, output: 'Done', logBuffer: customBuffer }),
		});

		expect(result.logBuffer).toEqual(customBuffer);
	});

	it('passes runId to finalizeRun when setRunId is called in execute', async () => {
		setupMocks();
		const mockFinalizeRun = vi.fn();

		await executeAgentPipeline({
			loggerIdentifier: 'test-run',
			setupRepoDir: vi.fn().mockResolvedValue(process.cwd()),
			finalizeRun: mockFinalizeRun,
			execute: async (ctx) => {
				ctx.setRunId('my-run-id');
				return { success: true, output: 'Done' };
			},
		});

		expect(mockFinalizeRun).toHaveBeenCalledWith(
			'my-run-id',
			expect.anything(),
			expect.any(Object),
		);
	});

	it('returns runId in result when setRunId is called in execute', async () => {
		setupMocks();

		const result = await executeAgentPipeline({
			loggerIdentifier: 'test-run',
			setupRepoDir: vi.fn().mockResolvedValue(process.cwd()),
			finalizeRun: vi.fn(),
			execute: async (ctx) => {
				ctx.setRunId('test-run-id');
				return { success: true, output: 'Done' };
			},
		});

		expect(result.runId).toBe('test-run-id');
	});

	it('calls onWatchdogTimeout when watchdog fires', async () => {
		setupMocks();
		const mockOnWatchdog = vi.fn();

		// Capture the watchdog cleanup function
		let watchdogCleanup: (() => Promise<void>) | undefined;
		mockSetWatchdogCleanup.mockImplementation((fn) => {
			watchdogCleanup = fn;
		});

		// Start the pipeline but don't wait for it — we'll fire the watchdog manually
		const pipelinePromise = executeAgentPipeline({
			loggerIdentifier: 'test-run',
			setupRepoDir: vi.fn().mockResolvedValue(process.cwd()),
			finalizeRun: vi.fn(),
			onWatchdogTimeout: mockOnWatchdog,
			execute: vi.fn().mockResolvedValue({ success: true, output: 'Done' }),
		});

		await pipelinePromise;

		// Manually invoke the captured watchdog cleanup
		expect(watchdogCleanup).toBeDefined();
		await watchdogCleanup?.();

		expect(mockOnWatchdog).toHaveBeenCalled();
	});

	it('passes finalizeMetadata to finalizeRun', async () => {
		setupMocks();
		const mockFinalizeRun = vi.fn();

		await executeAgentPipeline({
			loggerIdentifier: 'test-run',
			setupRepoDir: vi.fn().mockResolvedValue(process.cwd()),
			finalizeRun: mockFinalizeRun,
			execute: async () => ({
				success: true,
				output: 'Done',
				finalizeMetadata: { llmIterations: 10, gadgetCalls: 25 },
			}),
		});

		expect(mockFinalizeRun).toHaveBeenCalledWith(
			undefined,
			expect.anything(),
			expect.objectContaining({
				metadata: { llmIterations: 10, gadgetCalls: 25 },
			}),
		);
	});
});

describe('createLogWriter', () => {
	it('writes to file logger and structured logger', () => {
		const mockFileLogger = {
			write: vi.fn(),
			close: vi.fn(),
			getZippedBuffer: vi.fn(),
			logPath: '/tmp/test.log',
			llmistLogPath: '/tmp/test-llmist.log',
			llmCallLogger: { logDir: '/tmp/llm-calls' },
		};

		const logWriter = createLogWriter(mockFileLogger as never);
		logWriter('INFO', 'Test message', { key: 'value' });

		expect(mockFileLogger.write).toHaveBeenCalledWith('INFO', 'Test message', { key: 'value' });
		expect(logger.info).toHaveBeenCalledWith('Test message', { key: 'value' });
	});

	it('routes ERROR level to logger.error', () => {
		const mockFileLogger = { write: vi.fn() };
		const logWriter = createLogWriter(mockFileLogger as never);

		logWriter('ERROR', 'Error message');

		expect(logger.error).toHaveBeenCalledWith('Error message', undefined);
	});

	it('routes WARN level to logger.warn', () => {
		const mockFileLogger = { write: vi.fn() };
		const logWriter = createLogWriter(mockFileLogger as never);

		logWriter('WARN', 'Warning message');

		expect(logger.warn).toHaveBeenCalledWith('Warning message', undefined);
	});

	it('routes DEBUG level to logger.debug', () => {
		const mockFileLogger = { write: vi.fn() };
		const logWriter = createLogWriter(mockFileLogger as never);

		logWriter('DEBUG', 'Debug message');

		expect(logger.debug).toHaveBeenCalledWith('Debug message', undefined);
	});

	it('writes to fileLogger with all three parameters', () => {
		const mockFileLogger = {
			write: vi.fn(),
			close: vi.fn(),
			getZippedBuffer: vi.fn(),
			logPath: '/tmp/test.log',
			engineLogPath: '/tmp/test-engine.log',
			llmCallLogger: { logDir: '/tmp/llm-calls' },
		};

		const logWriter = createLogWriter(mockFileLogger as never);
		logWriter('INFO', 'Test message', { key: 'value' });

		expect(mockFileLogger.write).toHaveBeenCalledWith('INFO', 'Test message', { key: 'value' });
	});
});
