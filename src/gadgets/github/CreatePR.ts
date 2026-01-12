import { Gadget, z } from 'llmist';
import { githubClient } from '../../github/client.js';
import { formatGadgetError } from '../utils.js';

export class CreatePR extends Gadget({
	name: 'CreatePR',
	description: `Create a GitHub pull request via the API. Use this instead of 'gh pr create' CLI command.

IMPORTANT: Before calling this gadget:
1. Commit all your changes to the branch
2. Push the branch to remote: git push -u origin <branch-name>

The PR body supports full GitHub-flavored markdown including:
- Headers, lists, code blocks
- Task lists with checkboxes
- Links and mentions
- Tables`,
	timeoutMs: 30000,
	schema: z.object({
		owner: z.string().describe('The repository owner (username or organization)'),
		repo: z.string().describe('The repository name'),
		title: z.string().describe('The pull request title'),
		body: z.string().describe('The pull request description (supports GitHub markdown)'),
		head: z.string().describe('The name of the branch where your changes are implemented'),
		base: z
			.string()
			.describe('The name of the branch you want the changes pulled into (usually "main")'),
		draft: z.boolean().optional().describe('Create as a draft pull request (default: false)'),
	}),
	examples: [
		{
			params: {
				owner: 'acme',
				repo: 'myapp',
				title: 'feat: add user authentication',
				body: '## Summary\n\nAdds OAuth2 authentication flow.\n\n## Changes\n\n- Added login page\n- Integrated with auth provider\n- Added session management',
				head: 'feature/auth',
				base: 'main',
			},
			comment: 'Create a PR with markdown body',
		},
		{
			params: {
				owner: 'acme',
				repo: 'myapp',
				title: 'fix: resolve null pointer in checkout',
				body: 'Fixes #123\n\nAdded null check before accessing cart items.',
				head: 'fix/checkout-null',
				base: 'develop',
				draft: true,
			},
			comment: 'Create a draft PR targeting develop branch',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		try {
			// Verify the branch exists before attempting to create PR
			const branchExists = await githubClient.branchExists(params.owner, params.repo, params.head);
			if (!branchExists) {
				return `Error creating pull request: Branch '${params.head}' does not exist on remote. Ensure 'git push -u origin ${params.head}' completed successfully before creating a PR.`;
			}

			const pr = await githubClient.createPR(params.owner, params.repo, {
				title: params.title,
				body: params.body,
				head: params.head,
				base: params.base,
				draft: params.draft,
			});
			const draftLabel = params.draft ? ' (draft)' : '';
			return `PR #${pr.number} created successfully${draftLabel}: ${pr.htmlUrl}`;
		} catch (error) {
			return formatGadgetError('creating pull request', error);
		}
	}
}
