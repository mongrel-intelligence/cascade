/**
 * Generic alert→PM materializer (spec 019).
 *
 * `materializeAlertWorkItem` converts an (source, externalId, project, hints) tuple
 * into a real PM work-item id:
 *   1. Resolves the alerts container from project config. Throws AlertSlotMissingError if absent.
 *   2. Checks for an existing (project, source, externalId) mapping in pr_work_items.
 *      - Found + PM card healthy → return existing id.
 *      - Found + PM card 404 → lazy-heal: create fresh card, replace mapping, emit WARN.
 *   3. Atomically claims the mapping row via INSERT … ON CONFLICT DO NOTHING.
 *      - Claimed (ownedHere=true) → create PM card, apply label+move, attach id to row.
 *      - Lost to concurrent winner (ownedHere=false) → poll winner's row for work_item_id;
 *        throw MaterializationRetryExhausted if polling budget exhausted.
 *   4. PM errors propagate untouched so BullMQ retry semantics apply.
 */

import {
	attachWorkItemId,
	claimExternalMapping,
	deleteExternalMappingClaim,
	findByExternal,
	replaceWorkItemId,
} from '../../../db/repositories/prWorkItemsRepository.js';
import {
	getAlertLabelId,
	getAlertsContainerId,
	getAlertsStatusDestination,
} from '../../../pm/config.js';
import { pmRegistry } from '../../../pm/registry.js';
import type { ProjectConfig } from '../../../types/index.js';
import { logger } from '../../../utils/logging.js';
import {
	type AlertHints,
	AlertSlotMissingError,
	type AlertSource,
	MaterializationRetryExhausted,
} from './types.js';

const POLL_MAX_ATTEMPTS = 8;
const POLL_DELAY_MS = 250;

function is404Error(err: unknown): boolean {
	return err instanceof Error && /\b404\b/.test(err.message);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Verify an existing pr_work_items mapping points to a live PM card and
 * re-apply placement (idempotent for Trello, repairs failed prior moves for
 * JIRA/Linear). Lazy-heals (creates a fresh card + replaces mapping) when the
 * card returns 404. Re-throws any other PM error so BullMQ retries.
 */
async function reuseOrLazyHealMapping(
	project: ProjectConfig,
	source: AlertSource,
	externalId: string,
	containerId: string,
	hints: AlertHints,
	provider: ReturnType<typeof pmRegistry.createProvider>,
	existing: { id: string; workItemId: string },
): Promise<string> {
	try {
		await provider.getWorkItem(existing.workItemId);
	} catch (err) {
		if (!is404Error(err)) throw err;
		// Card deleted — create a replacement and CAS-swap the mapping row.
		return createAndAttach(project, source, externalId, containerId, hints, provider, {
			lazyHeal: { rowId: existing.id, oldWorkItemId: existing.workItemId },
		});
	}
	// Re-apply placement so a prior failed moveWorkItem can be repaired on
	// subsequent deliveries rather than staying permanently stuck.
	const destination = getAlertsStatusDestination(project);
	if (destination) {
		await provider.moveWorkItem(existing.workItemId, destination);
	}
	return existing.workItemId;
}

/**
 * Lost the claim race — poll the winner's mapping row for its work_item_id.
 * Returns the id when the winner attaches one; returns null after the polling
 * budget is exhausted (caller throws MaterializationRetryExhausted).
 */
async function pollForConcurrentWinner(
	project: ProjectConfig,
	source: AlertSource,
	externalId: string,
): Promise<string | null> {
	for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
		await sleep(POLL_DELAY_MS);
		const row = await findByExternal(project.id, source, externalId);
		if (row?.workItemId) return row.workItemId;
	}
	return null;
}

export async function materializeAlertWorkItem(
	source: AlertSource,
	externalId: string,
	project: ProjectConfig,
	hints: AlertHints,
): Promise<string> {
	const containerId = getAlertsContainerId(project);
	if (!containerId) {
		throw new AlertSlotMissingError(project.id, project.pm?.type);
	}

	const provider = pmRegistry.createProvider(project);

	// Step 1: existing mapping?
	const existing = await findByExternal(project.id, source, externalId);
	if (existing?.workItemId) {
		return reuseOrLazyHealMapping(project, source, externalId, containerId, hints, provider, {
			id: existing.id,
			workItemId: existing.workItemId,
		});
	}

	// Step 2: atomically claim the mapping row.
	const claim = await claimExternalMapping(project.id, source, externalId);
	if (claim.ownedHere) {
		try {
			return await createAndAttach(project, source, externalId, containerId, hints, provider, {
				lazyHeal: null,
				rowId: claim.rowId,
			});
		} catch (err) {
			// createAndAttach failed — clear the NULL-work_item_id row so the next
			// Sentry delivery can reclaim it instead of polling to exhaustion.
			await deleteExternalMappingClaim(claim.rowId).catch((deleteErr) => {
				logger.warn('[alert-materializer] failed to clean up stale claim row', {
					rowId: claim.rowId,
					projectId: project.id,
					source,
					externalId,
					error: String(deleteErr),
				});
			});
			throw err;
		}
	}

	// Step 3: lost the claim race — return the winner's already-attached id, or
	// poll until they attach one.
	if (claim.existing.workItemId) return claim.existing.workItemId;
	const polled = await pollForConcurrentWinner(project, source, externalId);
	if (polled) return polled;
	throw new MaterializationRetryExhausted(project.id, source, externalId);
}

type CreateOpts =
	| { lazyHeal: { rowId: string; oldWorkItemId: string }; rowId?: undefined }
	| { lazyHeal: null; rowId: string };

async function createAndAttach(
	project: ProjectConfig,
	source: AlertSource,
	externalId: string,
	containerId: string,
	hints: AlertHints,
	provider: ReturnType<typeof pmRegistry.createProvider>,
	opts: CreateOpts,
): Promise<string> {
	const newCard = await provider.createWorkItem({
		containerId,
		title: hints.title,
		description: hints.descriptionMarkdown,
		labels: [],
	});

	// Persist the PM id immediately — before any optional operations — so that a
	// failure in addLabel or moveWorkItem never leaves a NULL work_item_id row.
	// Future retries will find the row via findByExternal → existing.workItemId →
	// getWorkItem (alive) → return existing id, rather than polling to exhaustion.
	if (opts.lazyHeal) {
		const replaced = await replaceWorkItemId(
			opts.lazyHeal.rowId,
			opts.lazyHeal.oldWorkItemId,
			newCard.id,
		);
		if (replaced) {
			logger.warn('[alert-materializer] orphan card detected', {
				projectId: project.id,
				source,
				externalId,
				prior: opts.lazyHeal.oldWorkItemId,
				replacement: newCard.id,
			});
		} else {
			// Another concurrent webhook already healed the stale row; our newly
			// created card is an orphan. Re-read the canonical mapping and return
			// that id so this dispatch proceeds against the persisted work item.
			const current = await findByExternal(project.id, source, externalId);
			if (current?.workItemId) {
				logger.warn('[alert-materializer] lazy-heal CAS lost, returning canonical id', {
					projectId: project.id,
					source,
					externalId,
					orphanCard: newCard.id,
					canonicalCard: current.workItemId,
				});
				return current.workItemId;
			}
			// Fallback: canonical mapping not readable — use the card we created.
		}
	} else {
		await attachWorkItemId(opts.rowId, newCard.id);
	}

	// Optional post-create operations: run after the DB row is updated so that
	// their failure cannot permanently wedge the NULL-work_item_id row.
	const labelId = getAlertLabelId(project);
	if (labelId) {
		await provider.addLabel(newCard.id, labelId);
	}

	const destination = getAlertsStatusDestination(project);
	if (destination) {
		await provider.moveWorkItem(newCard.id, destination);
	}

	return newCard.id;
}
