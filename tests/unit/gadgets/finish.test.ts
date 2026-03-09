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
	it('has exclusive set to prevent parallel execution with other gadgets', () => {
		initSessionState('unknown');
		const gadget = new Finish();
		expect(gadget.exclusive).toBe(true);
	});

	it('throws TaskCompletionSignal when no hooks are set', async () => {
		initSessionState('unknown');
		const gadget = new Finish();
		await expect(gadget.execute({ comment: 'Done' })).rejects.toThrow(TaskCompletionSignal);
	});

	describe('implementation agent (hooks.requiresPR: true)', () => {
		beforeEach(() => {
			initSessionState('implementation', undefined, undefined, undefined, { requiresPR: true });
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
				'Cannot finish session without creating a PR',
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
				'Cannot finish session without creating a PR',
			);
		});
	});

	describe('respond-to-ci agent (hooks.requiresPushedChanges: true)', () => {
		const INITIAL_SHA = 'a'.repeat(40);
		const NEW_SHA = 'b'.repeat(40);

		beforeEach(() => {
			initSessionState(
				'respond-to-ci',
				undefined,
				undefined,
				undefined,
				{ requiresPushedChanges: true },
				undefined,
				undefined,
				INITIAL_SHA,
			);
		});

		it('rejects finish with uncommitted changes', async () => {
			vi.mocked(execSync).mockImplementation((cmd: string) => {
				if (cmd.includes('status --porcelain')) return 'M src/file.ts';
				return '';
			});

			const gadget = new Finish();
			await expect(gadget.execute({ comment: 'Done' })).rejects.toThrow(
				'Cannot finish session with uncommitted changes',
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
				'Cannot finish session without pushing changes',
			);
		});

		it('allows finish when changes are committed and pushed', async () => {
			vi.mocked(execSync).mockImplementation((cmd: string) => {
				if (cmd.includes('status --porcelain')) return '';
				if (cmd.includes('rev-list')) return '0';
				if (cmd === 'git rev-parse HEAD') return NEW_SHA;
				return '';
			});

			const gadget = new Finish();
			await expect(gadget.execute({ comment: 'Done' })).rejects.toThrow(TaskCompletionSignal);
		});

		it('rejects finish when no new commits were made (HEAD unchanged)', async () => {
			vi.mocked(execSync).mockImplementation((cmd: string) => {
				if (cmd.includes('status --porcelain')) return '';
				if (cmd.includes('rev-list')) return '0';
				if (cmd === 'git rev-parse HEAD') return INITIAL_SHA;
				return '';
			});

			const gadget = new Finish();
			await expect(gadget.execute({ comment: 'Done' })).rejects.toThrow(
				'Cannot finish session without making any changes',
			);
		});

		it('skips no-op check when initialHeadSha is not set', async () => {
			// Re-init without initialHeadSha
			initSessionState('respond-to-ci', undefined, undefined, undefined, {
				requiresPushedChanges: true,
			});

			vi.mocked(execSync).mockImplementation((cmd: string) => {
				if (cmd.includes('status --porcelain')) return '';
				if (cmd.includes('rev-list')) return '0';
				return '';
			});

			const gadget = new Finish();
			await expect(gadget.execute({ comment: 'Done' })).rejects.toThrow(TaskCompletionSignal);
		});
	});

	describe('review agent (hooks.requiresReview: true)', () => {
		beforeEach(() => {
			initSessionState('review', undefined, undefined, undefined, { requiresReview: true });
		});

		it('rejects finish without submitting a review', async () => {
			const gadget = new Finish();
			await expect(gadget.execute({ comment: 'Done' })).rejects.toThrow(
				'Cannot finish session without submitting a review',
			);
		});

		it('allows finish after review submission', async () => {
			recordReviewSubmission('https://github.com/owner/repo/pull/1#pullrequestreview-123');
			const gadget = new Finish();
			await expect(gadget.execute({ comment: 'Done' })).rejects.toThrow(TaskCompletionSignal);
		});
	});
});
