import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/utils/lifecycle.js', () => ({
	clearWatchdogCleanup: vi.fn(),
	setWatchdogCleanup: vi.fn(),
}));

vi.mock('../../../../src/utils/repo.js', () => ({
	cleanupTempDir: vi.fn(),
}));

vi.mock('../../../../src/utils/fileLogger.js', () => ({
	cleanupLogFile: vi.fn(),
	cleanupLogDirectory: vi.fn(),
	createFileLogger: vi.fn(),
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: {
		warn: vi.fn(),
		info: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

import { cleanupAgentResources } from '../../../../src/agents/shared/cleanup.js';
import { cleanupLogDirectory, cleanupLogFile } from '../../../../src/utils/fileLogger.js';
import { clearWatchdogCleanup } from '../../../../src/utils/lifecycle.js';
import { logger } from '../../../../src/utils/logging.js';
import { cleanupTempDir } from '../../../../src/utils/repo.js';

const mockClearWatchdogCleanup = vi.mocked(clearWatchdogCleanup);
const mockCleanupTempDir = vi.mocked(cleanupTempDir);
const mockCleanupLogFile = vi.mocked(cleanupLogFile);
const mockCleanupLogDirectory = vi.mocked(cleanupLogDirectory);

function makeFileLogger() {
	return {
		logPath: '/tmp/cascade.log',
		engineLogPath: '/tmp/llmist.log',
		llmCallLogger: { logDir: '/tmp/llm-calls' },
	} as unknown as Parameters<typeof cleanupAgentResources>[1];
}

describe('cleanupAgentResources', () => {
	const originalEnv = process.env.CASCADE_LOCAL_MODE;

	beforeEach(() => {
		process.env.CASCADE_LOCAL_MODE = undefined;
	});

	afterEach(() => {
		process.env.CASCADE_LOCAL_MODE = originalEnv;
	});

	it('clears the watchdog cleanup in all cases', () => {
		const fileLogger = makeFileLogger();
		cleanupAgentResources(null, fileLogger);
		expect(mockClearWatchdogCleanup).toHaveBeenCalled();
	});

	it('removes the temp directory when repoDir is set and not local mode', () => {
		const fileLogger = makeFileLogger();
		cleanupAgentResources('/tmp/repo-123', fileLogger);
		expect(mockCleanupTempDir).toHaveBeenCalledWith('/tmp/repo-123');
	});

	it('does not remove temp directory when repoDir is null', () => {
		const fileLogger = makeFileLogger();
		cleanupAgentResources(null, fileLogger);
		expect(mockCleanupTempDir).not.toHaveBeenCalled();
	});

	it('skips repo deletion when skipRepoDeletion is true', () => {
		const fileLogger = makeFileLogger();
		cleanupAgentResources('/tmp/repo-123', fileLogger, true);
		expect(mockCleanupTempDir).not.toHaveBeenCalled();
	});

	it('skips all file deletions in local mode', () => {
		process.env.CASCADE_LOCAL_MODE = 'true';
		const fileLogger = makeFileLogger();
		cleanupAgentResources('/tmp/repo-123', fileLogger);
		expect(mockCleanupTempDir).not.toHaveBeenCalled();
		expect(mockCleanupLogFile).not.toHaveBeenCalled();
		expect(mockCleanupLogDirectory).not.toHaveBeenCalled();
	});

	it('cleans up log files in non-local mode', () => {
		const fileLogger = makeFileLogger();
		cleanupAgentResources(null, fileLogger);
		expect(mockCleanupLogFile).toHaveBeenCalledWith('/tmp/cascade.log');
		expect(mockCleanupLogFile).toHaveBeenCalledWith('/tmp/llmist.log');
		expect(mockCleanupLogDirectory).toHaveBeenCalledWith('/tmp/llm-calls');
	});

	it('logs a warning but does not throw when temp dir cleanup fails', () => {
		mockCleanupTempDir.mockImplementation(() => {
			throw new Error('permission denied');
		});
		const fileLogger = makeFileLogger();

		expect(() => cleanupAgentResources('/tmp/repo-123', fileLogger)).not.toThrow();
		expect(logger.warn).toHaveBeenCalledWith(
			'Failed to cleanup temp directory',
			expect.objectContaining({ error: 'Error: permission denied' }),
		);
	});
});
