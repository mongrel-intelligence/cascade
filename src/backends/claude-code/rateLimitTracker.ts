import type { SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk';
import {
	recordSubscriptionUsage,
	type UsageWindow,
} from '../../db/repositories/subscriptionsRepository.js';
import { logger } from '../../utils/logging.js';

export interface RateLimitRejection {
	window: UsageWindow;
	resetAt: Date;
}

let rejection: RateLimitRejection | null = null;
const pendingWrites: Promise<void>[] = [];
const FALLBACK_RESET_MS = 60 * 60 * 1000;

export function toWindow(t: SDKRateLimitInfo['rateLimitType']): UsageWindow {
	// Weekly buckets (incl. per-model) block the subscription; overage/unknown map to five_hour.
	return t === 'seven_day' || t === 'seven_day_opus' || t === 'seven_day_sonnet'
		? 'seven_day'
		: 'five_hour';
}

export function toResetDate(resetsAt: number | undefined, now = Date.now()): Date {
	if (resetsAt === undefined || !Number.isFinite(resetsAt))
		return new Date(now + FALLBACK_RESET_MS);
	// The SDK types don't document the unit; the CLI sends epoch seconds.
	return new Date(resetsAt < 1e12 ? resetsAt * 1000 : resetsAt);
}

export function toPct(info: SDKRateLimitInfo): number {
	if (info.status === 'rejected') return 100;
	const u = info.utilization;
	if (u === undefined || !Number.isFinite(u)) return info.status === 'allowed_warning' ? 80 : 0;
	// The CLI sends a 0-1 fraction; accept a percentage too.
	return u <= 1 ? u * 100 : u;
}

function subscriptionId(): number | null {
	const raw = process.env.CASCADE_SUBSCRIPTION_ID;
	const id = raw ? Number.parseInt(raw, 10) : Number.NaN;
	return Number.isInteger(id) && id > 0 ? id : null;
}

/** A rejection billed to extra usage is a successful call, not a stop. */
export function isHardRejection(info: SDKRateLimitInfo): boolean {
	return info.status === 'rejected' && info.isUsingOverage !== true;
}

/**
 * Called for every rate_limit_event. Never throws. Returns true only when the caller should
 * interrupt the stream: a hard rejection on a worker running on a managed subscription.
 */
export function onRateLimitInfo(info: SDKRateLimitInfo): boolean {
	const window = toWindow(info.rateLimitType);
	const resetAt = toResetDate(info.resetsAt);
	const hard = isHardRejection(info);
	if (hard) rejection = { window, resetAt };
	const id = subscriptionId();
	if (id === null) return false;
	if (info.utilization === undefined && info.status === 'allowed') return false;
	pendingWrites.push(
		recordSubscriptionUsage(id, window, toPct(info), resetAt).catch((err) => {
			logger.warn('[RateLimit] Failed to record subscription usage', {
				subscriptionId: id,
				error: String(err),
			});
		}),
	);
	return hard;
}

/** True only when a hard rejection was seen AND this worker runs on a managed subscription. */
export function shouldExitForRateLimit(): boolean {
	return rejection !== null && subscriptionId() !== null;
}

export function getRateLimitRejection(): RateLimitRejection | null {
	return rejection;
}

/** Bounded so an unreachable DB never blocks exit. */
export async function flushRateLimitWrites(timeoutMs = 5000): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<void>((resolve) => {
		timer = setTimeout(() => {
			logger.warn('[RateLimit] Usage flush timed out', {
				timeoutMs,
				pending: pendingWrites.length,
			});
			resolve();
		}, timeoutMs);
	});
	await Promise.race([Promise.allSettled(pendingWrites).then(() => undefined), timeout]);
	clearTimeout(timer);
}

/** @internal tests only */
export function _resetRateLimitTracker(): void {
	rejection = null;
	pendingWrites.length = 0;
}
