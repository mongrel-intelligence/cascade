import { Gadget, z } from 'llmist';
import { githubClient } from '../../github/client.js';
import { runCommand } from '../../utils/repo.js';
import { recordPRCreation } from '../sessionState.js';

export class CreatePR extends Gadget({
	name: 'CreatePR',
	description: `Create a GitHub pull request. Handles the full workflow: commit → push → create PR.

By default, this gadget will:
1. Stage and commit all changes (using the PR title as commit message)
2. Push the branch to remote
3. Create the pull request

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
		owner: z.string().describe('The repository owner (username or organization)'),
		repo: z.string().describe('The repository name'),
		title: z
			.string()
			.describe('The pull request title (also used as commit message if committing)'),
		body: z.string().describe('The pull request description (supports GitHub markdown)'),
		head: z.string().describe('The name of the branch where your changes are implemented'),
		base: z
			.string()
			.describe(
				'The name of the branch you want the changes pulled into (use the base branch specified in your system prompt)',
			),
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
				owner: 'acme',
				repo: 'myapp',
				title: 'feat: add user authentication',
				body: '## Summary\n\nAdds OAuth2 authentication flow.\n\n## Changes\n\n- Added login page\n- Integrated with auth provider\n- Added session management',
				head: 'feature/auth',
				base: 'dev',
			},
			comment: 'Full workflow: commits all changes, pushes, and creates PR against dev branch',
		},
		{
			params: {
				comment: 'Creating draft PR for early feedback',
				owner: 'acme',
				repo: 'myapp',
				title: 'fix: resolve null pointer in checkout',
				body: 'Fixes #123\n\nAdded null check before accessing cart items.',
				head: 'fix/checkout-null',
				base: 'develop',
				draft: true,
				commitMessage: 'fix(checkout): add null check for cart items',
			},
			comment: 'Create a draft PR with custom commit message',
		},
		{
			params: {
				comment: 'Creating PR - already committed and pushed',
				owner: 'acme',
				repo: 'myapp',
				title: 'chore: update dependencies',
				body: 'Updated all dependencies to latest versions.',
				head: 'chore/deps',
				base: 'main',
				commit: false,
				push: false,
			},
			comment: 'Skip commit and push if already done manually',
		},
	],
}) {
	private async stageAndCommit(commitMessage: string): Promise<void> {
		// Stage all changes
		const addResult = await runCommand('git', ['add', '.'], process.cwd());
		if (addResult.exitCode !== 0) {
			throw new Error(`Failed to stage changes: ${addResult.stderr || addResult.stdout}`.trim());
		}

		// Check if there are changes to commit
		const statusResult = await runCommand('git', ['status', '--porcelain'], process.cwd());
		if (statusResult.stdout.trim() === '') {
			return; // No changes to commit - already committed
		}

		// Commit the changes (pre-commit hooks may run here)
		const commitResult = await runCommand('git', ['commit', '-m', commitMessage], process.cwd());
		if (commitResult.exitCode !== 0) {
			const output = [commitResult.stdout, commitResult.stderr].filter(Boolean).join('\n').trim();
			throw new Error(
				`COMMIT FAILED (pre-commit hooks may have failed)\n\n--- OUTPUT ---\n${output}`,
			);
		}
	}

	private async pushBranch(branch: string): Promise<void> {
		// Push the branch (pre-push hooks may run here)
		const pushResult = await runCommand('git', ['push', '-u', 'origin', branch], process.cwd());
		if (pushResult.exitCode !== 0) {
			const output = [pushResult.stdout, pushResult.stderr].filter(Boolean).join('\n').trim();
			throw new Error(
				`PUSH FAILED for branch '${branch}' (pre-push hooks may have failed)\n\n--- OUTPUT ---\n${output}`,
			);
		}
	}

	override async execute(params: this['params']): Promise<string> {
		const commitMessage = params.commitMessage || params.title;

		if (params.commit !== false) {
			await this.stageAndCommit(commitMessage);
		}

		if (params.push !== false) {
			await this.pushBranch(params.head);
		}

		// Verify the branch exists before attempting to create PR
		const branchExists = await githubClient.branchExists(params.owner, params.repo, params.head);
		if (!branchExists) {
			throw new Error(
				`Branch '${params.head}' does not exist on remote. Push the branch first or set push=true.`,
			);
		}

		const pr = await githubClient.createPR(params.owner, params.repo, {
			title: params.title,
			body: params.body,
			head: params.head,
			base: params.base,
			draft: params.draft,
		});
		const draftLabel = params.draft ? ' (draft)' : '';

		// Record PR creation for session state (Finish gadget uses this to verify implementation completed)
		recordPRCreation(pr.htmlUrl);

		return `PR #${pr.number} created successfully${draftLabel}: ${pr.htmlUrl}`;
	}
}
