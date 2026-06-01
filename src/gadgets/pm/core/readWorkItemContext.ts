import { getPMProvider } from '../../../pm/index.js';
import { pickTimestamp } from './mutationResults.js';

/**
 * Shared read-back helper used by PM mutation cores (`addChecklist`,
 * `updateChecklistItem`, `deleteChecklistItem`, `updateWorkItem`,
 * `postComment`) to surface the parent work-item's URL + `updatedAt` (and,
 * for callers that need it, `title`) on the structured result.
 *
 * Implements the technical-notes pattern from MNG-1424: "Use work-item
 * read-back for URL/status/timestamp where provider APIs do not return deep
 * checklist links." The Trello, JIRA, and Linear adapters all surface
 * `updatedAt` on `WorkItem` when the provider reports it.
 *
 * Read-back failure handling: the calling mutation has ALREADY succeeded by
 * the time this helper runs. Propagating a read-back exception would mask the
 * mutation success and risk an idempotency retry storm — especially on the
 * native-checklist provider (Trello) where a retried `addChecklistItem`
 * duplicates rows. We therefore swallow the read-back error and fall back to
 * the synchronous `getWorkItemUrl(id)` constructor plus a synthesised current
 * ISO timestamp. The mutation success is preserved; the timestamp is just
 * synthesised rather than provider-supplied. `title` is `undefined` on the
 * fallback path because the synchronous `getWorkItemUrl` surface only returns
 * a URL.
 */
export async function readWorkItemContext(workItemId: string): Promise<{
	workItemUrl: string;
	updatedAt: string;
	title?: string;
}> {
	const provider = getPMProvider();
	try {
		const item = await provider.getWorkItem(workItemId);
		return {
			workItemUrl: item.url,
			updatedAt: pickTimestamp(item.updatedAt),
			title: item.title,
		};
	} catch {
		return {
			workItemUrl: provider.getWorkItemUrl(workItemId),
			updatedAt: pickTimestamp(undefined),
		};
	}
}
