/**
 * Unified ToolDefinition objects for all 10 SCM tools.
 *
 * These definitions are the single source of truth for:
 * - Gadget classes (generated via createGadgetClass)
 * - CLI commands (generated via createCLICommand)
 * - JSON Schema manifests (generated via buildManifest)
 */

import { writeFileSync } from 'node:fs';

import { GITHUB_ACK_COMMENT_ID_ENV_VAR } from '../../backends/secretBuilder.js';
import { REVIEW_SIDECAR_ENV_VAR } from '../sessionState.js';
import type { ToolDefinition } from '../shared/toolDefinition.js';

/**
 * Shared owner/repo auto-resolved params used by most SCM tools.
 */
const ownerRepoAutoResolved = [
	{
		paramName: 'owner',
		envVar: 'CASCADE_REPO_OWNER',
		resolvedFrom: 'git-remote' as const,
		description: 'Repository owner (auto-detected)',
	},
	{
		paramName: 'repo',
		envVar: 'CASCADE_REPO_NAME',
		resolvedFrom: 'git-remote' as const,
		description: 'Repository name (auto-detected)',
	},
];

export const createPRDef: ToolDefinition = {
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
	parameters: {
		comment: {
			type: 'string',
			describe: 'Brief rationale for this gadget call',
			required: true,
			gadgetOnly: true,
		},
		title: {
			type: 'string',
			describe: 'The pull request title (also used as commit message if committing)',
			required: true,
		},
		body: {
			type: 'string',
			describe: 'The pull request description (supports GitHub markdown)',
			required: true,
		},
		head: {
			type: 'string',
			describe: 'The name of the branch where your changes are implemented',
			required: true,
		},
		base: {
			type: 'string',
			describe: 'Target branch name (defaults to CASCADE_BASE_BRANCH env var)',
			optional: true,
			cliEnvVar: 'CASCADE_BASE_BRANCH',
		},
		draft: {
			type: 'boolean',
			describe: 'Create as a draft pull request (default: false)',
			optional: true,
		},
		commit: {
			type: 'boolean',
			describe: 'Stage and commit all changes before pushing (default: true)',
			optional: true,
			default: true,
			allowNo: true,
		},
		commitMessage: {
			type: 'string',
			describe: 'Custom commit message (default: uses PR title)',
			optional: true,
		},
		push: {
			type: 'boolean',
			describe: 'Push the branch to remote before creating PR (default: true)',
			optional: true,
			default: true,
			allowNo: true,
		},
	},
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
	cli: {
		fileInputAlternatives: [
			{
				paramName: 'body',
				fileFlag: 'body-file',
				description: 'Read PR body from file (use - for stdin)',
			},
		],
	},
};

export const createPRReviewDef: ToolDefinition = {
	name: 'CreatePRReview',
	description:
		'Submit a code review on a GitHub pull request. Use this to approve, request changes, or comment on the PR.',
	timeoutMs: 30000,
	parameters: {
		comment: {
			type: 'string',
			describe: 'Brief rationale for this gadget call',
			required: true,
			gadgetOnly: true,
		},
		owner: {
			type: 'string',
			describe: 'The repository owner (username or organization)',
			required: true,
			cliEnvVar: 'CASCADE_REPO_OWNER',
		},
		repo: {
			type: 'string',
			describe: 'The repository name',
			required: true,
			cliEnvVar: 'CASCADE_REPO_NAME',
		},
		prNumber: {
			type: 'number',
			describe: 'The pull request number',
			required: true,
		},
		event: {
			type: 'enum',
			options: ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'],
			describe: 'The review action: APPROVE, REQUEST_CHANGES, or COMMENT',
			required: true,
		},
		body: {
			type: 'string',
			describe: 'Overall review summary (supports markdown)',
			required: true,
		},
		comments: {
			type: 'object',
			describe:
				'Optional inline comments on specific files/lines ([{"path":"file","line":1,"body":"comment"}])',
			optional: true,
		},
	},
	examples: [
		{
			params: {
				comment: 'Approving PR after thorough review',
				owner: 'acme',
				repo: 'myapp',
				prNumber: 42,
				event: 'APPROVE',
				body: 'LGTM! The implementation is clean and well-tested.',
			},
			comment: 'Approve a PR with a summary',
		},
		{
			params: {
				comment: 'Requesting changes for identified issues',
				owner: 'acme',
				repo: 'myapp',
				prNumber: 42,
				event: 'REQUEST_CHANGES',
				body: 'Good progress, but a few issues need to be addressed before merging.',
				comments: [
					{
						path: 'src/utils.ts',
						line: 15,
						body: 'This could cause a null pointer exception. Please add a null check.',
					},
				],
			},
			comment: 'Request changes with inline comments',
		},
	],
	cli: {
		autoResolved: ownerRepoAutoResolved,
		postExecute: async (result, flags) => {
			const reviewResult = result as { reviewUrl: string };

			// Delete the GitHub ack/progress comment immediately after successful review submission.
			// This mirrors what the llmist backend's CreatePRReview gadget does via deleteInitialComment().
			// In the claude-code backend, the parent process cannot delete it in-process, so we do it here.
			let ackCommentDeleted = false;
			const ackCommentIdStr = process.env[GITHUB_ACK_COMMENT_ID_ENV_VAR];
			if (ackCommentIdStr) {
				const ackCommentId = Number(ackCommentIdStr);
				if (Number.isFinite(ackCommentId) && ackCommentId > 0) {
					try {
						const owner = flags.owner as string;
						const repo = flags.repo as string;
						const { githubClient } = await import('../../github/client.js');
						await githubClient.deletePRComment(owner, repo, ackCommentId);
						ackCommentDeleted = true;
					} catch {
						// Best-effort — deletion failure should not prevent the review from being reported
					}
				}
			}

			// Persist review data for the parent process (backend adapter)
			// to read and populate session state post-execution.
			const sidecarPath = process.env[REVIEW_SIDECAR_ENV_VAR];
			if (sidecarPath) {
				try {
					writeFileSync(
						sidecarPath,
						JSON.stringify({
							reviewUrl: reviewResult.reviewUrl,
							event: flags.event,
							body: flags.body,
							...(ackCommentDeleted && { ackCommentDeleted: true }),
						}),
					);
				} catch {
					// Best-effort — don't fail the review on sidecar write failure
				}
			}
		},
	},
};

export const getPRDetailsDef: ToolDefinition = {
	name: 'GetPRDetails',
	description:
		'Get details about a GitHub pull request including title, description, and branch info.',
	timeoutMs: 30000,
	parameters: {
		comment: {
			type: 'string',
			describe: 'Brief rationale for this gadget call',
			required: true,
			gadgetOnly: true,
		},
		owner: {
			type: 'string',
			describe: 'The repository owner (username or organization)',
			required: true,
			cliEnvVar: 'CASCADE_REPO_OWNER',
		},
		repo: {
			type: 'string',
			describe: 'The repository name',
			required: true,
			cliEnvVar: 'CASCADE_REPO_NAME',
		},
		prNumber: {
			type: 'number',
			describe: 'The pull request number',
			required: true,
		},
	},
	examples: [
		{
			params: {
				comment: 'Fetching PR details to understand changes',
				owner: 'acme',
				repo: 'myapp',
				prNumber: 42,
			},
			comment: 'Get details for PR #42',
		},
	],
	cli: {
		autoResolved: ownerRepoAutoResolved,
	},
};

export const getPRDiffDef: ToolDefinition = {
	name: 'GetPRDiff',
	description:
		'Get the unified diff of all file changes in a GitHub pull request. Shows each file with additions, deletions, and the patch content.',
	timeoutMs: 30000,
	parameters: {
		comment: {
			type: 'string',
			describe: 'Brief rationale for this gadget call',
			required: true,
			gadgetOnly: true,
		},
		owner: {
			type: 'string',
			describe: 'The repository owner (username or organization)',
			required: true,
			cliEnvVar: 'CASCADE_REPO_OWNER',
		},
		repo: {
			type: 'string',
			describe: 'The repository name',
			required: true,
			cliEnvVar: 'CASCADE_REPO_NAME',
		},
		prNumber: {
			type: 'number',
			describe: 'The pull request number',
			required: true,
		},
	},
	examples: [
		{
			params: {
				comment: 'Reviewing file changes for code review',
				owner: 'acme',
				repo: 'myapp',
				prNumber: 42,
			},
			comment: 'Get all file changes in PR #42',
		},
	],
	cli: {
		autoResolved: ownerRepoAutoResolved,
	},
};

export const getPRChecksDef: ToolDefinition = {
	name: 'GetPRChecks',
	description:
		'Get the CI check status for a GitHub pull request. Shows all workflow runs and their status/conclusion.',
	timeoutMs: 30000,
	parameters: {
		comment: {
			type: 'string',
			describe: 'Brief rationale for this gadget call',
			required: true,
			gadgetOnly: true,
		},
		owner: {
			type: 'string',
			describe: 'The repository owner (username or organization)',
			required: true,
			cliEnvVar: 'CASCADE_REPO_OWNER',
		},
		repo: {
			type: 'string',
			describe: 'The repository name',
			required: true,
			cliEnvVar: 'CASCADE_REPO_NAME',
		},
		prNumber: {
			type: 'number',
			describe: 'The pull request number',
			required: true,
		},
	},
	examples: [
		{
			params: {
				comment: 'Checking CI status before merge',
				owner: 'acme',
				repo: 'myapp',
				prNumber: 42,
			},
			comment: 'Get CI check status for PR #42',
		},
	],
	cli: {
		autoResolved: ownerRepoAutoResolved,
	},
};

export const getPRCommentsDef: ToolDefinition = {
	name: 'GetPRComments',
	description:
		'Get all review comments on a GitHub pull request. Use this to understand what feedback has been given.',
	timeoutMs: 30000,
	parameters: {
		comment: {
			type: 'string',
			describe: 'Brief rationale for this gadget call',
			required: true,
			gadgetOnly: true,
		},
		owner: {
			type: 'string',
			describe: 'The repository owner (username or organization)',
			required: true,
			cliEnvVar: 'CASCADE_REPO_OWNER',
		},
		repo: {
			type: 'string',
			describe: 'The repository name',
			required: true,
			cliEnvVar: 'CASCADE_REPO_NAME',
		},
		prNumber: {
			type: 'number',
			describe: 'The pull request number',
			required: true,
		},
	},
	examples: [
		{
			params: {
				comment: 'Fetching review comments to understand feedback',
				owner: 'acme',
				repo: 'myapp',
				prNumber: 42,
			},
			comment: 'Get all review comments on PR #42',
		},
	],
	cli: {
		autoResolved: ownerRepoAutoResolved,
	},
};

export const postPRCommentDef: ToolDefinition = {
	name: 'PostPRComment',
	description:
		'Post a comment on a GitHub pull request. Use this for general PR comments (not replies to review comments).',
	timeoutMs: 30000,
	parameters: {
		comment: {
			type: 'string',
			describe: 'Brief rationale for this gadget call',
			required: true,
			gadgetOnly: true,
		},
		owner: {
			type: 'string',
			describe: 'The repository owner (username or organization)',
			required: true,
			cliEnvVar: 'CASCADE_REPO_OWNER',
		},
		repo: {
			type: 'string',
			describe: 'The repository name',
			required: true,
			cliEnvVar: 'CASCADE_REPO_NAME',
		},
		prNumber: {
			type: 'number',
			describe: 'The pull request number',
			required: true,
		},
		body: {
			type: 'string',
			describe: 'The comment body (supports markdown)',
			required: true,
		},
	},
	examples: [
		{
			params: {
				comment: 'Acknowledging review feedback',
				owner: 'acme',
				repo: 'myapp',
				prNumber: 42,
				body: '🤖 Working on addressing the review feedback...',
			},
			comment: 'Post a status comment on the PR',
		},
	],
	cli: {
		autoResolved: ownerRepoAutoResolved,
		fileInputAlternatives: [
			{
				paramName: 'body',
				fileFlag: 'body-file',
				description: 'Read comment body from file (use - for stdin)',
			},
		],
	},
};

export const updatePRCommentDef: ToolDefinition = {
	name: 'UpdatePRComment',
	description:
		'Update an existing comment on a GitHub pull request. Use this to update a previously posted comment with new information.',
	timeoutMs: 30000,
	parameters: {
		comment: {
			type: 'string',
			describe: 'Brief rationale for this gadget call',
			required: true,
			gadgetOnly: true,
		},
		owner: {
			type: 'string',
			describe: 'The repository owner (username or organization)',
			required: true,
			cliEnvVar: 'CASCADE_REPO_OWNER',
		},
		repo: {
			type: 'string',
			describe: 'The repository name',
			required: true,
			cliEnvVar: 'CASCADE_REPO_NAME',
		},
		commentId: {
			type: 'number',
			describe: 'The ID of the comment to update',
			required: true,
		},
		body: {
			type: 'string',
			describe: 'The new comment body (supports markdown)',
			required: true,
		},
	},
	examples: [
		{
			params: {
				comment: 'Updating status after addressing feedback',
				owner: 'acme',
				repo: 'myapp',
				commentId: 123456789,
				body: '✅ All review feedback has been addressed. Changes pushed.',
			},
			comment: 'Update an existing comment with completion status',
		},
	],
	cli: {
		autoResolved: ownerRepoAutoResolved,
	},
};

export const replyToReviewCommentDef: ToolDefinition = {
	name: 'ReplyToReviewComment',
	description:
		'Reply to a specific review comment on a GitHub pull request. Use this to acknowledge feedback and explain what was fixed.',
	timeoutMs: 30000,
	parameters: {
		comment: {
			type: 'string',
			describe: 'Brief rationale for this gadget call',
			required: true,
			gadgetOnly: true,
		},
		owner: {
			type: 'string',
			describe: 'The repository owner (username or organization)',
			required: true,
			cliEnvVar: 'CASCADE_REPO_OWNER',
		},
		repo: {
			type: 'string',
			describe: 'The repository name',
			required: true,
			cliEnvVar: 'CASCADE_REPO_NAME',
		},
		prNumber: {
			type: 'number',
			describe: 'The pull request number',
			required: true,
		},
		commentId: {
			type: 'number',
			describe: 'The ID of the comment to reply to',
			required: true,
		},
		body: {
			type: 'string',
			describe: 'The reply message (supports markdown)',
			required: true,
		},
	},
	examples: [
		{
			params: {
				comment: 'Responding to review feedback about edge cases',
				owner: 'acme',
				repo: 'myapp',
				prNumber: 42,
				commentId: 123456,
				body: 'Fixed! I updated the function to handle edge cases properly.',
			},
			comment: 'Reply to review comment explaining the fix',
		},
	],
	cli: {
		autoResolved: ownerRepoAutoResolved,
	},
};

export const getCIRunLogsDef: ToolDefinition = {
	name: 'GetCIRunLogs',
	description:
		'Get failed CI workflow run info for a given commit ref. Shows failed jobs and failed steps. Use Tmux to run specific commands locally for detailed error output.',
	timeoutMs: 60000,
	parameters: {
		comment: {
			type: 'string',
			describe: 'Brief rationale for this gadget call',
			required: true,
			gadgetOnly: true,
		},
		owner: {
			type: 'string',
			describe: 'The repository owner (username or organization)',
			required: true,
			cliEnvVar: 'CASCADE_REPO_OWNER',
		},
		repo: {
			type: 'string',
			describe: 'The repository name',
			required: true,
			cliEnvVar: 'CASCADE_REPO_NAME',
		},
		ref: {
			type: 'string',
			describe: 'The commit SHA (head SHA of the PR)',
			required: true,
		},
	},
	examples: [
		{
			params: {
				comment: 'Fetching failed CI logs to diagnose test failures',
				owner: 'acme',
				repo: 'myapp',
				ref: 'abc1234567890',
			},
			comment: 'Get failed CI run logs for the PR head commit',
		},
	],
	cli: {
		autoResolved: ownerRepoAutoResolved,
	},
};
