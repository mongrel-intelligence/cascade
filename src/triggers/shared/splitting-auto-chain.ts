import { getPMProvider } from '../../pm/context.js';
import { hasAutoLabel, resolveProjectPMConfig } from '../../pm/index.js';
import type { ProjectConfig } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import type { TriggerResult } from '../types.js';
import { isPipelineAtCapacity } from './backlog-check.js';
import { checkTriggerEnabled } from './trigger-check.js';

/**
 * After a successful splitting agent run, propagate the 'auto' label to all
 * cards in the backlog list and return a backlog-manager dispatch intent.
 *
 * Only runs if the parent work item has the 'auto' label configured.
 *
 * NOTE: This propagates the label to ALL items currently in the backlog, not just
 * those created by the splitting agent. This is intentional to enable batch auto-processing.
 */
export async function buildSplittingAutoChainDispatch(
	workItemId: string,
	project: ProjectConfig,
): Promise<TriggerResult | null> {
	const pmConfig = resolveProjectPMConfig(project);
	const provider = getPMProvider();

	let parentWorkItem: Awaited<ReturnType<typeof provider.getWorkItem>>;
	try {
		parentWorkItem = await provider.getWorkItem(workItemId);
	} catch (err) {
		logger.warn('propagateAutoLabelAfterSplitting: failed to fetch parent work item', {
			workItemId,
			error: String(err),
		});
		return null;
	}

	if (!hasAutoLabel(parentWorkItem.labels, pmConfig)) {
		return null;
	}

	const autoLabelId = pmConfig.labels.auto;
	if (!autoLabelId) return null;

	// Resolve the actual label ID from the matched parent work item label.
	// pmConfig.labels.auto may be a human-readable name string rather than a
	// provider-native ID.
	const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	if (project.pm.type === 'linear' && !UUID_REGEX.test(autoLabelId)) {
		logger.warn(
			'propagateAutoLabelAfterSplitting: labels.auto is not a UUID; resolving ID from parent labels',
			{ autoLabelId },
		);
	}
	const matchedLabel = parentWorkItem.labels.find(
		(l) => l.id === autoLabelId || l.name === autoLabelId,
	);
	const resolvedAutoLabelId = matchedLabel ? matchedLabel.id : autoLabelId;

	let backlogItems: Awaited<ReturnType<typeof provider.listWorkItems>>;
	try {
		backlogItems = await provider.listWorkItems(undefined, { status: 'backlog' });
	} catch (err) {
		logger.warn('propagateAutoLabelAfterSplitting: failed to list backlog items', {
			workItemId,
			error: String(err),
		});
		return null;
	}

	logger.info('Propagating auto label to backlog items after splitting', {
		parentWorkItemId: workItemId,
		backlogItemCount: backlogItems.length,
	});

	await Promise.all(
		backlogItems
			.filter((item) => !hasAutoLabel(item.labels, pmConfig))
			.map((item) =>
				provider.addLabel(item.id, resolvedAutoLabelId).catch((err) =>
					logger.warn('Failed to add auto label to backlog item', {
						itemId: item.id,
						error: String(err),
					}),
				),
			),
	);

	if (backlogItems.length === 0) {
		logger.info(
			'propagateAutoLabelAfterSplitting: backlog is empty after splitting, skipping backlog-manager chain',
			{ workItemId },
		);
		return null;
	}

	const backlogManagerEnabled = await checkTriggerEnabled(
		project.id,
		'backlog-manager',
		'internal:auto-chain',
		'splitting-auto-propagate',
	);
	if (!backlogManagerEnabled) {
		logger.info(
			'propagateAutoLabelAfterSplitting: backlog-manager trigger not enabled, skipping chain',
			{ workItemId },
		);
		return null;
	}

	const capacityResult = await isPipelineAtCapacity(project, provider);
	if (capacityResult.atCapacity) {
		logger.info(
			'propagateAutoLabelAfterSplitting: pipeline at capacity, skipping backlog-manager chain',
			{
				workItemId,
				reason: capacityResult.reason,
				inFlightCount: capacityResult.inFlightCount,
				limit: capacityResult.limit,
				availableSlots: capacityResult.availableSlots,
			},
		);
		return null;
	}

	logger.info('Chaining to backlog-manager after splitting with auto label', {
		parentWorkItemId: workItemId,
	});

	return {
		agentType: 'backlog-manager',
		agentInput: { triggerEvent: 'internal:auto-chain', workItemId },
		workItemId,
	};
}
