import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LOG_LEVELS, getLogLevel, logger, setLogLevel } from '../../../src/utils/logging.js';

/**
 * Tests for setLogLevel and getLogLevel in utils/logging.ts.
 * The logger is a real llmist Logger instance; we mutate its settings.minLevel
 * and restore it between tests.
 */
describe('setLogLevel / getLogLevel', () => {
	let originalLevel: number;

	beforeEach(() => {
		// Capture the current level so we can restore it after each test
		originalLevel = logger.settings.minLevel;
	});

	afterEach(() => {
		logger.settings.minLevel = originalLevel;
	});

	// ── setLogLevel ─────────────────────────────────────────────────────────────

	describe('setLogLevel', () => {
		it('sets the correct numeric level for each valid level string', () => {
			for (const [levelName, levelValue] of Object.entries(LOG_LEVELS)) {
				setLogLevel(levelName);
				expect(logger.settings.minLevel).toBe(levelValue);
			}
		});

		it('accepts level strings in any case (case-insensitive)', () => {
			setLogLevel('DEBUG');
			expect(logger.settings.minLevel).toBe(LOG_LEVELS.debug);

			setLogLevel('WARN');
			expect(logger.settings.minLevel).toBe(LOG_LEVELS.warn);

			setLogLevel('Error');
			expect(logger.settings.minLevel).toBe(LOG_LEVELS.error);
		});

		it('ignores invalid level string — leaves minLevel unchanged', () => {
			setLogLevel('info'); // set to a known level first
			const beforeLevel = logger.settings.minLevel;

			setLogLevel('notavalidlevel');

			expect(logger.settings.minLevel).toBe(beforeLevel);
		});

		it('ignores empty string — leaves minLevel unchanged', () => {
			setLogLevel('warn');
			const beforeLevel = logger.settings.minLevel;

			setLogLevel('');

			expect(logger.settings.minLevel).toBe(beforeLevel);
		});
	});

	// ── getLogLevel ─────────────────────────────────────────────────────────────

	describe('getLogLevel', () => {
		it('returns the string name for each known numeric level', () => {
			for (const [levelName, levelValue] of Object.entries(LOG_LEVELS)) {
				logger.settings.minLevel = levelValue;
				expect(getLogLevel()).toBe(levelName);
			}
		});

		it('defaults to "debug" when minLevel does not match any known level', () => {
			// Use a numeric value that is not in LOG_LEVELS
			logger.settings.minLevel = 999;
			expect(getLogLevel()).toBe('debug');
		});

		it('round-trips correctly after setLogLevel', () => {
			setLogLevel('error');
			expect(getLogLevel()).toBe('error');

			setLogLevel('silly');
			expect(getLogLevel()).toBe('silly');
		});
	});
});
