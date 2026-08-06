import { gitlabClient } from '../../../gitlab/client.js';

export async function getMRNotes(projectPath: string, mrIid: number): Promise<string> {
	try {
		const notes = await gitlabClient.getMRNotes(projectPath, mrIid);

		// Filter out system notes for cleaner output
		const userNotes = notes.filter((n) => !n.system);

		if (userNotes.length === 0) {
			return 'No user comments on this MR.';
		}

		const formatted = userNotes.map((n) => {
			const resolvedTag = n.resolvable ? (n.resolved ? ' [resolved]' : ' [unresolved]') : '';
			return [`**@${n.author.username}** (${n.createdAt})${resolvedTag}:`, n.body].join('\n');
		});

		return `${userNotes.length} comment(s):\n\n${formatted.join('\n\n---\n\n')}`;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error fetching MR notes: ${message}`;
	}
}
