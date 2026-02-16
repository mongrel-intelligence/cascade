import { Command } from '@oclif/core';
import { withGitHubToken } from '../github/client.js';
import { withTrelloCredentials } from '../trello/client.js';

export abstract class CredentialScopedCommand extends Command {
	/** Subclasses implement this instead of run() */
	abstract execute(): Promise<void>;

	async run(): Promise<void> {
		const githubToken = process.env.GITHUB_TOKEN;
		const trelloApiKey = process.env.TRELLO_API_KEY;
		const trelloToken = process.env.TRELLO_TOKEN;

		let fn: () => Promise<void> = () => this.execute();

		if (githubToken) {
			const prev = fn;
			fn = () => withGitHubToken(githubToken, prev);
		}
		if (trelloApiKey && trelloToken) {
			const prev = fn;
			fn = () => withTrelloCredentials({ apiKey: trelloApiKey, token: trelloToken }, prev);
		}

		await fn();
	}
}
