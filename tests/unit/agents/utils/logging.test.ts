import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import { createAgentLogger } from '../../../../src/agents/utils/logging.js';
import { logger } from '../../../../src/utils/logging.js';

const mockLogger = vi.mocked(logger);

beforeEach(() => {
	vi.clearAllMocks();
});

describe('createAgentLogger', () => {
	it('debug writes to both console logger and file logger', () => {
		const fileLogger = { write: vi.fn() };
		const agentLogger = createAgentLogger(fileLogger as never);

		agentLogger.debug('test debug', { key: 'value' });

		expect(mockLogger.debug).toHaveBeenCalledWith('test debug', { key: 'value' });
		expect(fileLogger.write).toHaveBeenCalledWith('DEBUG', 'test debug', { key: 'value' });
	});

	it('info writes to both console logger and file logger', () => {
		const fileLogger = { write: vi.fn() };
		const agentLogger = createAgentLogger(fileLogger as never);

		agentLogger.info('test info', { foo: 'bar' });

		expect(mockLogger.info).toHaveBeenCalledWith('test info', { foo: 'bar' });
		expect(fileLogger.write).toHaveBeenCalledWith('INFO', 'test info', { foo: 'bar' });
	});

	it('warn writes to both console logger and file logger', () => {
		const fileLogger = { write: vi.fn() };
		const agentLogger = createAgentLogger(fileLogger as never);

		agentLogger.warn('test warn');

		expect(mockLogger.warn).toHaveBeenCalledWith('test warn', undefined);
		expect(fileLogger.write).toHaveBeenCalledWith('WARN', 'test warn', undefined);
	});

	it('error writes to both console logger and file logger', () => {
		const fileLogger = { write: vi.fn() };
		const agentLogger = createAgentLogger(fileLogger as never);

		agentLogger.error('test error', { errCode: 42 });

		expect(mockLogger.error).toHaveBeenCalledWith('test error', { errCode: 42 });
		expect(fileLogger.write).toHaveBeenCalledWith('ERROR', 'test error', { errCode: 42 });
	});

	it('works with null fileLogger — only writes to console logger', () => {
		const agentLogger = createAgentLogger(null);

		agentLogger.info('no file logger', { x: 1 });

		expect(mockLogger.info).toHaveBeenCalledWith('no file logger', { x: 1 });
	});

	it('does not throw when fileLogger is null for all log levels', () => {
		const agentLogger = createAgentLogger(null);

		expect(() => agentLogger.debug('d')).not.toThrow();
		expect(() => agentLogger.info('i')).not.toThrow();
		expect(() => agentLogger.warn('w')).not.toThrow();
		expect(() => agentLogger.error('e')).not.toThrow();
	});

	it('works with no context argument', () => {
		const fileLogger = { write: vi.fn() };
		const agentLogger = createAgentLogger(fileLogger as never);

		agentLogger.info('no context');

		expect(mockLogger.info).toHaveBeenCalledWith('no context', undefined);
		expect(fileLogger.write).toHaveBeenCalledWith('INFO', 'no context', undefined);
	});
});
