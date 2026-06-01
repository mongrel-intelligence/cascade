import { clearProgressCommentId, readProgressCommentId } from '../../../backends/progressState.js';
import { getPMProvider } from '../../../pm/index.js';
import { logger } from '../../../utils/logging.js';
import { buildRunLinkFooterFromEnv } from '../../../utils/runLink.js';
import { type CommentPostedResult, currentTimestamp } from './mutationResults.js';
import { readWorkItemContext } from './readWorkItemContext.js';

/**
 * Post a comment on a work item, or replace the progress-comment when one was
 * pre-seeded for this work item.
 *
 * Returns a structured `CommentPostedResult` so downstream consumers can
 * branch on shape rather than parsing prose. Two outcomes:
 *   - `'created'` — a new comment was added via `provider.addComment`.
 *   - `'updated'` — the existing progress comment (id read from
 *     `CASCADE_PROGRESS_COMMENT_ID`) was replaced via
 *     `provider.updateComment`. Falls back to `'created'` if the update fails
 *     so a stale progress-comment id never blocks a real comment.
 *
 * The result carries the parent work-item context (`workItemId`,
 * `workItemUrl`) so downstream consumers can correlate the comment back to
 * its parent without re-parsing IDs.
 *
 * `updatedAt` is synthesised via `currentTimestamp()` because the
 * `PMProvider.addComment` / `updateComment` interface returns only an ID,
 * not the full comment record. The synthetic "now" closely tracks the
 * provider-side write (the call just returned).
 *
 * Runtime provider errors propagate (no internal try/catch wrapping) per the
 * MNG-1423 contract — the CLI factory wraps thrown errors in the spec-014
 * `runtime` envelope and gadget wrappers can wrap with `formatGadgetError`.
 */
export async function postComment(workItemId: string, text: string): Promise<CommentPostedResult> {
	const provider = getPMProvider();

	// Append run link footer when enabled via env vars (injected by secretBuilder for subprocesses)
	const runLinkFooter = buildRunLinkFooterFromEnv(workItemId);
	const fullText = runLinkFooter ? text + runLinkFooter : text;

	// Check if there is a progress comment we should update instead of creating new
	const progressState = readProgressCommentId();
	if (progressState && progressState.workItemId === workItemId) {
		try {
			await provider.updateComment(workItemId, progressState.commentId, fullText);
			clearProgressCommentId();
			const { workItemUrl } = await readWorkItemContext(workItemId);
			return {
				status: 'updated',
				id: progressState.commentId,
				workItemId,
				workItemUrl,
				updatedAt: currentTimestamp(),
			};
		} catch (error) {
			// Fall back to creating a new comment if update fails
			logger.warn('Failed to update progress comment, creating new one', {
				workItemId,
				commentId: progressState.commentId,
				error: error instanceof Error ? error.message : String(error),
			});
			clearProgressCommentId();
		}
	}

	const commentId = await provider.addComment(workItemId, fullText);
	const { workItemUrl } = await readWorkItemContext(workItemId);
	return {
		status: 'created',
		id: commentId,
		workItemId,
		workItemUrl,
		updatedAt: currentTimestamp(),
	};
}
