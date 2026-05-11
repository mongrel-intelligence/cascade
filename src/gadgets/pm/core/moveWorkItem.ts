import { getPMProvider } from '../../../pm/index.js';
import type { WorkItem } from '../../../pm/types.js';

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

async function guardedMove(params: MoveWorkItemParams): Promise<string> {
	const provider = getPMProvider();
	const current = await provider.getWorkItem(params.workItemId);
	const expected = normalizeStatus(params.expectedSourceState);
	const destination = normalizeStatus(params.destination);

	if (isAlreadyInDestination(current, destination)) {
		return `Work item ${params.workItemId} already in destination state '${current.status ?? current.statusId}' — no-op`;
	}

	if (!matchesExpectedSource(current, expected)) {
		return `Aborted: work item ${params.workItemId} is in '${formatCurrentStatus(current)}', expected '${params.expectedSourceState}' (likely already moved by a parallel agent — skipping to avoid duplicate downstream work)`;
	}

	await provider.moveWorkItem(params.workItemId, params.destination);
	return `Work item ${params.workItemId} moved to ${params.destination} successfully`;
}

export async function moveWorkItem(params: MoveWorkItemParams): Promise<string> {
	try {
		if (params.expectedSourceState !== undefined) {
			return await guardedMove(params);
		}

		await getPMProvider().moveWorkItem(params.workItemId, params.destination);
		return `Work item ${params.workItemId} moved to ${params.destination} successfully`;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Error moving work item: ${message}`);
	}
}
