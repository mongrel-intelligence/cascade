import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockCleanupTempDir = vi.fn();
const mockCleanupLogFile = vi.fn();
const mockCleanupLogDirectory = vi.fn();
const mockClearWatchdogCleanup = vi.fn();

vi.mock('../../../src/utils/repo.js', () => ({
	cleanupTempDir: (...args: unknown[]) => mockCleanupTempDir(...args),
}));

vi.mock('../../../src/utils/fileLogger.js', () => ({
	cleanupLogFile: (...args: unknown[]) => mockCleanupLogFile(...args),
	cleanupLogDirectory: (...args: unknown[]) => mockCleanupLogDirectory(...args),
}));

vi.mock('../../../src/utils/lifecycle.js', () => ({
	clearWatchdogCleanup: () => mockClearWatchdogCleanup(),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { cleanupAgentResources } from '../../../src/agents/shared/cleanup.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeFileLogger() {
	return {
		logPath: '/tmp/cascade-test.log',
		engineLogPath: '/tmp/cascade-test-engine.log',
		llmCallLogger: { logDir: '/tmp/cascade-test-llm' },
	} as never;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cleanupAgentResources', () => {
	beforeEach(() => {
		mockCleanupTempDir.mockClear();
		mockCleanupLogFile.mockClear();
		mockCleanupLogDirectory.mockClear();
		mockClearWatchdogCleanup.mockClear();
		process.env.CASCADE_LOCAL_MODE = undefined;
		process.env.CASCADE_SNAPSHOT_ENABLED = undefined;
	});

	afterEach(() => {
		process.env.CASCADE_LOCAL_MODE = undefined;
		process.env.CASCADE_SNAPSHOT_ENABLED = undefined;
	});

	it('deletes workspace and log files on a normal run', () => {
		cleanupAgentResources('/workspace/cascade-proj-123', makeFakeFileLogger());
		expect(mockCleanupTempDir).toHaveBeenCalledWith('/workspace/cascade-proj-123');
		expect(mockCleanupLogFile).toHaveBeenCalledTimes(2);
		expect(mockCleanupLogDirectory).toHaveBeenCalledTimes(1);
	});

	it('skips workspace deletion when CASCADE_SNAPSHOT_ENABLED=true', () => {
		process.env.CASCADE_SNAPSHOT_ENABLED = 'true';
		cleanupAgentResources('/workspace/cascade-proj-123', makeFakeFileLogger());
		expect(mockCleanupTempDir).not.toHaveBeenCalled();
	});

	it('still cleans up log files when CASCADE_SNAPSHOT_ENABLED=true', () => {
		process.env.CASCADE_SNAPSHOT_ENABLED = 'true';
		cleanupAgentResources('/workspace/cascade-proj-123', makeFakeFileLogger());
		expect(mockCleanupLogFile).toHaveBeenCalledTimes(2);
		expect(mockCleanupLogDirectory).toHaveBeenCalledTimes(1);
	});

	it('skips workspace deletion when skipRepoDeletion=true', () => {
		cleanupAgentResources('/workspace/cascade-proj-123', makeFakeFileLogger(), true);
		expect(mockCleanupTempDir).not.toHaveBeenCalled();
	});

	it('skips workspace deletion when CASCADE_LOCAL_MODE=true', () => {
		process.env.CASCADE_LOCAL_MODE = 'true';
		cleanupAgentResources('/workspace/cascade-proj-123', makeFakeFileLogger());
		expect(mockCleanupTempDir).not.toHaveBeenCalled();
		// Log files are also skipped in local mode
		expect(mockCleanupLogFile).not.toHaveBeenCalled();
	});

	it('does nothing when repoDir is null', () => {
		cleanupAgentResources(null, makeFakeFileLogger());
		expect(mockCleanupTempDir).not.toHaveBeenCalled();
		// Log files are still cleaned up
		expect(mockCleanupLogFile).toHaveBeenCalledTimes(2);
	});

	it('always calls clearWatchdogCleanup', () => {
		cleanupAgentResources(null, makeFakeFileLogger());
		expect(mockClearWatchdogCleanup).toHaveBeenCalledOnce();
	});

	it('logs a warning when cleanupTempDir throws', () => {
		mockCleanupTempDir.mockImplementation(() => {
			throw new Error('permission denied');
		});
		// Should not throw
		expect(() =>
			cleanupAgentResources('/workspace/cascade-proj-123', makeFakeFileLogger()),
		).not.toThrow();
	});
});
