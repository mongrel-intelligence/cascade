/**
 * Shared pipeline-capacity gate for PM `status-changed` triggers.
 *
 * `maxInFlightItems` is meant as a hard cap on the *active pipeline*
 * (TODO + IN_PROGRESS + IN_REVIEW). Without this gate, a human moving N
 * cards into the TODO column fires N implementation runs in parallel and
 * blows past the limit — see the regression on `ua-store` (2026-04-24)
 * where 3 implementations ran concurrently despite `maxInFlightItems: 1`.
 *
 * When over capacity the gate moves the card back to the BACKLOG column and
 * posts an explanatory comment. This is critical for deadlock prevention:
 * simply returning `null` without moving the card would leave it in TODO with
 * no agent running, permanently inflating inFlightCount. Because `backlog-manager`
 * only pulls cards from BACKLOG (not TODO), those orphaned TODO cards would
 * deadlock the pipeline indefinitely — even after active agents finish, the
 * stale TODO count would keep the capacity gate blocking forever.
 *
 * Currently only `implementation` is gated: of the agents reachable via PM
 * `status-changed` (see `STATUS_TO_AGENT`), it is the only one that consumes
 * a TODO/IN_PROGRESS/IN_REVIEW slot. `splitting` and `planning` use their own
 * dedicated columns; `backlog-manager` already has dedicated capacity gates
 * at its two chain sites (pr-merged, splitting auto-chain).
 */

import { getPMProvider } from '../../pm/context.js';
import { resolveProjectPMConfig } from '../../pm/lifecycle.js';
import type { PMProvider } from '../../pm/types.js';
import type { ProjectConfig } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { isActivePipelineOverCapacity } from './backlog-check.js';

const SLOT_CONSUMING_AGENTS: ReadonlySet<string> = new Set(['implementation']);

export async function shouldBlockForPipelineCapacity(args: {
	project: ProjectConfig;
	agentType: string;
	workItemId: string;
	source: string;
}): Promise<boolean> {
	if (!SLOT_CONSUMING_AGENTS.has(args.agentType)) return false;

	let provider: PMProvider;
	try {
		provider = getPMProvider();
	} catch (err) {
		// No credential scope — conservative: allow.
		logger.warn('pipeline-capacity-gate: PM provider unavailable, allowing run', {
			source: args.source,
			projectId: args.project.id,
			workItemId: args.workItemId,
			error: String(err),
		});
		return false;
	}

	const result = await isActivePipelineOverCapacity(args.project, provider, {
		excludeWorkItemId: args.workItemId,
	});

	if (result.overCapacity) {
		logger.info('pipeline-at-capacity: moving card back to backlog', {
			source: args.source,
			projectId: args.project.id,
			workItemId: args.workItemId,
			agentType: args.agentType,
			inFlightCount: result.inFlightCount,
			limit: result.limit,
		});
		await rejectToBacklog(args.project, provider, args.workItemId, {
			source: args.source,
			inFlightCount: result.inFlightCount,
			limit: result.limit,
		});
		return true;
	}
	return false;
}

/**
 * Move a capacity-rejected card back to the BACKLOG column and post an
 * explanatory comment. If either operation fails (transient API error,
 * misconfigured backlog column) the error is logged but does NOT propagate —
 * the gate still returns `true` and the trigger still returns `null`, so the
 * capacity invariant is preserved regardless.
 */
async function rejectToBacklog(
	project: ProjectConfig,
	provider: PMProvider,
	workItemId: string,
	ctx: { source: string; inFlightCount?: number; limit?: number },
): Promise<void> {
	try {
		const pmConfig = resolveProjectPMConfig(project);
		const backlogDestination = pmConfig.statuses.backlog;

		if (!backlogDestination) {
			logger.warn(
				'pipeline-capacity-gate: no backlog status configured, card left in current column',
				{
					source: ctx.source,
					projectId: project.id,
					workItemId,
				},
			);
			return;
		}

		await provider.moveWorkItem(workItemId, backlogDestination);

		const countDesc =
			ctx.inFlightCount !== undefined && ctx.limit !== undefined
				? ` (${ctx.inFlightCount} of ${ctx.limit} slots in use)`
				: '';
		await provider.addComment(
			workItemId,
			`Pipeline at capacity — moved back to backlog.${countDesc} It will be picked up automatically when a slot frees.`,
		);

		logger.info('pipeline-capacity-gate: card moved back to backlog', {
			source: ctx.source,
			projectId: project.id,
			workItemId,
			backlogDestination,
		});
	} catch (err) {
		// Non-fatal: the gate still blocks the agent even if the move/comment fails.
		logger.warn('pipeline-capacity-gate: failed to move card back to backlog', {
			source: ctx.source,
			projectId: project.id,
			workItemId,
			error: String(err),
		});
	}
}
