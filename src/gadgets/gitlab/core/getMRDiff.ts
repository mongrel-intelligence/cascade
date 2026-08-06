import { gitlabClient } from '../../../gitlab/client.js';

export async function getMRDiff(projectPath: string, mrIid: number): Promise<string> {
	try {
		const files = await gitlabClient.getMRDiff(projectPath, mrIid);

		if (files.length === 0) {
			return 'No files changed in this MR.';
		}

		const formatted = files.map((f) => {
			const status = f.newFile
				? 'added'
				: f.deletedFile
					? 'deleted'
					: f.renamedFile
						? `renamed (${f.oldPath} -> ${f.newPath})`
						: 'modified';

			const lines = [`## ${f.newPath}`, `Status: ${status}`];
			if (f.diff) {
				lines.push('```diff', f.diff, '```');
			} else {
				lines.push('[Binary file or too large to display]');
			}
			return lines.join('\n');
		});

		return `${files.length} file(s) changed:\n\n${formatted.join('\n\n')}`;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error fetching MR diff: ${message}`;
	}
}
