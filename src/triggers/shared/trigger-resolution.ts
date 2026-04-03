/**
 * Shared trigger resolution utility for webhook handlers.
 *
 * Extracts the "if pre-resolved result use it, else dispatch" pattern
 * duplicated across GitHub (webhook-handler.ts L253-261),
 * Sentry (webhook-handler.ts L33-47), and PM (webhook-handler.ts L64-87).
 *
 * Usage:
 *   const result = await resolveTriggerResult(registry, ctx, preResolvedResult);
 */

import type { TriggerContext, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import type { TriggerRegistry } from '../registry.js';

/**
 * Resolve a trigger result from either a pre-computed result or registry dispatch.
 *
 * If `preResolvedResult` is provided, it is returned immediately (skipping dispatch).
 * Otherwise, `registry.dispatch(ctx)` is called to compute the result.
 *
 * @param registry           Trigger registry to dispatch against (when no pre-resolved result).
 * @param ctx                Trigger context passed to registry dispatch.
 * @param preResolvedResult  Optional pre-computed result from the router (skips dispatch).
 * @param logLabel           Optional label for log messages (default: uses ctx.source).
 * @returns                  The resolved TriggerResult, or null if no trigger matched.
 */
export async function resolveTriggerResult(
	registry: TriggerRegistry,
	ctx: TriggerContext,
	preResolvedResult?: TriggerResult,
	logLabel?: string,
): Promise<TriggerResult | null> {
	const label = logLabel ?? ctx.source;

	if (preResolvedResult) {
		logger.info(`${label}: using pre-resolved trigger result`, {
			agentType: preResolvedResult.agentType,
		});
		return preResolvedResult;
	}

	const result = await registry.dispatch(ctx);
	if (!result) {
		logger.info(`${label}: no trigger matched`);
	}
	return result;
}
