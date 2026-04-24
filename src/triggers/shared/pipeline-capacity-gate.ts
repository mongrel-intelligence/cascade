/**
 * Shared pipeline-capacity gate for PM `status-changed` triggers.
 *
 * `maxInFlightItems` is meant as a hard cap on the *active pipeline*
 * (TODO + IN_PROGRESS + IN_REVIEW). Without this gate, a human moving N
 * cards into the TODO column fires N implementation runs in parallel and
 * blows past the limit — see the regression on `ua-store` (2026-04-24)
 * where 3 implementations ran concurrently despite `maxInFlightItems: 1`.
 *
 * Currently only `implementation` is gated: of the agents reachable via PM
 * `status-changed` (see `STATUS_TO_AGENT`), it is the only one that consumes
 * a TODO/IN_PROGRESS/IN_REVIEW slot. `splitting` and `planning` use their own
 * dedicated columns; `backlog-manager` already has dedicated capacity gates
 * at its two chain sites (pr-merged, splitting auto-chain).
 */

import { getPMProvider } from '../../pm/context.js';
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
		logger.info('pipeline-at-capacity: skipping status-changed trigger', {
			source: args.source,
			projectId: args.project.id,
			workItemId: args.workItemId,
			agentType: args.agentType,
			inFlightCount: result.inFlightCount,
			limit: result.limit,
		});
		return true;
	}
	return false;
}
