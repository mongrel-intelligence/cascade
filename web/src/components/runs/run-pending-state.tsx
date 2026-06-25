import { Loader2 } from 'lucide-react';

/** Default subtext shown beneath the "Run is starting…" heading. */
const DEFAULT_PENDING_MESSAGE =
	'This page will update automatically once the run begins (usually a few seconds).';

interface RunPendingStateProps {
	/**
	 * Optional override for the subtext shown beneath the heading. Lets callers
	 * (e.g. the work-item runs page) reuse the same pending visual with copy
	 * tailored to their context.
	 */
	message?: string;
}

/**
 * Pending placeholder rendered while a freshly-dispatched run row is still being
 * materialized by the worker pipeline.
 *
 * A freshly-shared `/runs/<id>` link can point at a run row that does not exist
 * yet — the window between "URL shared in a GitHub/PM comment" and "worker
 * commits the run row". Showing this "Run is starting…" state (and polling
 * within a bounded grace window) avoids a misleading instant "Run not found".
 *
 * Reused by the run-detail page (`/runs/$runId`) and the work-item runs page.
 */
export function RunPendingState({ message }: RunPendingStateProps) {
	return (
		<div className="py-8 text-center text-muted-foreground">
			<Loader2 className="mx-auto h-6 w-6 animate-spin" aria-hidden="true" />
			<h2 className="mt-3 text-sm font-medium text-foreground">Run is starting…</h2>
			<p className="mt-1 text-sm">{message ?? DEFAULT_PENDING_MESSAGE}</p>
		</div>
	);
}
