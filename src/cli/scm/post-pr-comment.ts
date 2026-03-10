import { readFileSync } from 'node:fs';
import { Flags } from '@oclif/core';
import { postPRComment } from '../../gadgets/github/core/postPRComment.js';
import { CredentialScopedCommand, resolveOwnerRepo } from '../base.js';

export default class PostPRComment extends CredentialScopedCommand {
	static override description = 'Post a comment on a GitHub pull request.';

	static override flags = {
		owner: Flags.string({
			description: 'Repository owner (auto-detected)',
			env: 'CASCADE_REPO_OWNER',
		}),
		repo: Flags.string({
			description: 'Repository name (auto-detected)',
			env: 'CASCADE_REPO_NAME',
		}),
		prNumber: Flags.integer({ description: 'The pull request number', required: true }),
		body: Flags.string({ description: 'Comment body (markdown supported)' }),
		'body-file': Flags.string({
			description: 'Read comment body from file (use - for stdin)',
		}),
	};

	async execute(): Promise<void> {
		const { flags } = await this.parse(PostPRComment);
		const { owner, repo } = resolveOwnerRepo(flags.owner, flags.repo);
		let body = flags.body;
		if (flags['body-file']) {
			body =
				flags['body-file'] === '-'
					? readFileSync(0, 'utf-8')
					: readFileSync(flags['body-file'], 'utf-8');
		}
		if (!body) {
			this.error('Either --body or --body-file is required');
		}
		const result = await postPRComment(owner, repo, flags.prNumber, body);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
