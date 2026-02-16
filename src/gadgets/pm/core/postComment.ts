import { getPMProvider } from '../../../pm/index.js';

export async function postComment(workItemId: string, text: string): Promise<string> {
	try {
		await getPMProvider().addComment(workItemId, text);
		return 'Comment posted successfully';
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error posting comment: ${message}`;
	}
}
