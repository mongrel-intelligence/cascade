import type { SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRecordUsage, mockWarn } = vi.hoisted(() => ({
	mockRecordUsage: vi.fn(),
	mockWarn: vi.fn(),
}));

vi.mock('../../../src/db/repositories/subscriptionsRepository.js', () => ({
	recordSubscriptionUsage: mockRecordUsage,
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: { warn: mockWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
	_resetRateLimitTracker,
	flushRateLimitWrites,
	getRateLimitRejection,
	isHardRejection,
	onRateLimitInfo,
	shouldExitForRateLimit,
	toPct,
	toResetDate,
	toWindow,
} from '../../../src/backends/claude-code/rateLimitTracker.js';

const RESET_SECONDS = 1_900_000_000;

function info(overrides: Partial<SDKRateLimitInfo> = {}): SDKRateLimitInfo {
	return { status: 'allowed', ...overrides } as SDKRateLimitInfo;
}

describe('rateLimitTracker', () => {
	beforeEach(() => {
		_resetRateLimitTracker();
		mockRecordUsage.mockReset().mockResolvedValue(undefined);
		mockWarn.mockReset();
		delete process.env.CASCADE_SUBSCRIPTION_ID;
	});

	afterEach(() => {
		delete process.env.CASCADE_SUBSCRIPTION_ID;
		vi.useRealTimers();
	});

	describe('helpers', () => {
		it('maps rate limit types to windows', () => {
			expect(toWindow('five_hour')).toBe('five_hour');
			expect(toWindow('seven_day')).toBe('seven_day');
			expect(toWindow('seven_day_opus')).toBe('seven_day');
			expect(toWindow('seven_day_sonnet')).toBe('seven_day');
			expect(toWindow('overage')).toBe('five_hour');
			expect(toWindow(undefined)).toBe('five_hour');
		});

		it('converts reset times in seconds or milliseconds, with a fallback', () => {
			expect(toResetDate(RESET_SECONDS).getTime()).toBe(RESET_SECONDS * 1000);
			expect(toResetDate(RESET_SECONDS * 1000).getTime()).toBe(RESET_SECONDS * 1000);
			expect(toResetDate(undefined, 1000).getTime()).toBe(1000 + 60 * 60 * 1000);
		});

		it('computes pct from status and utilization', () => {
			expect(toPct(info({ status: 'rejected', utilization: 0.2 }))).toBe(100);
			expect(toPct(info({ utilization: 0.42 }))).toBeCloseTo(42);
			expect(toPct(info({ utilization: 42 }))).toBe(42);
			expect(toPct(info({ status: 'allowed_warning' }))).toBe(80);
			expect(toPct(info())).toBe(0);
		});

		it('treats only non-overage rejections as hard', () => {
			expect(isHardRejection(info({ status: 'rejected' }))).toBe(true);
			expect(isHardRejection(info({ status: 'rejected', isUsingOverage: true }))).toBe(false);
			expect(isHardRejection(info({ status: 'allowed' }))).toBe(false);
			expect(isHardRejection(info({ status: 'allowed_warning' }))).toBe(false);
		});
	});

	describe('onRateLimitInfo', () => {
		it('does not write or request an interrupt without a subscription', () => {
			const hard = onRateLimitInfo(info({ status: 'rejected', resetsAt: RESET_SECONDS }));
			expect(hard).toBe(false);
			expect(mockRecordUsage).not.toHaveBeenCalled();
			expect(shouldExitForRateLimit()).toBe(false);
		});

		it('records usage and requests an interrupt on a hard rejection with a subscription', () => {
			process.env.CASCADE_SUBSCRIPTION_ID = '7';
			const hard = onRateLimitInfo(
				info({ status: 'rejected', rateLimitType: 'seven_day', resetsAt: RESET_SECONDS }),
			);
			expect(hard).toBe(true);
			expect(mockRecordUsage).toHaveBeenCalledWith(
				7,
				'seven_day',
				100,
				new Date(RESET_SECONDS * 1000),
			);
			expect(shouldExitForRateLimit()).toBe(true);
			expect(getRateLimitRejection()?.window).toBe('seven_day');
		});

		it('records an overage rejection at 100% without stopping the run', () => {
			process.env.CASCADE_SUBSCRIPTION_ID = '7';
			const hard = onRateLimitInfo(
				info({ status: 'rejected', isUsingOverage: true, resetsAt: RESET_SECONDS }),
			);
			expect(hard).toBe(false);
			expect(mockRecordUsage).toHaveBeenCalledWith(7, 'five_hour', 100, expect.any(Date));
			expect(shouldExitForRateLimit()).toBe(false);
		});

		it('records warning-level utilization', () => {
			process.env.CASCADE_SUBSCRIPTION_ID = '3';
			expect(
				onRateLimitInfo(
					info({ status: 'allowed_warning', utilization: 0.81, resetsAt: RESET_SECONDS }),
				),
			).toBe(false);
			expect(mockRecordUsage).toHaveBeenCalledWith(
				3,
				'five_hour',
				expect.closeTo(81),
				expect.any(Date),
			);
		});

		it('skips the write for a plain allowed event without utilization', () => {
			process.env.CASCADE_SUBSCRIPTION_ID = '3';
			onRateLimitInfo(info({ status: 'allowed' }));
			expect(mockRecordUsage).not.toHaveBeenCalled();
		});

		it('swallows DB errors', async () => {
			process.env.CASCADE_SUBSCRIPTION_ID = '3';
			mockRecordUsage.mockRejectedValue(new Error('db down'));
			expect(() => onRateLimitInfo(info({ status: 'rejected' }))).not.toThrow();
			await flushRateLimitWrites();
			expect(mockWarn).toHaveBeenCalledWith(
				'[RateLimit] Failed to record subscription usage',
				expect.objectContaining({ subscriptionId: 3 }),
			);
		});
	});

	describe('flushRateLimitWrites', () => {
		it('resolves after the timeout when a write never settles', async () => {
			vi.useFakeTimers();
			process.env.CASCADE_SUBSCRIPTION_ID = '3';
			mockRecordUsage.mockReturnValue(new Promise(() => {}));
			onRateLimitInfo(info({ status: 'rejected' }));

			let done = false;
			const p = flushRateLimitWrites(5000).then(() => {
				done = true;
			});
			await vi.advanceTimersByTimeAsync(4999);
			expect(done).toBe(false);
			await vi.advanceTimersByTimeAsync(1);
			await p;
			expect(done).toBe(true);
			expect(mockWarn).toHaveBeenCalledWith(
				'[RateLimit] Usage flush timed out',
				expect.objectContaining({ timeoutMs: 5000 }),
			);
		});
	});
});
