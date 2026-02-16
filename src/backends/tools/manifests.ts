import type { ToolManifest } from '../types.js';

/**
 * Get the CLI tool manifests for CASCADE-specific tools.
 * These describe the tools available via cascade-tools CLI.
 */
export function getToolManifests(): ToolManifest[] {
	return [
		{
			name: 'ReadWorkItem',
			description:
				'Read a work item (card/issue) with title, description, comments, checklists, and attachments.',
			cliCommand: 'cascade-tools pm read-work-item',
			parameters: {
				workItemId: { type: 'string', required: true },
				includeComments: { type: 'boolean', default: true },
			},
		},
		{
			name: 'PostComment',
			description: 'Post a comment to a work item (card/issue).',
			cliCommand: 'cascade-tools pm post-comment',
			parameters: {
				workItemId: { type: 'string', required: true },
				text: { type: 'string', required: true },
			},
		},
		{
			name: 'UpdateWorkItem',
			description: 'Update a work item title, description, or labels.',
			cliCommand: 'cascade-tools pm update-work-item',
			parameters: {
				workItemId: { type: 'string', required: true },
				title: { type: 'string' },
				description: { type: 'string' },
			},
		},
		{
			name: 'CreateWorkItem',
			description: 'Create a new work item (card/issue).',
			cliCommand: 'cascade-tools pm create-work-item',
			parameters: {
				containerId: { type: 'string', required: true },
				title: { type: 'string', required: true },
			},
		},
		{
			name: 'ListWorkItems',
			description: 'List all work items in a container.',
			cliCommand: 'cascade-tools pm list-work-items',
			parameters: { containerId: { type: 'string', required: true } },
		},
		{
			name: 'AddChecklist',
			description: 'Add a checklist with items to a work item.',
			cliCommand: 'cascade-tools pm add-checklist',
			parameters: {
				workItemId: { type: 'string', required: true },
				name: { type: 'string', required: true },
				items: { type: 'array', required: true },
			},
		},
		{
			name: 'UpdateChecklistItem',
			description: 'Update a checklist item state on a work item.',
			cliCommand: 'cascade-tools pm update-checklist-item',
			parameters: {
				workItemId: { type: 'string', required: true },
				checkItemId: { type: 'string', required: true },
				complete: { type: 'boolean' },
			},
		},
		{
			name: 'CreatePR',
			description:
				'Create a GitHub pull request. Handles the full workflow: stages changes, commits, pushes branch to remote, and creates the PR. ALWAYS use this instead of gh pr create or manual git push. If you have already committed your changes, use --no-commit to skip the commit step.',
			cliCommand: 'cascade-tools github create-pr',
			parameters: {
				title: { type: 'string', required: true },
				body: { type: 'string', required: true },
				head: { type: 'string', required: true },
				base: { type: 'string', required: true },
				'no-commit': {
					type: 'boolean',
					description: 'Skip staging and committing (use when changes are already committed)',
				},
				draft: { type: 'boolean', description: 'Create as draft PR' },
			},
		},
		{
			name: 'GetPRDetails',
			description: 'Get details about a GitHub pull request.',
			cliCommand: 'cascade-tools github get-pr-details',
			parameters: {
				owner: { type: 'string', required: true },
				repo: { type: 'string', required: true },
				prNumber: { type: 'number', required: true },
			},
		},
		{
			name: 'GetPRDiff',
			description: 'Get the unified diff of all file changes in a PR.',
			cliCommand: 'cascade-tools github get-pr-diff',
			parameters: {
				owner: { type: 'string', required: true },
				repo: { type: 'string', required: true },
				prNumber: { type: 'number', required: true },
			},
		},
		{
			name: 'GetPRChecks',
			description: 'Get CI check status for a PR.',
			cliCommand: 'cascade-tools github get-pr-checks',
			parameters: {
				owner: { type: 'string', required: true },
				repo: { type: 'string', required: true },
				prNumber: { type: 'number', required: true },
			},
		},
		{
			name: 'GetPRComments',
			description: 'Get all review comments on a PR.',
			cliCommand: 'cascade-tools github get-pr-comments',
			parameters: {
				owner: { type: 'string', required: true },
				repo: { type: 'string', required: true },
				prNumber: { type: 'number', required: true },
			},
		},
		{
			name: 'PostPRComment',
			description: 'Post a comment on a GitHub pull request.',
			cliCommand: 'cascade-tools github post-pr-comment',
			parameters: {
				owner: { type: 'string', required: true },
				repo: { type: 'string', required: true },
				prNumber: { type: 'number', required: true },
				body: { type: 'string', required: true },
			},
		},
		{
			name: 'UpdatePRComment',
			description: 'Update an existing PR comment.',
			cliCommand: 'cascade-tools github update-pr-comment',
			parameters: {
				owner: { type: 'string', required: true },
				repo: { type: 'string', required: true },
				commentId: { type: 'number', required: true },
				body: { type: 'string', required: true },
			},
		},
		{
			name: 'ReplyToReviewComment',
			description: 'Reply to a review comment on a PR.',
			cliCommand: 'cascade-tools github reply-to-review-comment',
			parameters: {
				owner: { type: 'string', required: true },
				repo: { type: 'string', required: true },
				prNumber: { type: 'number', required: true },
				commentId: { type: 'number', required: true },
				body: { type: 'string', required: true },
			},
		},
		{
			name: 'CreatePRReview',
			description: 'Submit a code review on a PR.',
			cliCommand: 'cascade-tools github create-pr-review',
			parameters: {
				owner: { type: 'string', required: true },
				repo: { type: 'string', required: true },
				prNumber: { type: 'number', required: true },
				event: { type: 'string', required: true },
				body: { type: 'string', required: true },
			},
		},
		{
			name: 'Finish',
			description: 'Validate and signal session completion.',
			cliCommand: 'cascade-tools session finish',
			parameters: { comment: { type: 'string', required: true } },
		},
	];
}
