type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

let currentLogLevel: LogLevel = 'info';

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
