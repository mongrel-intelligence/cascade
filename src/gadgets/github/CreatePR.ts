import { Gadget, z } from 'llmist';
import { getBaseBranch, recordPRCreation } from '../sessionState.js';
import { createPR } from './core/createPR.js';

export class CreatePR extends Gadget({
	name: 'CreatePR',
	description: `Create a GitHub pull request. Handles the full workflow: commit → push → create PR.

By default, this gadget will:
1. Stage and commit all changes (using the PR title as commit message)
2. Push the branch to remote
3. Create the pull request

The repository owner and name are auto-detected from the git remote — you do not need to specify them.

Set commit=false if you have already committed your changes.
Set push=false if you have already pushed the branch.

The PR body supports full GitHub-flavored markdown including:
- Headers, lists, code blocks
- Task lists with checkboxes
- Links and mentions
- Tables

NOTE: Pre-commit and pre-push hooks may run tests which can take time.
If hooks fail or timeout, the full output will be shown.`,
	timeoutMs: 240000, // 4 minutes - hooks may run test suites
	schema: z.object({
		comment: z.string().min(1).describe('Brief rationale for this gadget call'),
		title: z
			.string()
			.describe('The pull request title (also used as commit message if committing)'),
		body: z.string().describe('The pull request description (supports GitHub markdown)'),
		head: z.string().describe('The name of the branch where your changes are implemented'),
		draft: z.boolean().optional().describe('Create as a draft pull request (default: false)'),
		commit: z
			.boolean()
			.optional()
			.describe('Stage and commit all changes before pushing (default: true)'),
		commitMessage: z.string().optional().describe('Custom commit message (default: uses PR title)'),
		push: z
			.boolean()
			.optional()
			.describe('Push the branch to remote before creating PR (default: true)'),
	}),
	examples: [
		{
			params: {
				comment: 'Creating PR for completed auth feature',
				title: 'feat: add user authentication',
				body: '## Summary\n\nAdds OAuth2 authentication flow.\n\n## Changes\n\n- Added login page\n- Integrated with auth provider\n- Added session management',
				head: 'feature/auth',
			},
			comment:
				'Full workflow: commits all changes, pushes, and creates PR (base branch is auto-resolved)',
		},
		{
			params: {
				comment: 'Creating draft PR for early feedback',
				title: 'fix: resolve null pointer in checkout',
				body: 'Fixes #123\n\nAdded null check before accessing cart items.',
				head: 'fix/checkout-null',
				draft: true,
				commitMessage: 'fix(checkout): add null check for cart items',
			},
			comment: 'Create a draft PR with custom commit message',
		},
		{
			params: {
				comment: 'Creating PR - already committed and pushed',
				title: 'chore: update dependencies',
				body: 'Updated all dependencies to latest versions.',
				head: 'chore/deps',
				commit: false,
				push: false,
			},
			comment: 'Skip commit and push if already done manually',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		const result = await createPR({
			title: params.title,
			body: params.body,
			head: params.head,
			base: getBaseBranch(),
			draft: params.draft,
			commit: params.commit,
			commitMessage: params.commitMessage,
			push: params.push,
		});

		recordPRCreation(result.prUrl);

		if (result.alreadyExisted) {
			return `PR already exists for this branch: #${result.prNumber} — ${result.prUrl}`;
		}

		const draftLabel = params.draft ? ' (draft)' : '';
		return `PR #${result.prNumber} created successfully${draftLabel}: ${result.prUrl}`;
	}
}
