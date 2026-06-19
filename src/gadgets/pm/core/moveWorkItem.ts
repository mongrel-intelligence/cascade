import { getPMProvider } from '../../../pm/index.js';
import type { WorkItem } from '../../../pm/types.js';
import { currentTimestamp, pickTimestamp, type WorkItemMovedResult } from './mutationResults.js';

export interface MoveWorkItemParams {
	workItemId: string;
	destination: string;
	/**
	 * Optional pre-move guard. When provided, the gadget fetches the work
	 * item's current status and refuses to move unless it matches (case-
	 * insensitive). Defends against parallel-agent races — e.g. a second
	 * backlog-manager run trying to move an item that's already been
	 * moved out of BACKLOG by a sibling run (incident 2026-05-06, MNG-538).
	 *
	 * If the current status already equals `destination`, the move is
	 * skipped as a no-op (idempotent).
	 */
	expectedSourceState?: string;
}

function normalizeStatus(s: string | undefined): string {
	return (s ?? '').trim().toLowerCase();
}

function matchesStatus(value: string | undefined, expected: string): boolean {
	return normalizeStatus(value) === expected;
}

function isAlreadyInDestination(current: WorkItem, destination: string): boolean {
	const currentStatus = normalizeStatus(current.status);
	const currentStatusId = normalizeStatus(current.statusId);
	return Boolean(
		(currentStatus && currentStatus === destination) ||
			(currentStatusId && currentStatusId === destination),
	);
}

function matchesExpectedSource(current: WorkItem, expected: string): boolean {
	return matchesStatus(current.status, expected) || matchesStatus(current.statusId, expected);
}

function formatCurrentStatus(current: WorkItem): string {
	if (!current.statusId) return current.status ?? 'unknown';
	return `${current.status ?? 'unknown'} (${current.statusId})`;
}

/**
 * Build the previous-status fields for guarded outcomes. Keeps the result
 * keys consistent across `'noop'` / `'aborted'` / `'moved'` returns from the
 * guarded path.
 */
function buildPreviousStatusFields(current: WorkItem): {
	previousStatus?: string;
	previousStatusId?: string;
} {
	const fields: { previousStatus?: string; previousStatusId?: string } = {};
	if (current.status) fields.previousStatus = current.status;
	if (current.statusId) fields.previousStatusId = current.statusId;
	return fields;
}

async function guardedMove(params: MoveWorkItemParams): Promise<WorkItemMovedResult> {
	const provider = getPMProvider();
	const current = await provider.getWorkItem(params.workItemId);
	const expected = normalizeStatus(params.expectedSourceState);
	const destination = normalizeStatus(params.destination);
	const previousStatusFields = buildPreviousStatusFields(current);

	if (isAlreadyInDestination(current, destination)) {
		return {
			status: 'noop',
			id: params.workItemId,
			url: current.url || provider.getWorkItemUrl(params.workItemId),
			destination: params.destination,
			updatedAt: pickTimestamp(current.updatedAt),
			...previousStatusFields,
			message: `Work item already in destination state '${current.status ?? current.statusId}' — no-op`,
		};
	}

	if (!matchesExpectedSource(current, expected)) {
		return {
			status: 'aborted',
			id: params.workItemId,
			url: current.url || provider.getWorkItemUrl(params.workItemId),
			destination: params.destination,
			updatedAt: currentTimestamp(),
			...previousStatusFields,
			message: `Aborted: work item is in '${formatCurrentStatus(current)}', expected '${params.expectedSourceState}' (likely already moved by a parallel agent — skipping to avoid duplicate downstream work)`,
		};
	}

	await provider.moveWorkItem(params.workItemId, params.destination);
	return {
		status: 'moved',
		id: params.workItemId,
		url: current.url || provider.getWorkItemUrl(params.workItemId),
		destination: params.destination,
		updatedAt: pickTimestamp(undefined),
		...previousStatusFields,
	};
}

/**
 * Move a work item to a different list or status.
 *
 * Returns a structured `WorkItemMovedResult` so downstream consumers can
 * branch on shape rather than parsing prose. Three outcomes:
 *   - `'moved'`   — the provider accepted the move.
 *   - `'noop'`    — the work item was already in the destination (guarded
 *     path only).
 *   - `'aborted'` — the work item was in an unexpected source state and the
 *     guarded path refused the move.
 *
 * `expectedSourceState` is the parallel-agent race guard introduced for the
 * MNG-538 incident (2026-05-06). When provided, the gadget fetches the work
 * item's current status and aborts unless it matches (case-insensitive).
 *
 * Runtime provider errors propagate (no internal try/catch) so the CLI
 * factory emits the spec-014 `runtime` envelope and gadget wrappers can wrap
 * with `formatGadgetError`.
 */
export async function moveWorkItem(params: MoveWorkItemParams): Promise<WorkItemMovedResult> {
	if (params.expectedSourceState !== undefined) {
		return guardedMove(params);
	}

	const provider = getPMProvider();
	await provider.moveWorkItem(params.workItemId, params.destination);
	return {
		status: 'moved',
		id: params.workItemId,
		url: provider.getWorkItemUrl(params.workItemId),
		destination: params.destination,
		updatedAt: pickTimestamp(undefined),
	};
}
