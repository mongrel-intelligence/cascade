import { execSync } from 'node:child_process';
import { TaskCompletionSignal } from 'llmist';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Finish } from '../../../src/gadgets/Finish.js';
import {
	initSessionState,
	recordPRCreation,
	recordReviewSubmission,
} from '../../../src/gadgets/sessionState.js';
import { githubClient } from '../../../src/github/client.js';

// Mock git commands used by Finish for respond-to-review checks and PR lookup
vi.mock('node:child_process', () => ({
	execSync: vi.fn().mockReturnValue(''),
}));

// Mock the github client for PR fallback check
vi.mock('../../../src/github/client.js', () => ({
	githubClient: {
		getOpenPRByBranch: vi.fn(),
	},
}));

describe('Finish gadget', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('has exclusive set to prevent parallel execution with other gadgets', () => {
		initSessionState('unknown');
		const gadget = new Finish();
		expect(gadget.exclusive).toBe(true);
	});

	it('throws TaskCompletionSignal when no agent type is set', async () => {
		initSessionState('unknown');
		const gadget = new Finish();
		await expect(gadget.execute({ comment: 'Done' })).rejects.toThrow(TaskCompletionSignal);
	});

	describe('implementation agent', () => {
		beforeEach(() => {
			initSessionState('implementation');
		});

		it('rejects finish without PR creation and no PR on branch', async () => {
			vi.mocked(execSync).mockImplementation((cmd: string) => {
				if (cmd.includes('rev-parse')) return 'feature/test';
				if (cmd.includes('get-url')) return 'git@github.com:owner/repo.git';
				return '';
			});
			vi.mocked(githubClient.getOpenPRByBranch).mockResolvedValue(null);

			const gadget = new Finish();
			await expect(gadget.execute({ comment: 'Done' })).rejects.toThrow(
				'Cannot finish implementation session without creating a PR',
			);
		});

		it('allows finish after PR creation via CreatePR gadget', async () => {
			recordPRCreation('https://github.com/owner/repo/pull/1');
			const gadget = new Finish();
			await expect(gadget.execute({ comment: 'Done' })).rejects.toThrow(TaskCompletionSignal);
		});

		it('allows finish when PR exists on branch but was not created via CreatePR', async () => {
			vi.mocked(execSync).mockImplementation((cmd: string) => {
				if (cmd.includes('rev-parse')) return 'feature/test';
				if (cmd.includes('get-url')) return 'git@github.com:owner/repo.git';
				return '';
			});
			vi.mocked(githubClient.getOpenPRByBranch).mockResolvedValue({
				number: 5,
				htmlUrl: 'https://github.com/owner/repo/pull/5',
				title: 'Ad-hoc PR',
			});

			const gadget = new Finish();
			await expect(gadget.execute({ comment: 'Done' })).rejects.toThrow(TaskCompletionSignal);
		});

		it('rejects when PR lookup fails', async () => {
			vi.mocked(execSync).mockImplementation(() => {
				throw new Error('git not available');
			});

			const gadget = new Finish();
			await expect(gadget.execute({ comment: 'Done' })).rejects.toThrow(
				'Cannot finish implementation session without creating a PR',
			);
		});
	});

	describe('respond-to-ci agent', () => {
		beforeEach(() => {
			initSessionState('respond-to-ci');
		});

		it('rejects finish with uncommitted changes', async () => {
			vi.mocked(execSync).mockImplementation((cmd: string) => {
				if (cmd.includes('status --porcelain')) return 'M src/file.ts';
				return '';
			});

			const gadget = new Finish();
			await expect(gadget.execute({ comment: 'Done' })).rejects.toThrow(
				'Cannot finish respond-to-ci session with uncommitted changes',
			);
		});

		it('rejects finish with unpushed commits', async () => {
			vi.mocked(execSync).mockImplementation((cmd: string) => {
				if (cmd.includes('status --porcelain')) return '';
				if (cmd.includes('rev-list')) return '1';
				return '';
			});

			const gadget = new Finish();
			await expect(gadget.execute({ comment: 'Done' })).rejects.toThrow(
				'Cannot finish respond-to-ci session without pushing changes',
			);
		});

		it('allows finish when changes are committed and pushed', async () => {
			vi.mocked(execSync).mockImplementation((cmd: string) => {
				if (cmd.includes('status --porcelain')) return '';
				if (cmd.includes('rev-list')) return '0';
				return '';
			});

			const gadget = new Finish();
			await expect(gadget.execute({ comment: 'Done' })).rejects.toThrow(TaskCompletionSignal);
		});
	});

	describe('review agent', () => {
		beforeEach(() => {
			initSessionState('review');
		});

		it('rejects finish without submitting a review', async () => {
			const gadget = new Finish();
			await expect(gadget.execute({ comment: 'Done' })).rejects.toThrow(
				'Cannot finish review session without submitting a review',
			);
		});

		it('allows finish after review submission', async () => {
			recordReviewSubmission('https://github.com/owner/repo/pull/1#pullrequestreview-123');
			const gadget = new Finish();
			await expect(gadget.execute({ comment: 'Done' })).rejects.toThrow(TaskCompletionSignal);
		});
	});
});
