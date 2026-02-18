import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({
	default: {
		openSync: vi.fn(),
		writeSync: vi.fn(),
		closeSync: vi.fn(),
		unlinkSync: vi.fn(),
		rmSync: vi.fn(),
		existsSync: vi.fn(),
	},
}));

vi.mock('../../../src/utils/repo.js', () => ({
	getWorkspaceDir: vi.fn(() => '/workspace'),
}));

vi.mock('../../../src/utils/llmLogging.js', () => ({
	createLLMCallLogger: vi.fn(() => ({
		logDir: '/workspace/llm-calls',
		logRequest: vi.fn(),
		logResponse: vi.fn(),
		getLogFiles: vi.fn(() => []),
	})),
}));

import fs from 'node:fs';
import {
	cleanupLogDirectory,
	cleanupLogFile,
	createFileLogger,
} from '../../../src/utils/fileLogger.js';

const mockFs = vi.mocked(fs);

beforeEach(() => {
	vi.clearAllMocks();
	mockFs.openSync.mockReturnValue(5); // fake fd
	mockFs.existsSync.mockReturnValue(false);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('createFileLogger', () => {
	it('opens a log file on creation', () => {
		createFileLogger('test-prefix');

		expect(mockFs.openSync).toHaveBeenCalledWith(
			expect.stringContaining('test-prefix-cascade-'),
			'a',
		);
	});

	it('exposes logPath and llmistLogPath', () => {
		const logger = createFileLogger('myprefix');

		expect(logger.logPath).toContain('myprefix-cascade-');
		expect(logger.llmistLogPath).toContain('myprefix-llmist-');
	});

	describe('write', () => {
		it('writes a formatted log line with context', () => {
			const logger = createFileLogger('prefix');

			logger.write('INFO', 'Test message', { key: 'value' });

			expect(mockFs.writeSync).toHaveBeenCalledWith(
				5,
				expect.stringMatching(/\[.*\] \[INFO\] Test message \{"key":"value"\}\n/),
			);
		});

		it('writes a log line without context', () => {
			const logger = createFileLogger('prefix');

			logger.write('ERROR', 'Something went wrong');

			expect(mockFs.writeSync).toHaveBeenCalledWith(
				5,
				expect.stringMatching(/\[.*\] \[ERROR\] Something went wrong\n/),
			);
		});

		it('does nothing when fd is null (after close)', () => {
			const logger = createFileLogger('prefix');
			logger.close();

			logger.write('INFO', 'After close');

			// writeSync should only have been called 0 times after close (any calls before were pre-close)
			const writeCalls = mockFs.writeSync.mock.calls.length;
			expect(writeCalls).toBe(0);
		});
	});

	describe('close', () => {
		it('closes the file descriptor', () => {
			const logger = createFileLogger('prefix');
			logger.close();

			expect(mockFs.closeSync).toHaveBeenCalledWith(5);
		});

		it('does not close again if already closed', () => {
			const logger = createFileLogger('prefix');
			logger.close();
			logger.close();

			expect(mockFs.closeSync).toHaveBeenCalledTimes(1);
		});
	});
});

describe('cleanupLogFile', () => {
	it('deletes the log file', () => {
		cleanupLogFile('/workspace/test.log');

		expect(mockFs.unlinkSync).toHaveBeenCalledWith('/workspace/test.log');
	});

	it('silently ignores errors', () => {
		mockFs.unlinkSync.mockImplementation(() => {
			throw new Error('ENOENT');
		});

		expect(() => cleanupLogFile('/workspace/nonexistent.log')).not.toThrow();
	});
});

describe('cleanupLogDirectory', () => {
	it('removes the directory recursively', () => {
		cleanupLogDirectory('/workspace/session-dir');

		expect(mockFs.rmSync).toHaveBeenCalledWith('/workspace/session-dir', {
			recursive: true,
			force: true,
		});
	});

	it('silently ignores errors', () => {
		mockFs.rmSync.mockImplementation(() => {
			throw new Error('EPERM');
		});

		expect(() => cleanupLogDirectory('/workspace/session-dir')).not.toThrow();
	});
});
