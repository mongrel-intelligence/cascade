import { createLogger } from 'llmist';
import type { ILogObj, Logger } from 'llmist';

export const LOG_LEVELS: Record<string, number> = {
	silly: 0,
	trace: 1,
	debug: 2,
	info: 3,
	warn: 4,
	error: 5,
	fatal: 6,
};

export const logger: Logger<ILogObj> = createLogger({
	name: 'cascade',
	minLevel: LOG_LEVELS.debug,
});

export function setLogLevel(level: string): void {
	const numericLevel = LOG_LEVELS[level.toLowerCase()];
	if (numericLevel !== undefined) {
		logger.settings.minLevel = numericLevel;
	}
}

export function getLogLevel(): string {
	const match = Object.entries(LOG_LEVELS).find(([, v]) => v === logger.settings.minLevel);
	return match ? match[0] : 'debug';
}
