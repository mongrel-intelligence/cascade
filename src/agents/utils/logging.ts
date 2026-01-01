import type { FileLogger } from '../../utils/fileLogger.js';
import { logger } from '../../utils/logging.js';

export interface AgentLogger {
	debug: (msg: string, ctx?: Record<string, unknown>) => void;
	info: (msg: string, ctx?: Record<string, unknown>) => void;
	warn: (msg: string, ctx?: Record<string, unknown>) => void;
	error: (msg: string, ctx?: Record<string, unknown>) => void;
}

/**
 * Creates an agent logger that writes to both console and file logger.
 */
export function createAgentLogger(fileLogger: FileLogger | null): AgentLogger {
	return {
		debug: (msg: string, ctx?: Record<string, unknown>) => {
			logger.debug(msg, ctx);
			fileLogger?.write('DEBUG', msg, ctx);
		},
		info: (msg: string, ctx?: Record<string, unknown>) => {
			logger.info(msg, ctx);
			fileLogger?.write('INFO', msg, ctx);
		},
		warn: (msg: string, ctx?: Record<string, unknown>) => {
			logger.warn(msg, ctx);
			fileLogger?.write('WARN', msg, ctx);
		},
		error: (msg: string, ctx?: Record<string, unknown>) => {
			logger.error(msg, ctx);
			fileLogger?.write('ERROR', msg, ctx);
		},
	};
}
