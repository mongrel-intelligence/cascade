import { TaskCompletionSignal } from 'llmist';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Finish } from '../../../src/gadgets/Finish.js';
import {
	initSessionState,
	recordPRCreation,
	recordReviewSubmission,
} from '../../../src/gadgets/sessionState.js';

// Mock git commands used by Finish for respond-to-review checks
vi.mock('node:child_process', () => ({
	execSync: vi.fn().mockReturnValue(''),
}));

describe('Finish gadget', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('throws TaskCompletionSignal when no agent type is set', () => {
		initSessionState('unknown');
		const gadget = new Finish();
		expect(() => gadget.execute({ comment: 'Done' })).toThrow(TaskCompletionSignal);
	});

	describe('implementation agent', () => {
		beforeEach(() => {
			initSessionState('implementation');
		});

		it('rejects finish without PR creation', () => {
			const gadget = new Finish();
			expect(() => gadget.execute({ comment: 'Done' })).toThrow(
				'Cannot finish implementation session without creating a PR',
			);
		});

		it('allows finish after PR creation', () => {
			recordPRCreation('https://github.com/owner/repo/pull/1');
			const gadget = new Finish();
			expect(() => gadget.execute({ comment: 'Done' })).toThrow(TaskCompletionSignal);
		});
	});

	describe('review agent', () => {
		beforeEach(() => {
			initSessionState('review');
		});

		it('rejects finish without submitting a review', () => {
			const gadget = new Finish();
			expect(() => gadget.execute({ comment: 'Done' })).toThrow(
				'Cannot finish review session without submitting a review',
			);
		});

		it('allows finish after review submission', () => {
			recordReviewSubmission('https://github.com/owner/repo/pull/1#pullrequestreview-123');
			const gadget = new Finish();
			expect(() => gadget.execute({ comment: 'Done' })).toThrow(TaskCompletionSignal);
		});
	});
});
