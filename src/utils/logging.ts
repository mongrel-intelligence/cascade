type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export const LOG_LEVELS: Record<LogLevel, number> = {
	trace: 0,
	debug: 1,
	info: 2,
	warn: 3,
	error: 4,
};

let currentLogLevel: LogLevel = 'debug';

export function setLogLevel(level: string): void {
	if (level in LOG_LEVELS) {
		currentLogLevel = level as LogLevel;
	}
}

export function getLogLevel(): LogLevel {
	return currentLogLevel;
}

function shouldLog(level: LogLevel): boolean {
	return LOG_LEVELS[level] >= LOG_LEVELS[currentLogLevel];
}

function formatMessage(
	level: LogLevel,
	message: string,
	context?: Record<string, unknown>,
): string {
	const timestamp = new Date().toISOString();
	const contextStr = context ? ` ${JSON.stringify(context)}` : '';
	return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
}

export const logger = {
	trace(message: string, context?: Record<string, unknown>): void {
		if (shouldLog('trace')) {
			console.log(formatMessage('trace', message, context));
		}
	},

	debug(message: string, context?: Record<string, unknown>): void {
		if (shouldLog('debug')) {
			console.log(formatMessage('debug', message, context));
		}
	},

	info(message: string, context?: Record<string, unknown>): void {
		if (shouldLog('info')) {
			console.log(formatMessage('info', message, context));
		}
	},

	warn(message: string, context?: Record<string, unknown>): void {
		if (shouldLog('warn')) {
			console.warn(formatMessage('warn', message, context));
		}
	},

	error(message: string, context?: Record<string, unknown>): void {
		if (shouldLog('error')) {
			console.error(formatMessage('error', message, context));
		}
	},
};
