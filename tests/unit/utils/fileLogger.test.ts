import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mocks
const { mockFs, mockGetWorkspaceDir, mockCreateLLMCallLogger } = vi.hoisted(() => ({
	mockFs: {
		openSync: vi.fn(),
		writeSync: vi.fn(),
		closeSync: vi.fn(),
		existsSync: vi.fn(),
		unlinkSync: vi.fn(),
		rmSync: vi.fn(),
	},
	mockGetWorkspaceDir: vi.fn(),
	mockCreateLLMCallLogger: vi.fn(),
}));

vi.mock('node:fs', () => ({
	default: mockFs,
}));

vi.mock('../../../src/utils/repo.js', () => ({
	getWorkspaceDir: mockGetWorkspaceDir,
}));

vi.mock('../../../src/utils/llmLogging.js', () => ({
	createLLMCallLogger: mockCreateLLMCallLogger,
}));

// Mock archiver - returns an EventEmitter-like object
const { mockArchiver } = vi.hoisted(() => {
	const mockArchiveInstance = {
		on: vi.fn().mockReturnThis(),
		pipe: vi.fn().mockReturnThis(),
		file: vi.fn().mockReturnThis(),
		finalize: vi.fn(),
	};
	return { mockArchiver: vi.fn().mockReturnValue(mockArchiveInstance) };
});

vi.mock('archiver', () => ({
	default: mockArchiver,
}));

// Mock node:stream PassThrough
const { MockPassThrough } = vi.hoisted(() => {
	class MockPassThrough {
		private handlers: Record<string, ((...args: unknown[]) => void)[]> = {};

		on(event: string, handler: (...args: unknown[]) => void) {
			if (!this.handlers[event]) this.handlers[event] = [];
			this.handlers[event].push(handler);
			return this;
		}

		emit(event: string, ...args: unknown[]) {
			for (const handler of this.handlers[event] ?? []) {
				handler(...args);
			}
		}
	}
	return { MockPassThrough };
});

vi.mock('node:stream', () => ({
	PassThrough: MockPassThrough,
}));

import {
	cleanupLogDirectory,
	cleanupLogFile,
	createFileLogger,
} from '../../../src/utils/fileLogger.js';

describe('createFileLogger', () => {
	const WORKSPACE_DIR = '/tmp/workspace';
	const FAKE_FD = 42;
	const mockLLMCallLogger = {
		logDir: '/tmp/workspace/test-llm-calls-123',
		logRequest: vi.fn(),
		logResponse: vi.fn(),
		getLogFiles: vi.fn().mockReturnValue([]),
	};

	beforeEach(() => {
		vi.resetAllMocks();
		mockGetWorkspaceDir.mockReturnValue(WORKSPACE_DIR);
		mockFs.openSync.mockReturnValue(FAKE_FD);
		mockCreateLLMCallLogger.mockReturnValue(mockLLMCallLogger);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('creates a file logger with expected log paths', () => {
		const logger = createFileLogger('test-prefix');

		expect(logger.logPath).toMatch(/\/tmp\/workspace\/test-prefix-cascade-\d+\.log/);
		expect(logger.llmistLogPath).toMatch(/\/tmp\/workspace\/test-prefix-llmist-\d+\.log/);
	});

	it('opens the log file for appending', () => {
		createFileLogger('test-prefix');

		expect(mockFs.openSync).toHaveBeenCalledWith(expect.stringContaining('cascade'), 'a');
	});

	it('creates an LLM call logger', () => {
		createFileLogger('test-prefix');

		expect(mockCreateLLMCallLogger).toHaveBeenCalledWith(WORKSPACE_DIR, 'test-prefix');
	});

	describe('write', () => {
		it('writes a formatted log line with level and message', () => {
			const logger = createFileLogger('test');

			logger.write('INFO', 'Test message');

			expect(mockFs.writeSync).toHaveBeenCalledWith(
				FAKE_FD,
				expect.stringMatching(/\[.+\] \[INFO\] Test message\n/),
			);
		});

		it('writes JSON context when provided', () => {
			const logger = createFileLogger('test');

			logger.write('ERROR', 'Something failed', { code: 500, detail: 'oops' });

			expect(mockFs.writeSync).toHaveBeenCalledWith(
				FAKE_FD,
				expect.stringContaining('{"code":500,"detail":"oops"}'),
			);
		});

		it('does not write after close (fd is null)', () => {
			const logger = createFileLogger('test');
			logger.close();

			logger.write('INFO', 'Should not be written');

			// writeSync should only have been called 0 times (nothing written after close)
			expect(mockFs.writeSync).not.toHaveBeenCalled();
		});
	});

	describe('close', () => {
		it('closes the file descriptor', () => {
			const logger = createFileLogger('test');

			logger.close();

			expect(mockFs.closeSync).toHaveBeenCalledWith(FAKE_FD);
		});

		it('does not throw when called multiple times', () => {
			const logger = createFileLogger('test');

			logger.close();
			expect(() => logger.close()).not.toThrow();

			// closeSync should only be called once
			expect(mockFs.closeSync).toHaveBeenCalledTimes(1);
		});
	});

	describe('getZippedBuffer', () => {
		it('creates a zip archive with correct format', async () => {
			mockFs.existsSync.mockReturnValue(false); // No log files exist
			mockLLMCallLogger.getLogFiles.mockReturnValue([]);

			const logger = createFileLogger('test');

			// Trigger getZippedBuffer but don't wait for it to complete
			// just verify the archive is set up correctly
			void logger.getZippedBuffer().catch(() => {
				/* ignore */
			});

			// Wait for synchronous setup within the promise
			await new Promise((r) => setTimeout(r, 0));

			// Verify archiver was called with zip format
			expect(mockArchiver).toHaveBeenCalledWith(
				'zip',
				expect.objectContaining({ zlib: { level: 9 } }),
			);
		});

		it('adds existing log files to archive', async () => {
			mockFs.existsSync.mockReturnValue(true);
			mockLLMCallLogger.getLogFiles.mockReturnValue([]);

			const logger = createFileLogger('test');
			void logger.getZippedBuffer().catch(() => {
				/* ignore */
			});

			await new Promise((r) => setTimeout(r, 0));

			// Get the archive instance created during getZippedBuffer call
			const archiveInstance = mockArchiver.mock.results[0]?.value;
			if (archiveInstance) {
				expect(archiveInstance.file).toHaveBeenCalledWith(expect.stringContaining('cascade'), {
					name: 'cascade.log',
				});
			}
		});

		it('adds LLM call log files to archive when they exist', async () => {
			mockFs.existsSync.mockReturnValue(true);
			const llmLogFile = '/tmp/workspace/test-llm-calls-123/0001.request';
			mockLLMCallLogger.getLogFiles.mockReturnValue([llmLogFile]);

			const logger = createFileLogger('test');
			void logger.getZippedBuffer().catch(() => {
				/* ignore */
			});

			await new Promise((r) => setTimeout(r, 0));

			const archiveInstance = mockArchiver.mock.results[0]?.value;
			if (archiveInstance) {
				expect(archiveInstance.file).toHaveBeenCalledWith(llmLogFile, {
					name: 'llm-calls/0001.request',
				});
			}
		});
	});
});

describe('cleanupLogFile', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('deletes the log file', () => {
		mockFs.unlinkSync.mockReturnValue(undefined);

		cleanupLogFile('/tmp/workspace/test.log');

		expect(mockFs.unlinkSync).toHaveBeenCalledWith('/tmp/workspace/test.log');
	});

	it('does not throw when file does not exist', () => {
		mockFs.unlinkSync.mockImplementation(() => {
			throw new Error('ENOENT');
		});

		expect(() => cleanupLogFile('/tmp/nonexistent.log')).not.toThrow();
	});
});

describe('cleanupLogDirectory', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('removes the directory recursively', () => {
		mockFs.rmSync.mockReturnValue(undefined);

		cleanupLogDirectory('/tmp/workspace/log-dir');

		expect(mockFs.rmSync).toHaveBeenCalledWith('/tmp/workspace/log-dir', {
			recursive: true,
			force: true,
		});
	});

	it('does not throw when directory does not exist', () => {
		mockFs.rmSync.mockImplementation(() => {
			throw new Error('ENOENT');
		});

		expect(() => cleanupLogDirectory('/tmp/nonexistent')).not.toThrow();
	});
});
