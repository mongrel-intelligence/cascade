/**
 * Unified ToolDefinition objects for GitLab SCM tools.
 *
 * These definitions are the single source of truth for:
 * - Gadget classes (generated via createGadgetClass)
 * - CLI commands (generated via createCLICommand)
 * - JSON Schema manifests (generated via buildManifest)
 */

import type { ToolDefinition } from '../shared/toolDefinition.js';

/**
 * Shared projectPath auto-resolved param used by most GitLab SCM tools.
 */
const projectPathAutoResolved = [
	{
		paramName: 'projectPath',
		envVar: 'CASCADE_GITLAB_PROJECT_PATH',
		resolvedFrom: 'git-remote' as const,
		description: 'GitLab project path (auto-detected from git remote)',
	},
];

export const createMRDef: ToolDefinition = {
	name: 'CreateMR',
	description: `Create a GitLab merge request. Handles the full workflow: commit > push > create MR.

By default, this gadget will:
1. Stage and commit all changes (using the MR title as commit message)
2. Push the branch to remote
3. Create the merge request

The project path is auto-detected from the git remote — you do not need to specify it.

Set commit=false if you have already committed your changes.
Set push=false if you have already pushed the branch.

The MR description supports full GitLab-flavored markdown including:
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
			describe: 'The merge request title (also used as commit message if committing)',
			required: true,
		},
		body: {
			type: 'string',
			describe: 'The merge request description (supports GitLab markdown)',
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
			describe: 'Create as a draft merge request (default: false)',
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
			describe: 'Custom commit message (default: uses MR title)',
			optional: true,
		},
		push: {
			type: 'boolean',
			describe: 'Push the branch to remote before creating MR (default: true)',
			optional: true,
			default: true,
			allowNo: true,
		},
	},
	examples: [
		{
			params: {
				comment: 'Creating MR for completed auth feature',
				title: 'feat: add user authentication',
				body: '## Summary\n\nAdds OAuth2 authentication flow.\n\n## Changes\n\n- Added login page\n- Integrated with auth provider\n- Added session management',
				head: 'feature/auth',
			},
			comment:
				'Full workflow: commits all changes, pushes, and creates MR (base branch is auto-resolved)',
		},
		{
			params: {
				comment: 'Creating draft MR for early feedback',
				title: 'fix: resolve null pointer in checkout',
				body: 'Fixes #123\n\nAdded null check before accessing cart items.',
				head: 'fix/checkout-null',
				draft: true,
				commitMessage: 'fix(checkout): add null check for cart items',
			},
			comment: 'Create a draft MR with custom commit message',
		},
		{
			params: {
				comment: 'Creating MR - already committed and pushed',
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
				description: 'Read MR body from file (use - for stdin)',
			},
		],
	},
};

export const createMRReviewDef: ToolDefinition = {
	name: 'CreateMRReview',
	description:
		'Submit a review on a GitLab merge request. Approves, unapproves, or posts a review comment on the MR.',
	timeoutMs: 30000,
	parameters: {
		comment: {
			type: 'string',
			describe: 'Brief rationale for this gadget call',
			required: true,
			gadgetOnly: true,
		},
		projectPath: {
			type: 'string',
			describe: 'GitLab project path (e.g. group/repo)',
			required: true,
			cliEnvVar: 'CASCADE_GITLAB_PROJECT_PATH',
		},
		mrIid: {
			type: 'number',
			describe: 'The merge request IID',
			required: true,
		},
		event: {
			type: 'enum',
			options: ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'],
			describe: 'The review action: APPROVE, REQUEST_CHANGES (unapprove), or COMMENT',
			required: true,
		},
		body: {
			type: 'string',
			describe: 'Overall review summary (supports markdown)',
			required: true,
		},
	},
	examples: [
		{
			params: {
				comment: 'Approving MR after thorough review',
				projectPath: 'acme/myapp',
				mrIid: 42,
				event: 'APPROVE',
				body: 'LGTM! The implementation is clean and well-tested.',
			},
			comment: 'Approve an MR with a summary note',
		},
		{
			params: {
				comment: 'Requesting changes for identified issues',
				projectPath: 'acme/myapp',
				mrIid: 42,
				event: 'REQUEST_CHANGES',
				body: 'Good progress, but a few issues need to be addressed before merging.',
			},
			comment: 'Unapprove and post review feedback',
		},
	],
	cli: {
		autoResolved: projectPathAutoResolved,
	},
};

export const getMRDetailsDef: ToolDefinition = {
	name: 'GetMRDetails',
	description:
		'Get details about a GitLab merge request including title, description, branch info, and conflict status.',
	timeoutMs: 30000,
	parameters: {
		comment: {
			type: 'string',
			describe: 'Brief rationale for this gadget call',
			required: true,
			gadgetOnly: true,
		},
		projectPath: {
			type: 'string',
			describe: 'GitLab project path (e.g. group/repo)',
			required: true,
			cliEnvVar: 'CASCADE_GITLAB_PROJECT_PATH',
		},
		mrIid: {
			type: 'number',
			describe: 'The merge request IID',
			required: true,
		},
	},
	examples: [
		{
			params: {
				comment: 'Fetching MR details to understand changes',
				projectPath: 'acme/myapp',
				mrIid: 42,
			},
			comment: 'Get details for MR !42',
		},
	],
	cli: {
		autoResolved: projectPathAutoResolved,
	},
};

export const getMRDiffDef: ToolDefinition = {
	name: 'GetMRDiff',
	description:
		'Get the diff of all file changes in a GitLab merge request. Shows each file with the patch content.',
	timeoutMs: 30000,
	parameters: {
		comment: {
			type: 'string',
			describe: 'Brief rationale for this gadget call',
			required: true,
			gadgetOnly: true,
		},
		projectPath: {
			type: 'string',
			describe: 'GitLab project path (e.g. group/repo)',
			required: true,
			cliEnvVar: 'CASCADE_GITLAB_PROJECT_PATH',
		},
		mrIid: {
			type: 'number',
			describe: 'The merge request IID',
			required: true,
		},
	},
	examples: [
		{
			params: {
				comment: 'Reviewing file changes for code review',
				projectPath: 'acme/myapp',
				mrIid: 42,
			},
			comment: 'Get all file changes in MR !42',
		},
	],
	cli: {
		autoResolved: projectPathAutoResolved,
	},
};

export const getMRNotesDef: ToolDefinition = {
	name: 'GetMRNotes',
	description:
		'Get notes (comments) on a GitLab merge request. Shows all discussion comments including system notes.',
	timeoutMs: 30000,
	parameters: {
		comment: {
			type: 'string',
			describe: 'Brief rationale for this gadget call',
			required: true,
			gadgetOnly: true,
		},
		projectPath: {
			type: 'string',
			describe: 'GitLab project path (e.g. group/repo)',
			required: true,
			cliEnvVar: 'CASCADE_GITLAB_PROJECT_PATH',
		},
		mrIid: {
			type: 'number',
			describe: 'The merge request IID',
			required: true,
		},
	},
	examples: [
		{
			params: {
				comment: 'Fetching review comments to understand feedback',
				projectPath: 'acme/myapp',
				mrIid: 42,
			},
			comment: 'Get all notes on MR !42',
		},
	],
	cli: {
		autoResolved: projectPathAutoResolved,
	},
};

export const postMRNoteDef: ToolDefinition = {
	name: 'PostMRNote',
	description: 'Post a note (comment) on a GitLab merge request. Use this for general MR comments.',
	timeoutMs: 30000,
	parameters: {
		comment: {
			type: 'string',
			describe: 'Brief rationale for this gadget call',
			required: true,
			gadgetOnly: true,
		},
		projectPath: {
			type: 'string',
			describe: 'GitLab project path (e.g. group/repo)',
			required: true,
			cliEnvVar: 'CASCADE_GITLAB_PROJECT_PATH',
		},
		mrIid: {
			type: 'number',
			describe: 'The merge request IID',
			required: true,
		},
		body: {
			type: 'string',
			describe: 'The note body (supports markdown)',
			required: true,
		},
	},
	examples: [
		{
			params: {
				comment: 'Acknowledging review feedback',
				projectPath: 'acme/myapp',
				mrIid: 42,
				body: 'Working on addressing the review feedback...',
			},
			comment: 'Post a status note on the MR',
		},
	],
	cli: {
		autoResolved: projectPathAutoResolved,
		fileInputAlternatives: [
			{
				paramName: 'body',
				fileFlag: 'body-file',
				description: 'Read note body from file (use - for stdin)',
			},
		],
	},
};

export const updateMRNoteDef: ToolDefinition = {
	name: 'UpdateMRNote',
	description:
		'Update an existing note on a GitLab merge request. Use this to update a previously posted note with new information.',
	timeoutMs: 30000,
	parameters: {
		comment: {
			type: 'string',
			describe: 'Brief rationale for this gadget call',
			required: true,
			gadgetOnly: true,
		},
		projectPath: {
			type: 'string',
			describe: 'GitLab project path (e.g. group/repo)',
			required: true,
			cliEnvVar: 'CASCADE_GITLAB_PROJECT_PATH',
		},
		mrIid: {
			type: 'number',
			describe: 'The merge request IID',
			required: true,
		},
		noteId: {
			type: 'number',
			describe: 'The ID of the note to update',
			required: true,
		},
		body: {
			type: 'string',
			describe: 'The new note body (supports markdown)',
			required: true,
		},
	},
	examples: [
		{
			params: {
				comment: 'Updating status after addressing feedback',
				projectPath: 'acme/myapp',
				mrIid: 42,
				noteId: 123456789,
				body: 'All review feedback has been addressed. Changes pushed.',
			},
			comment: 'Update an existing note with completion status',
		},
	],
	cli: {
		autoResolved: projectPathAutoResolved,
	},
};

export const approveMRDef: ToolDefinition = {
	name: 'ApproveMR',
	description: 'Approve or unapprove a GitLab merge request.',
	timeoutMs: 30000,
	parameters: {
		comment: {
			type: 'string',
			describe: 'Brief rationale for this gadget call',
			required: true,
			gadgetOnly: true,
		},
		projectPath: {
			type: 'string',
			describe: 'GitLab project path (e.g. group/repo)',
			required: true,
			cliEnvVar: 'CASCADE_GITLAB_PROJECT_PATH',
		},
		mrIid: {
			type: 'number',
			describe: 'The merge request IID',
			required: true,
		},
		action: {
			type: 'enum',
			options: ['approve', 'unapprove'],
			describe: 'Approval action: approve or unapprove',
			required: true,
		},
	},
	examples: [
		{
			params: {
				comment: 'Approving MR after successful review',
				projectPath: 'acme/myapp',
				mrIid: 42,
				action: 'approve',
			},
			comment: 'Approve MR !42',
		},
	],
	cli: {
		autoResolved: projectPathAutoResolved,
	},
};

export const getPipelineStatusDef: ToolDefinition = {
	name: 'GetPipelineStatus',
	description: 'Get the status of a GitLab CI/CD pipeline including ref, SHA, and web URL.',
	timeoutMs: 30000,
	parameters: {
		comment: {
			type: 'string',
			describe: 'Brief rationale for this gadget call',
			required: true,
			gadgetOnly: true,
		},
		projectPath: {
			type: 'string',
			describe: 'GitLab project path (e.g. group/repo)',
			required: true,
			cliEnvVar: 'CASCADE_GITLAB_PROJECT_PATH',
		},
		pipelineId: {
			type: 'number',
			describe: 'The pipeline ID',
			required: true,
		},
	},
	examples: [
		{
			params: {
				comment: 'Checking CI status before merge',
				projectPath: 'acme/myapp',
				pipelineId: 12345,
			},
			comment: 'Get status for pipeline #12345',
		},
	],
	cli: {
		autoResolved: projectPathAutoResolved,
	},
};

export const getFailedPipelineJobsDef: ToolDefinition = {
	name: 'GetFailedPipelineJobs',
	description:
		'Get failed jobs from a GitLab CI/CD pipeline. Shows job name, stage, failure reason, and web URL for each failed job.',
	timeoutMs: 60000,
	parameters: {
		comment: {
			type: 'string',
			describe: 'Brief rationale for this gadget call',
			required: true,
			gadgetOnly: true,
		},
		projectPath: {
			type: 'string',
			describe: 'GitLab project path (e.g. group/repo)',
			required: true,
			cliEnvVar: 'CASCADE_GITLAB_PROJECT_PATH',
		},
		pipelineId: {
			type: 'number',
			describe: 'The pipeline ID',
			required: true,
		},
	},
	examples: [
		{
			params: {
				comment: 'Fetching failed CI jobs to diagnose test failures',
				projectPath: 'acme/myapp',
				pipelineId: 12345,
			},
			comment: 'Get failed jobs for pipeline #12345',
		},
	],
	cli: {
		autoResolved: projectPathAutoResolved,
	},
};

export const mergeMRDef: ToolDefinition = {
	name: 'MergeMR',
	description: 'Merge a GitLab merge request. Optionally squash commits.',
	timeoutMs: 30000,
	parameters: {
		comment: {
			type: 'string',
			describe: 'Brief rationale for this gadget call',
			required: true,
			gadgetOnly: true,
		},
		projectPath: {
			type: 'string',
			describe: 'GitLab project path (e.g. group/repo)',
			required: true,
			cliEnvVar: 'CASCADE_GITLAB_PROJECT_PATH',
		},
		mrIid: {
			type: 'number',
			describe: 'The merge request IID',
			required: true,
		},
		squash: {
			type: 'boolean',
			describe: 'Whether to squash commits (default: false)',
			optional: true,
		},
	},
	examples: [
		{
			params: {
				comment: 'Merging approved MR',
				projectPath: 'acme/myapp',
				mrIid: 42,
			},
			comment: 'Merge MR !42',
		},
		{
			params: {
				comment: 'Merging with squash',
				projectPath: 'acme/myapp',
				mrIid: 42,
				squash: true,
			},
			comment: 'Merge MR !42 with squashed commits',
		},
	],
	cli: {
		autoResolved: projectPathAutoResolved,
	},
};
