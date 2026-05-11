import { getPMProvider } from '../../../pm/index.js';

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

export async function moveWorkItem(params: MoveWorkItemParams): Promise<string> {
	try {
		if (params.expectedSourceState !== undefined) {
			const provider = getPMProvider();
			const current = await provider.getWorkItem(params.workItemId);
			const currentStatus = normalizeStatus(current.status);
			const expected = normalizeStatus(params.expectedSourceState);
			const destination = normalizeStatus(params.destination);

			if (currentStatus && currentStatus === destination) {
				return `Work item ${params.workItemId} already in destination state '${current.status}' — no-op`;
			}

			if (currentStatus !== expected) {
				return `Aborted: work item ${params.workItemId} is in '${current.status ?? 'unknown'}', expected '${params.expectedSourceState}' (likely already moved by a parallel agent — skipping to avoid duplicate downstream work)`;
			}

			await provider.moveWorkItem(params.workItemId, params.destination);
			return `Work item ${params.workItemId} moved to ${params.destination} successfully`;
		}

		await getPMProvider().moveWorkItem(params.workItemId, params.destination);
		return `Work item ${params.workItemId} moved to ${params.destination} successfully`;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Error moving work item: ${message}`);
	}
}
