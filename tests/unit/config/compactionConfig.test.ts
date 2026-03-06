import { afterEach, describe, expect, it, vi } from 'vitest';

import { getCompactionConfig } from '../../../src/config/compactionConfig.js';

// Mock the dependencies
vi.mock('../../../src/gadgets/readTracking.js', () => ({
	clearReadTracking: vi.fn(),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

import { clearReadTracking } from '../../../src/gadgets/readTracking.js';
import { logger } from '../../../src/utils/logging.js';

afterEach(() => {
	vi.clearAllMocks();
});

describe('config/compactionConfig', () => {
	describe('getCompactionConfig', () => {
		it('returns standard config with expected thresholds', () => {
			const config = getCompactionConfig();

			expect(config.enabled).toBe(true);
			expect(config.strategy).toBe('hybrid');
			expect(config.triggerThresholdPercent).toBe(80);
			expect(config.targetPercent).toBe(50);
			expect(config.preserveRecentTurns).toBe(5);
			expect(config.summarizationPrompt).toContain('Summarize this conversation history');
			expect(config.onCompaction).toBeTypeOf('function');
		});

		it('target percent is less than trigger threshold', () => {
			const config = getCompactionConfig();
			expect(config.targetPercent).toBeLessThan(config.triggerThresholdPercent);
		});

		it('thresholds are reasonable percentages', () => {
			const config = getCompactionConfig();
			expect(config.triggerThresholdPercent).toBeGreaterThanOrEqual(50);
			expect(config.triggerThresholdPercent).toBeLessThanOrEqual(100);
			expect(config.targetPercent).toBeGreaterThanOrEqual(10);
			expect(config.targetPercent).toBeLessThanOrEqual(100);
		});

		it('returns a new object on each call', () => {
			const config1 = getCompactionConfig();
			const config2 = getCompactionConfig();
			expect(config1).not.toBe(config2);
		});

		it('prompt preserves key decisions and progress', () => {
			const config = getCompactionConfig();

			expect(config.summarizationPrompt).toContain('Key decisions made');
			expect(config.summarizationPrompt).toContain('Current progress');
			expect(config.summarizationPrompt).toContain('Failed Approaches');
		});

		it('includes failed approaches section in summarization prompt', () => {
			const config = getCompactionConfig();

			expect(config.summarizationPrompt).toContain('Failed Approaches');
			expect(config.summarizationPrompt).toContain('tried and FAILED');
		});
	});

	describe('onCompaction callback', () => {
		it('logs compaction event with token savings', () => {
			const config = getCompactionConfig();

			const event = {
				strategy: 'hybrid' as const,
				iteration: 10,
				tokensBefore: 50000,
				tokensAfter: 20000,
				messagesBefore: 40,
				messagesAfter: 15,
			};

			config.onCompaction?.(event);

			expect(logger.info).toHaveBeenCalledWith('Context compaction performed', {
				strategy: 'hybrid',
				iteration: 10,
				tokensBefore: 50000,
				tokensAfter: 20000,
				tokensSaved: 30000,
				reductionPercent: 60,
				messagesRemoved: 25,
			});
		});

		it('calculates reduction percentage correctly', () => {
			const config = getCompactionConfig();

			const event = {
				strategy: 'hybrid' as const,
				iteration: 5,
				tokensBefore: 100000,
				tokensAfter: 40000,
				messagesBefore: 30,
				messagesAfter: 10,
			};

			config.onCompaction?.(event);

			const logCall = vi.mocked(logger.info).mock.calls[0];
			expect(logCall[1]).toMatchObject({
				tokensSaved: 60000,
				reductionPercent: 60, // (60000 / 100000) * 100
			});
		});

		it('clears read tracking after compaction', () => {
			const config = getCompactionConfig();

			const event = {
				strategy: 'hybrid' as const,
				iteration: 8,
				tokensBefore: 80000,
				tokensAfter: 30000,
				messagesBefore: 50,
				messagesAfter: 20,
			};

			config.onCompaction?.(event);

			expect(clearReadTracking).toHaveBeenCalledTimes(1);
		});

		it('logs messages removed count', () => {
			const config = getCompactionConfig();

			const event = {
				strategy: 'hybrid' as const,
				iteration: 3,
				tokensBefore: 60000,
				tokensAfter: 25000,
				messagesBefore: 35,
				messagesAfter: 12,
			};

			config.onCompaction?.(event);

			const logCall = vi.mocked(logger.info).mock.calls[0];
			expect(logCall[1]).toMatchObject({
				messagesRemoved: 23, // 35 - 12
			});
		});

		it('rounds reduction percentage to integer', () => {
			const config = getCompactionConfig();

			const event = {
				strategy: 'hybrid' as const,
				iteration: 7,
				tokensBefore: 33333,
				tokensAfter: 11111,
				messagesBefore: 25,
				messagesAfter: 10,
			};

			config.onCompaction?.(event);

			const logCall = vi.mocked(logger.info).mock.calls[0];
			// (22222 / 33333) * 100 = 66.666... -> should be rounded
			expect(logCall[1].reductionPercent).toBe(67);
		});
	});
});
