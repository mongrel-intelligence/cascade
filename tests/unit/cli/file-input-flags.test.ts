import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock credential-scoping dependencies
vi.mock('../../../src/github/client.js', () => ({
	withGitHubToken: vi.fn((_token: string, fn: () => Promise<void>) => fn()),
}));
vi.mock('../../../src/trello/client.js', () => ({
	withTrelloCredentials: vi.fn(
		(_creds: { apiKey: string; token: string }, fn: () => Promise<void>) => fn(),
	),
}));
vi.mock('../../../src/jira/client.js', () => ({
	withJiraCredentials: vi.fn(
		(_creds: { email: string; apiToken: string; baseUrl: string }, fn: () => Promise<void>) => fn(),
	),
}));
vi.mock('../../../src/pm/index.js', () => ({
	createPMProvider: vi.fn(() => ({})),
	withPMProvider: vi.fn((_provider: unknown, fn: () => Promise<void>) => fn()),
}));

// Mock all gadget functions
vi.mock('../../../src/gadgets/pm/core/updateWorkItem.js', () => ({
	updateWorkItem: vi.fn().mockResolvedValue({ id: 'wi-1' }),
}));
vi.mock('../../../src/gadgets/pm/core/createWorkItem.js', () => ({
	createWorkItem: vi.fn().mockResolvedValue({ id: 'wi-2' }),
}));
vi.mock('../../../src/gadgets/pm/core/postComment.js', () => ({
	postComment: vi.fn().mockResolvedValue({ id: 'comment-1' }),
}));
vi.mock('../../../src/gadgets/github/core/createPR.js', () => ({
	createPR: vi.fn().mockResolvedValue({ url: 'https://github.com/o/r/pull/1' }),
}));
vi.mock('../../../src/gadgets/github/core/postPRComment.js', () => ({
	postPRComment: vi.fn().mockResolvedValue({ id: 123 }),
}));

import { createPR } from '../../../src/gadgets/github/core/createPR.js';
import { postPRComment } from '../../../src/gadgets/github/core/postPRComment.js';
import { createWorkItem } from '../../../src/gadgets/pm/core/createWorkItem.js';
import { postComment } from '../../../src/gadgets/pm/core/postComment.js';
import { updateWorkItem } from '../../../src/gadgets/pm/core/updateWorkItem.js';

import CreateWorkItem from '../../../src/cli/pm/create-work-item.js';
import PostComment from '../../../src/cli/pm/post-comment.js';
import UpdateWorkItem from '../../../src/cli/pm/update-work-item.js';
import CreatePR from '../../../src/cli/scm/create-pr.js';
import PostPRComment from '../../../src/cli/scm/post-pr-comment.js';

let tmpDir: string;

/** Minimal oclif config to satisfy this.parse() */
const mockConfig = { runHook: vi.fn().mockResolvedValue({ successes: [], failures: [] }) };

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'cascade-cli-test-'));
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
});

/** Write content to a temp file and return the path. */
function writeTempFile(filename: string, content: string): string {
	const filePath = join(tmpDir, filename);
	writeFileSync(filePath, content);
	return filePath;
}

describe('UpdateWorkItem --description-file', () => {
	it('reads description from file', async () => {
		const filePath = writeTempFile('desc.md', '# Plan\n\nThis is the **plan**.');
		const cmd = new UpdateWorkItem(
			['--workItemId', 'card-1', '--description-file', filePath],
			mockConfig as never,
		);
		await cmd.run();

		expect(updateWorkItem).toHaveBeenCalledWith(
			expect.objectContaining({
				workItemId: 'card-1',
				description: '# Plan\n\nThis is the **plan**.',
			}),
		);
	});

	it('prefers --description-file over --description', async () => {
		const filePath = writeTempFile('desc.md', 'from file');
		const cmd = new UpdateWorkItem(
			['--workItemId', 'card-1', '--description', 'from flag', '--description-file', filePath],
			mockConfig as never,
		);
		await cmd.run();

		expect(updateWorkItem).toHaveBeenCalledWith(
			expect.objectContaining({
				description: 'from file',
			}),
		);
	});

	it('still works with inline --description flag', async () => {
		const cmd = new UpdateWorkItem(
			['--workItemId', 'card-1', '--description', 'inline content'],
			mockConfig as never,
		);
		await cmd.run();

		expect(updateWorkItem).toHaveBeenCalledWith(
			expect.objectContaining({
				description: 'inline content',
			}),
		);
	});

	it('handles file with special characters (quotes, backticks, $())', async () => {
		const content = 'Use `code` and "quotes" and $(command) and heredoc <<EOF';
		const filePath = writeTempFile('special.md', content);
		const cmd = new UpdateWorkItem(
			['--workItemId', 'card-1', '--description-file', filePath],
			mockConfig as never,
		);
		await cmd.run();

		expect(updateWorkItem).toHaveBeenCalledWith(
			expect.objectContaining({
				description: content,
			}),
		);
	});
});

describe('CreateWorkItem --description-file', () => {
	it('reads description from file', async () => {
		const filePath = writeTempFile('desc.md', 'Work item description');
		const cmd = new CreateWorkItem(
			['--containerId', 'list-1', '--title', 'New Card', '--description-file', filePath],
			mockConfig as never,
		);
		await cmd.run();

		expect(createWorkItem).toHaveBeenCalledWith(
			expect.objectContaining({
				containerId: 'list-1',
				title: 'New Card',
				description: 'Work item description',
			}),
		);
	});

	it('still works without --description-file', async () => {
		const cmd = new CreateWorkItem(
			['--containerId', 'list-1', '--title', 'New Card'],
			mockConfig as never,
		);
		await cmd.run();

		expect(createWorkItem).toHaveBeenCalledWith(
			expect.objectContaining({
				containerId: 'list-1',
				title: 'New Card',
				description: undefined,
			}),
		);
	});
});

describe('PostComment --text-file', () => {
	it('reads comment text from file', async () => {
		const filePath = writeTempFile('comment.md', 'Comment from file');
		const cmd = new PostComment(
			['--workItemId', 'card-1', '--text-file', filePath],
			mockConfig as never,
		);
		await cmd.run();

		expect(postComment).toHaveBeenCalledWith('card-1', 'Comment from file');
	});

	it('prefers --text-file over --text', async () => {
		const filePath = writeTempFile('comment.md', 'from file');
		const cmd = new PostComment(
			['--workItemId', 'card-1', '--text', 'from flag', '--text-file', filePath],
			mockConfig as never,
		);
		await cmd.run();

		expect(postComment).toHaveBeenCalledWith('card-1', 'from file');
	});

	it('still works with inline --text flag', async () => {
		const cmd = new PostComment(
			['--workItemId', 'card-1', '--text', 'inline text'],
			mockConfig as never,
		);
		await cmd.run();

		expect(postComment).toHaveBeenCalledWith('card-1', 'inline text');
	});

	it('errors when neither --text nor --text-file is provided', async () => {
		const cmd = new PostComment(['--workItemId', 'card-1'], mockConfig as never);
		await expect(cmd.run()).rejects.toThrow('Either --text or --text-file is required');
	});
});

describe('CreatePR --body-file', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv, CASCADE_BASE_BRANCH: 'main' };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it('reads PR body from file', async () => {
		const filePath = writeTempFile('pr-body.md', '## Summary\n\nPR description');
		const cmd = new CreatePR(
			['--title', 'feat: new feature', '--head', 'feat/branch', '--body-file', filePath],
			mockConfig as never,
		);
		await cmd.run();

		expect(createPR).toHaveBeenCalledWith(
			expect.objectContaining({
				title: 'feat: new feature',
				body: '## Summary\n\nPR description',
				head: 'feat/branch',
			}),
		);
	});

	it('prefers --body-file over --body', async () => {
		const filePath = writeTempFile('pr-body.md', 'from file');
		const cmd = new CreatePR(
			[
				'--title',
				'feat: x',
				'--head',
				'feat/branch',
				'--body',
				'from flag',
				'--body-file',
				filePath,
			],
			mockConfig as never,
		);
		await cmd.run();

		expect(createPR).toHaveBeenCalledWith(
			expect.objectContaining({
				body: 'from file',
			}),
		);
	});

	it('still works with inline --body flag', async () => {
		const cmd = new CreatePR(
			['--title', 'feat: x', '--head', 'feat/branch', '--body', 'inline body'],
			mockConfig as never,
		);
		await cmd.run();

		expect(createPR).toHaveBeenCalledWith(
			expect.objectContaining({
				body: 'inline body',
			}),
		);
	});

	it('errors when neither --body nor --body-file is provided', async () => {
		const cmd = new CreatePR(['--title', 'feat: x', '--head', 'feat/branch'], mockConfig as never);
		await expect(cmd.run()).rejects.toThrow('Either --body or --body-file is required');
	});
});

describe('PostPRComment --body-file', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = {
			...originalEnv,
			CASCADE_REPO_OWNER: 'owner',
			CASCADE_REPO_NAME: 'repo',
		};
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it('reads comment body from file', async () => {
		const filePath = writeTempFile('comment.md', 'PR comment from file');
		const cmd = new PostPRComment(
			['--prNumber', '42', '--body-file', filePath],
			mockConfig as never,
		);
		await cmd.run();

		expect(postPRComment).toHaveBeenCalledWith('owner', 'repo', 42, 'PR comment from file');
	});

	it('prefers --body-file over --body', async () => {
		const filePath = writeTempFile('comment.md', 'from file');
		const cmd = new PostPRComment(
			['--prNumber', '42', '--body', 'from flag', '--body-file', filePath],
			mockConfig as never,
		);
		await cmd.run();

		expect(postPRComment).toHaveBeenCalledWith('owner', 'repo', 42, 'from file');
	});

	it('still works with inline --body flag', async () => {
		const cmd = new PostPRComment(
			['--prNumber', '42', '--body', 'inline body'],
			mockConfig as never,
		);
		await cmd.run();

		expect(postPRComment).toHaveBeenCalledWith('owner', 'repo', 42, 'inline body');
	});

	it('errors when neither --body nor --body-file is provided', async () => {
		const cmd = new PostPRComment(['--prNumber', '42'], mockConfig as never);
		await expect(cmd.run()).rejects.toThrow('Either --body or --body-file is required');
	});
});
