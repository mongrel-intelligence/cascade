import { readFileSync } from 'node:fs';
import { Flags } from '@oclif/core';
import { createPR } from '../../gadgets/github/core/createPR.js';
import { CredentialScopedCommand } from '../base.js';

export default class CreatePR extends CredentialScopedCommand {
	static override description = 'Create a GitHub pull request with optional commit and push.';

	static override flags = {
		title: Flags.string({ description: 'PR title', required: true }),
		body: Flags.string({ description: 'PR description (markdown supported)' }),
		'body-file': Flags.string({
			description: 'Read PR body from file (use - for stdin)',
		}),
		head: Flags.string({ description: 'Source branch name', required: true }),
		base: Flags.string({
			description: 'Target branch name (defaults to CASCADE_BASE_BRANCH env var)',
			env: 'CASCADE_BASE_BRANCH',
		}),
		draft: Flags.boolean({ description: 'Create as draft PR', default: false }),
		commit: Flags.boolean({
			description: 'Stage and commit changes before pushing',
			default: true,
			allowNo: true,
		}),
		'commit-message': Flags.string({ description: 'Custom commit message' }),
		push: Flags.boolean({
			description: 'Push branch to remote before creating PR',
			default: true,
			allowNo: true,
		}),
	};

	async execute(): Promise<void> {
		const { flags } = await this.parse(CreatePR);
		const base = flags.base;
		if (!base) {
			this.error('--base is required (or set CASCADE_BASE_BRANCH env var)');
		}
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
		const result = await createPR({
			title: flags.title,
			body,
			head: flags.head,
			base,
			draft: flags.draft,
			commit: flags.commit,
			commitMessage: flags['commit-message'],
			push: flags.push,
		});
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
