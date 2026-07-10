import { describe, expect, it } from 'vitest';

import {
	applyReviewEventPolicy,
	buildAdvisoryPreamble,
	DEFAULT_REVIEW_EVENT_POLICY,
	isCommentOnlyReview,
	REVIEW_EVENT_POLICIES,
	REVIEW_EVENT_POLICY_ENV_VAR,
	REVIEW_EVENTS,
	type ReviewEvent,
	type ReviewEventPolicy,
	ReviewEventPolicySchema,
	resolveReviewEventPolicy,
} from '../../../src/config/reviewEventPolicy.js';

describe.concurrent('config/reviewEventPolicy', () => {
	describe('REVIEW_EVENT_POLICIES', () => {
		it('lists the two policies', () => {
			expect(REVIEW_EVENT_POLICIES).toEqual(['all', 'comment-only']);
		});
	});

	describe('REVIEW_EVENTS', () => {
		it('lists the three GitHub review event types', () => {
			expect(REVIEW_EVENTS).toEqual(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']);
		});
	});

	describe('DEFAULT_REVIEW_EVENT_POLICY', () => {
		it("defaults to 'all' (agent submits real verdicts — historical behavior)", () => {
			expect(DEFAULT_REVIEW_EVENT_POLICY).toBe('all');
		});

		it('is one of the known policies', () => {
			expect(REVIEW_EVENT_POLICIES).toContain(DEFAULT_REVIEW_EVENT_POLICY);
		});
	});

	describe('REVIEW_EVENT_POLICY_ENV_VAR', () => {
		it('names the worker env var used by the cascade-tools subprocess path', () => {
			expect(REVIEW_EVENT_POLICY_ENV_VAR).toBe('CASCADE_REVIEW_EVENT_POLICY');
		});
	});

	describe('ReviewEventPolicySchema', () => {
		it('accepts every known policy', () => {
			for (const policy of REVIEW_EVENT_POLICIES) {
				expect(ReviewEventPolicySchema.parse(policy)).toBe(policy);
			}
		});

		it('rejects unknown values', () => {
			expect(ReviewEventPolicySchema.safeParse('both').success).toBe(false);
			expect(ReviewEventPolicySchema.safeParse('COMMENT').success).toBe(false);
			expect(ReviewEventPolicySchema.safeParse('').success).toBe(false);
			expect(ReviewEventPolicySchema.safeParse(undefined).success).toBe(false);
		});
	});

	describe('resolveReviewEventPolicy', () => {
		it('reads project.agentReviewEventPolicies[agentType]', () => {
			const project = {
				agentReviewEventPolicies: { review: 'comment-only' as ReviewEventPolicy },
			};
			expect(resolveReviewEventPolicy(project, 'review')).toBe('comment-only');
		});

		it('resolves each agent type independently', () => {
			const project = {
				agentReviewEventPolicies: {
					review: 'comment-only' as ReviewEventPolicy,
					'custom-reviewer': 'all' as ReviewEventPolicy,
				},
			};
			expect(resolveReviewEventPolicy(project, 'review')).toBe('comment-only');
			expect(resolveReviewEventPolicy(project, 'custom-reviewer')).toBe('all');
		});

		it("falls back to 'all' when the project has no map", () => {
			expect(resolveReviewEventPolicy({}, 'review')).toBe('all');
		});

		it("falls back to 'all' when the agent type has no entry", () => {
			const project = {
				agentReviewEventPolicies: { review: 'comment-only' as ReviewEventPolicy },
			};
			expect(resolveReviewEventPolicy(project, 'implementation')).toBe('all');
		});

		it("falls back to 'all' when the entry is undefined", () => {
			const project = {
				agentReviewEventPolicies: { review: undefined },
			};
			expect(resolveReviewEventPolicy(project, 'review')).toBe('all');
		});

		it('uses DEFAULT_REVIEW_EVENT_POLICY as the fallback', () => {
			expect(resolveReviewEventPolicy({}, 'anything')).toBe(DEFAULT_REVIEW_EVENT_POLICY);
		});
	});

	describe('isCommentOnlyReview', () => {
		it("'all' is not comment-only", () => {
			expect(isCommentOnlyReview('all')).toBe(false);
		});

		it("'comment-only' is comment-only", () => {
			expect(isCommentOnlyReview('comment-only')).toBe(true);
		});
	});

	describe('buildAdvisoryPreamble', () => {
		it('APPROVE reads "would approve"', () => {
			const preamble = buildAdvisoryPreamble('APPROVE');
			expect(preamble).toContain('**Advisory verdict: would approve**');
		});

		it('REQUEST_CHANGES reads "would request changes"', () => {
			const preamble = buildAdvisoryPreamble('REQUEST_CHANGES');
			expect(preamble).toContain('**Advisory verdict: would request changes**');
		});

		it('COMMENT reads "comment"', () => {
			const preamble = buildAdvisoryPreamble('COMMENT');
			expect(preamble).toContain('**Advisory verdict: comment**');
		});

		it('every preamble explains the non-blocking semantics', () => {
			for (const event of REVIEW_EVENTS) {
				const preamble = buildAdvisoryPreamble(event);
				expect(preamble).toContain('comment-only review mode');
				expect(preamble).toContain('does not block merging');
			}
		});

		it('is a single line', () => {
			for (const event of REVIEW_EVENTS) {
				expect(buildAdvisoryPreamble(event)).not.toContain('\n');
			}
		});
	});

	describe('applyReviewEventPolicy', () => {
		const BODY = 'Found two issues in the error handling path.';

		describe("'all' policy (identity)", () => {
			for (const event of REVIEW_EVENTS) {
				it(`passes ${event} through untouched`, () => {
					const applied = applyReviewEventPolicy(event, BODY, 'all');
					expect(applied).toEqual({ event, body: BODY });
					expect(applied.advisoryEvent).toBeUndefined();
				});
			}
		});

		describe("'comment-only' policy (coercion)", () => {
			for (const event of REVIEW_EVENTS) {
				it(`downgrades ${event} to COMMENT and records the advisory event`, () => {
					const applied = applyReviewEventPolicy(event, BODY, 'comment-only');
					expect(applied.event).toBe('COMMENT');
					expect(applied.advisoryEvent).toBe(event);
				});

				it(`leads the ${event} body with the advisory preamble, original body intact`, () => {
					const applied = applyReviewEventPolicy(event, BODY, 'comment-only');
					expect(applied.body).toBe(`${buildAdvisoryPreamble(event)}\n\n${BODY}`);
				});
			}

			it('coerces every event to a valid ReviewEvent', () => {
				for (const event of REVIEW_EVENTS) {
					const applied = applyReviewEventPolicy(event, BODY, 'comment-only');
					expect(REVIEW_EVENTS).toContain(applied.event);
				}
			});
		});

		it('never mutates its inputs (returns fresh values)', () => {
			const event: ReviewEvent = 'APPROVE';
			const applied = applyReviewEventPolicy(event, BODY, 'comment-only');
			expect(event).toBe('APPROVE');
			expect(BODY).toBe('Found two issues in the error handling path.');
			expect(applied.body).not.toBe(BODY);
		});
	});
});
