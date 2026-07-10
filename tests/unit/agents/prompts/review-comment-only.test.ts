import { beforeAll, describe, expect, it, vi } from 'vitest';

// Mock resolveKnownAgentTypes so validTypes is populated without DB
vi.mock('../../../../src/agents/definitions/index.js', () => ({
	resolveKnownAgentTypes: vi.fn().mockResolvedValue(['review']),
}));

import { getSystemPrompt, initPrompts } from '../../../../src/agents/prompts/index.js';

beforeAll(async () => {
	await initPrompts();
});

/**
 * The review.eta template forks on `it.commentOnlyReview` — under a
 * comment-only review event policy the agent must be told that CreatePRReview
 * automatically downgrades its verdict to an advisory COMMENT, and the default
 * "approve it" instructions must not appear (the agent can't approve).
 */
describe('review prompt — comment-only review mode fork', () => {
	describe('default render (commentOnlyReview absent/false)', () => {
		for (const context of [undefined, { commentOnlyReview: false }]) {
			const label = context === undefined ? 'absent' : 'false';
			it(`keeps the verdict instructions when the flag is ${label}`, () => {
				const prompt = getSystemPrompt('review', context);
				expect(prompt).toContain('**APPROVE when verified.**');
				expect(prompt).toContain('If the PR is good, approve it.');
				expect(prompt).not.toContain('comment-only review mode');
				expect(prompt).not.toContain('advisory');
			});
		}
	});

	describe('comment-only render', () => {
		it('explains the advisory downgrade contract', () => {
			const prompt = getSystemPrompt('review', { commentOnlyReview: true });
			expect(prompt).toContain('Comment-only review mode is enabled');
			expect(prompt).toContain('advisory');
			expect(prompt).toContain('Developers decide');
		});

		it('tells the agent to still pass its true verdict as `event`', () => {
			const prompt = getSystemPrompt('review', { commentOnlyReview: true });
			expect(prompt).toContain('still choose your true verdict');
		});

		it('drops the instructions that assume the agent can approve or block', () => {
			const prompt = getSystemPrompt('review', { commentOnlyReview: true });
			expect(prompt).not.toContain('**APPROVE when verified.**');
			expect(prompt).not.toContain('If the PR is good, approve it.');
		});

		it('keeps the severity → event mapping (verdict intent is still expressed)', () => {
			const prompt = getSystemPrompt('review', { commentOnlyReview: true });
			expect(prompt).toContain('BLOCKING');
			expect(prompt).toContain('REQUEST_CHANGES');
		});
	});
});
