import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/db/repositories/runsRepository.js', () => ({
	createRun: vi.fn(),
	completeRun: vi.fn(),
	storeRunLogs: vi.fn(),
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: {
		warn: vi.fn(),
		info: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

// Mock fs to control log file existence
vi.mock('node:fs', () => ({
	default: {
		existsSync: vi.fn().mockReturnValue(false),
		readFileSync: vi.fn().mockReturnValue(''),
	},
}));

import fs from 'node:fs';
import {
	type RunTrackingInput,
	finalizeBackendRun,
	tryCompleteRun,
	tryCreateRun,
	tryStoreRunLogs,
} from '../../../../src/agents/shared/runTracking.js';
import {
	completeRun,
	createRun,
	storeRunLogs,
} from '../../../../src/db/repositories/runsRepository.js';
import { logger } from '../../../../src/utils/logging.js';

const mockCreateRun = vi.mocked(createRun);
const mockCompleteRun = vi.mocked(completeRun);
const mockStoreRunLogs = vi.mocked(storeRunLogs);
const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);

function makeFileLogger() {
	return {
		logPath: '/tmp/test.log',
		llmistLogPath: '/tmp/test-llmist.log',
		llmCallLogger: { logDir: '/tmp/llm-calls' },
		write: vi.fn(),
		close: vi.fn(),
		getZippedBuffer: vi.fn().mockResolvedValue(Buffer.from('')),
	} as unknown as Parameters<typeof tryStoreRunLogs>[1];
}

const baseInput: RunTrackingInput = {
	projectId: 'proj-1',
	cardId: 'card-123',
	agentType: 'implementation',
	backendName: 'claude-code',
};

describe('tryCreateRun', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('creates a run and returns the run ID', async () => {
		mockCreateRun.mockResolvedValue('run-abc');

		const runId = await tryCreateRun(baseInput, 'claude-3-5-sonnet-20241022', 25);
		expect(runId).toBe('run-abc');
		expect(mockCreateRun).toHaveBeenCalledWith({
			projectId: 'proj-1',
			cardId: 'card-123',
			prNumber: undefined,
			agentType: 'implementation',
			backend: 'claude-code',
			triggerType: undefined,
			model: 'claude-3-5-sonnet-20241022',
			maxIterations: 25,
		});
	});

	it('returns undefined and logs a warning when createRun throws', async () => {
		mockCreateRun.mockRejectedValue(new Error('DB error'));

		const runId = await tryCreateRun(baseInput);
		expect(runId).toBeUndefined();
		expect(logger.warn).toHaveBeenCalledWith(
			'Failed to create run record',
			expect.objectContaining({ error: 'Error: DB error' }),
		);
	});
});

describe('tryCompleteRun', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('calls completeRun with the given input', async () => {
		mockCompleteRun.mockResolvedValue(undefined);

		await tryCompleteRun('run-xyz', { status: 'completed', success: true });
		expect(mockCompleteRun).toHaveBeenCalledWith('run-xyz', { status: 'completed', success: true });
	});

	it('swallows errors and logs a warning', async () => {
		mockCompleteRun.mockRejectedValue(new Error('network error'));

		await expect(
			tryCompleteRun('run-xyz', { status: 'completed', success: true }),
		).resolves.not.toThrow();
		expect(logger.warn).toHaveBeenCalledWith(
			'Failed to complete run record',
			expect.objectContaining({ error: 'Error: network error' }),
		);
	});
});

describe('tryStoreRunLogs', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExistsSync.mockReturnValue(false);
	});

	it('calls storeRunLogs with undefined logs when files do not exist', async () => {
		mockStoreRunLogs.mockResolvedValue(undefined);
		const fileLogger = makeFileLogger();

		await tryStoreRunLogs('run-1', fileLogger);
		expect(mockStoreRunLogs).toHaveBeenCalledWith('run-1', undefined, undefined);
	});

	it('reads log file content when files exist', async () => {
		mockExistsSync.mockImplementation((p) => String(p).endsWith('.log'));
		mockReadFileSync.mockReturnValue('log content');
		mockStoreRunLogs.mockResolvedValue(undefined);
		const fileLogger = makeFileLogger();

		await tryStoreRunLogs('run-1', fileLogger);
		expect(mockStoreRunLogs).toHaveBeenCalledWith('run-1', 'log content', 'log content');
	});

	it('swallows errors and logs a warning', async () => {
		mockStoreRunLogs.mockRejectedValue(new Error('write error'));
		const fileLogger = makeFileLogger();

		await expect(tryStoreRunLogs('run-1', fileLogger)).resolves.not.toThrow();
		expect(logger.warn).toHaveBeenCalledWith(
			'Failed to store run logs',
			expect.objectContaining({ error: 'Error: write error' }),
		);
	});
});

describe('finalizeBackendRun', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExistsSync.mockReturnValue(false);
	});

	it('does nothing when runId is undefined', async () => {
		const fileLogger = makeFileLogger();
		await finalizeBackendRun(undefined, fileLogger, { status: 'completed', success: true });
		expect(mockStoreRunLogs).not.toHaveBeenCalled();
		expect(mockCompleteRun).not.toHaveBeenCalled();
	});

	it('stores logs and completes the run when runId is provided', async () => {
		mockStoreRunLogs.mockResolvedValue(undefined);
		mockCompleteRun.mockResolvedValue(undefined);
		const fileLogger = makeFileLogger();

		await finalizeBackendRun('run-abc', fileLogger, { status: 'failed', success: false });
		expect(mockStoreRunLogs).toHaveBeenCalledWith('run-abc', undefined, undefined);
		expect(mockCompleteRun).toHaveBeenCalledWith('run-abc', { status: 'failed', success: false });
	});
});
