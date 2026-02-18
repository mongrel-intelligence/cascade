import { clearProgressCommentId, readProgressCommentId } from '../../../backends/progressState.js';
import { getPMProvider } from '../../../pm/index.js';

export async function postComment(workItemId: string, text: string): Promise<string> {
	try {
		const provider = getPMProvider();

		// Check if there is a progress comment we should update instead of creating new
		const progressState = readProgressCommentId();
		if (progressState && progressState.workItemId === workItemId) {
			try {
				await provider.updateComment(workItemId, progressState.commentId, text);
				clearProgressCommentId();
				return 'Comment posted successfully';
			} catch {
				// Fall back to creating a new comment if update fails
				clearProgressCommentId();
			}
		}

		await provider.addComment(workItemId, text);
		return 'Comment posted successfully';
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error posting comment: ${message}`;
	}
}
