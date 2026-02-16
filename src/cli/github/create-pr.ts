import { Flags } from '@oclif/core';
import { createPR } from '../../gadgets/github/core/createPR.js';
import { CredentialScopedCommand } from '../base.js';

export default class CreatePR extends CredentialScopedCommand {
	static override description = 'Create a GitHub pull request with optional commit and push.';

	static override flags = {
		title: Flags.string({ description: 'PR title', required: true }),
		body: Flags.string({ description: 'PR description (markdown supported)', required: true }),
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
		const result = await createPR({
			title: flags.title,
			body: flags.body,
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
