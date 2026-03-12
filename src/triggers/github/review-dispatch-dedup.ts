import { logger } from '../../utils/logging.js';

const DEDUP_TTL_MS = 30 * 60 * 1000; // 30 minutes

export const recentlyDispatched = new Map<string, number>();

export function buildReviewDispatchKey(
	owner: string,
	repo: string,
	prNumber: number,
	headSha: string,
): string {
	return `${owner}/${repo}:${prNumber}:${headSha}`;
}

function cleanupExpiredEntries(now: number): void {
	for (const [key, ts] of recentlyDispatched) {
		if (now - ts > DEDUP_TTL_MS) {
			recentlyDispatched.delete(key);
		}
	}
}

export function claimReviewDispatch(
	key: string,
	triggerName: string,
	context: { prNumber: number; headSha: string },
): boolean {
	const now = Date.now();
	cleanupExpiredEntries(now);

	if (recentlyDispatched.has(key)) {
		logger.info('Review already dispatched for this PR+SHA, skipping', {
			trigger: triggerName,
			reviewDispatchKey: key,
			prNumber: context.prNumber,
			headSha: context.headSha,
		});
		return false;
	}

	recentlyDispatched.set(key, now);
	logger.info('Claimed review dispatch for PR+SHA', {
		trigger: triggerName,
		reviewDispatchKey: key,
		prNumber: context.prNumber,
		headSha: context.headSha,
	});
	return true;
}

export function releaseReviewDispatch(key: string): void {
	recentlyDispatched.delete(key);
}
