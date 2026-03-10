import type { ToolManifest } from '../contracts/index.js';

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
				'include-comments': { type: 'boolean', default: true },
			},
		},
		{
			name: 'PostComment',
			description: 'Post a comment to a work item (card/issue).',
			cliCommand: 'cascade-tools pm post-comment',
			parameters: {
				workItemId: { type: 'string', required: true },
				text: { type: 'string', required: true },
				'text-file': {
					type: 'string',
					description: 'Path to file with comment text (prefer over --text for long content)',
				},
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
				'description-file': {
					type: 'string',
					description: 'Path to file with description (prefer over --description for long content)',
				},
			},
		},
		{
			name: 'CreateWorkItem',
			description: 'Create a new work item (card/issue).',
			cliCommand: 'cascade-tools pm create-work-item',
			parameters: {
				containerId: { type: 'string', required: true },
				title: { type: 'string', required: true },
				'description-file': {
					type: 'string',
					description: 'Path to file with description (prefer over --description for long content)',
				},
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
				item: { type: 'array', required: true },
			},
		},
		{
			name: 'MoveWorkItem',
			description:
				'Move a work item to a different list or status. For Trello, destination is a list ID. For JIRA, destination is a status name.',
			cliCommand: 'cascade-tools pm move-work-item',
			parameters: {
				workItemId: { type: 'string', required: true },
				destination: { type: 'string', required: true },
			},
		},
		{
			name: 'PMUpdateChecklistItem',
			description: 'Update a checklist item state on a work item.',
			cliCommand: 'cascade-tools pm update-checklist-item',
			parameters: {
				workItemId: { type: 'string', required: true },
				'check-item-id': { type: 'string', required: true },
				state: { type: 'string', required: true, description: 'complete or incomplete' },
			},
		},
		{
			name: 'PMDeleteChecklistItem',
			description: 'Delete a checklist item from a work item.',
			cliCommand: 'cascade-tools pm delete-checklist-item',
			parameters: {
				workItemId: { type: 'string', required: true },
				'check-item-id': { type: 'string', required: true },
			},
		},
		{
			name: 'CreatePR',
			description:
				'Create a GitHub pull request. Handles the full workflow: stages changes, commits, pushes branch to remote, and creates the PR. ALWAYS use this instead of gh pr create or manual git push. If you have already committed your changes, use --no-commit to skip the commit step. The target base branch is set automatically — do not specify --base.',
			cliCommand: 'cascade-tools github create-pr',
			parameters: {
				title: { type: 'string', required: true },
				body: { type: 'string', required: true },
				'body-file': {
					type: 'string',
					description: 'Path to file with PR body (prefer over --body for long content)',
				},
				head: { type: 'string', required: true },
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
				prNumber: { type: 'number', required: true },
			},
		},
		{
			name: 'GetPRDiff',
			description: 'Get the unified diff of all file changes in a PR.',
			cliCommand: 'cascade-tools github get-pr-diff',
			parameters: {
				prNumber: { type: 'number', required: true },
			},
		},
		{
			name: 'GetPRChecks',
			description: 'Get CI check status for a PR.',
			cliCommand: 'cascade-tools github get-pr-checks',
			parameters: {
				prNumber: { type: 'number', required: true },
			},
		},
		{
			name: 'GetPRComments',
			description: 'Get all review comments on a PR.',
			cliCommand: 'cascade-tools github get-pr-comments',
			parameters: {
				prNumber: { type: 'number', required: true },
			},
		},
		{
			name: 'PostPRComment',
			description: 'Post a comment on a GitHub pull request.',
			cliCommand: 'cascade-tools github post-pr-comment',
			parameters: {
				prNumber: { type: 'number', required: true },
				body: { type: 'string', required: true },
				'body-file': {
					type: 'string',
					description: 'Path to file with comment body (prefer over --body for long content)',
				},
			},
		},
		{
			name: 'UpdatePRComment',
			description: 'Update an existing PR comment.',
			cliCommand: 'cascade-tools github update-pr-comment',
			parameters: {
				commentId: { type: 'number', required: true },
				body: { type: 'string', required: true },
			},
		},
		{
			name: 'ReplyToReviewComment',
			description: 'Reply to a review comment on a PR.',
			cliCommand: 'cascade-tools github reply-to-review-comment',
			parameters: {
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
				prNumber: { type: 'number', required: true },
				event: { type: 'string', required: true },
				body: { type: 'string', required: true },
			},
		},
		{
			name: 'GetCIRunLogs',
			description: 'Get failed CI workflow run info for a commit. Shows failed jobs and steps.',
			cliCommand: 'cascade-tools github get-ci-run-logs',
			parameters: {
				ref: { type: 'string', required: true },
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
