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

describe('config/compactionConfig', () => {
	describe('getCompactionConfig', () => {
		it('returns implementation agent config with lower threshold', () => {
			const config = getCompactionConfig('implementation');

			expect(config.enabled).toBe(true);
			expect(config.strategy).toBe('hybrid');
			expect(config.triggerThresholdPercent).toBe(70);
			expect(config.targetPercent).toBe(40);
			expect(config.preserveRecentTurns).toBe(8);
			expect(config.summarizationPrompt).toContain('Summarize this conversation history');
			expect(config.onCompaction).toBeTypeOf('function');
		});

		it('returns default config for other agents with higher threshold', () => {
			const agentTypes = ['splitting', 'planning', 'debug', 'respond-to-review', 'review'];

			for (const agentType of agentTypes) {
				const config = getCompactionConfig(agentType);

				expect(config.enabled).toBe(true);
				expect(config.strategy).toBe('hybrid');
				expect(config.triggerThresholdPercent).toBe(80);
				expect(config.targetPercent).toBe(50);
				expect(config.preserveRecentTurns).toBe(5);
			}
		});

		it('implementation agent has more aggressive reduction targets', () => {
			const implConfig = getCompactionConfig('implementation');
			const otherConfig = getCompactionConfig('splitting');

			expect(implConfig.triggerThresholdPercent).toBeLessThan(otherConfig.triggerThresholdPercent);
			expect(implConfig.targetPercent).toBeLessThan(otherConfig.targetPercent);
			expect(implConfig.preserveRecentTurns).toBeGreaterThan(otherConfig.preserveRecentTurns);
		});

		it('implementation agent preserves more recent turns', () => {
			const implConfig = getCompactionConfig('implementation');
			const otherConfig = getCompactionConfig('planning');

			expect(implConfig.preserveRecentTurns).toBe(8);
			expect(otherConfig.preserveRecentTurns).toBe(5);
		});

		it('includes failed approaches section in summarization prompt', () => {
			const config = getCompactionConfig('implementation');

			expect(config.summarizationPrompt).toContain('Failed Approaches');
			expect(config.summarizationPrompt).toContain('tried and FAILED');
		});

		it('implementation prompt preserves task goals and files', () => {
			const config = getCompactionConfig('implementation');

			expect(config.summarizationPrompt).toContain('task goals and acceptance criteria');
			expect(config.summarizationPrompt).toContain('files that were created or modified');
			expect(config.summarizationPrompt).toContain('todo list status');
		});

		it('default prompt preserves key decisions and progress', () => {
			const config = getCompactionConfig('splitting');

			expect(config.summarizationPrompt).toContain('Key decisions made');
			expect(config.summarizationPrompt).toContain('Current progress');
			expect(config.summarizationPrompt).toContain('Failed Approaches');
		});
	});

	describe('onCompaction callback', () => {
		it('logs compaction event with token savings', () => {
			const config = getCompactionConfig('implementation');

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
			const config = getCompactionConfig('planning');

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
			const config = getCompactionConfig('implementation');

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
			const config = getCompactionConfig('debug');

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
			const config = getCompactionConfig('implementation');

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

	describe('config consistency', () => {
		it('all agent types return valid config structure', () => {
			const agentTypes = [
				'implementation',
				'splitting',
				'planning',
				'debug',
				'review',
				'respond-to-review',
				'respond-to-ci',
			];

			for (const agentType of agentTypes) {
				const config = getCompactionConfig(agentType);

				expect(config.enabled).toBe(true);
				expect(config.strategy).toBe('hybrid');
				expect(config.triggerThresholdPercent).toBeGreaterThan(0);
				expect(config.targetPercent).toBeGreaterThan(0);
				expect(config.preserveRecentTurns).toBeGreaterThan(0);
				expect(config.summarizationPrompt).toBeTruthy();
				expect(config.onCompaction).toBeTypeOf('function');
			}
		});

		it('returns default config for unknown agent type', () => {
			const config = getCompactionConfig('nonexistent-agent-type');

			expect(config.enabled).toBe(true);
			expect(config.strategy).toBe('hybrid');
			expect(config.triggerThresholdPercent).toBe(80);
			expect(config.targetPercent).toBe(50);
			expect(config.preserveRecentTurns).toBe(5);
			expect(config.onCompaction).toBeTypeOf('function');
		});

		it('target percent is less than trigger threshold', () => {
			const agentTypes = ['implementation', 'splitting', 'planning'];

			for (const agentType of agentTypes) {
				const config = getCompactionConfig(agentType);

				expect(config.targetPercent).toBeLessThan(config.triggerThresholdPercent);
			}
		});

		it('thresholds are reasonable percentages', () => {
			const implConfig = getCompactionConfig('implementation');
			const otherConfig = getCompactionConfig('splitting');

			expect(implConfig.triggerThresholdPercent).toBeGreaterThanOrEqual(50);
			expect(implConfig.triggerThresholdPercent).toBeLessThanOrEqual(100);

			expect(otherConfig.triggerThresholdPercent).toBeGreaterThanOrEqual(50);
			expect(otherConfig.triggerThresholdPercent).toBeLessThanOrEqual(100);
		});
	});
});
