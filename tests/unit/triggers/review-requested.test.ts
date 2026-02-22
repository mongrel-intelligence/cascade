import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewRequestedTrigger } from '../../../src/triggers/github/review-requested.js';
import type { TriggerContext } from '../../../src/triggers/types.js';

vi.mock('../../../src/db/repositories/prWorkItemsRepository.js', () => ({
	lookupWorkItemForPR: vi.fn(),
}));
import { lookupWorkItemForPR } from '../../../src/db/repositories/prWorkItemsRepository.js';

describe('ReviewRequestedTrigger', () => {
	const trigger = new ReviewRequestedTrigger();

	const mockProject = {
		id: 'test',
		name: 'Test',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		trello: {
			boardId: 'board123',
			lists: {
				briefing: 'briefing-list-id',
				planning: 'planning-list-id',
				todo: 'todo-list-id',
			},
			labels: {},
		},
		// Review-requested is opt-in, default disabled
	};

	/** Project with reviewRequested trigger explicitly enabled */
	const mockProjectWithReviewRequested = {
		...mockProject,
		github: {
			triggers: { reviewRequested: true },
		},
	};

	const mockPersonaIdentities = {
		implementer: 'cascade-impl',
		reviewer: 'cascade-reviewer',
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(lookupWorkItemForPR).mockResolvedValue(null);
	});

	const makeReviewRequestedPayload = (reviewerLogin = 'cascade-reviewer') => ({
		action: 'review_requested',
		number: 42,
		pull_request: {
			number: 42,
			title: 'Test PR',
			body: 'Implements https://trello.com/c/abc123/card-name',
			html_url: 'https://github.com/owner/repo/pull/42',
			state: 'open',
			draft: false,
			head: { ref: 'feature/test', sha: 'abc123' },
			base: { ref: 'main' },
			user: { login: 'author' },
		},
		requested_reviewer: { login: reviewerLogin },
		repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
		sender: { login: 'author' },
	});

	describe('resolveAgentType', () => {
		it('returns review', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {},
			};
			expect(trigger.resolveAgentType(ctx)).toBe('review');
		});
	});

	describe('matches', () => {
		it('does not match by default (opt-in trigger, disabled without config)', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewRequestedPayload(),
				personaIdentities: mockPersonaIdentities,
			};
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('matches when review_requested and trigger is enabled', () => {
			const ctx: TriggerContext = {
				project: mockProjectWithReviewRequested,
				source: 'github',
				payload: makeReviewRequestedPayload(),
				personaIdentities: mockPersonaIdentities,
			};
			expect(trigger.matches(ctx)).toBe(true);
		});

		it('does not match when source is not github', () => {
			const ctx: TriggerContext = {
				project: mockProjectWithReviewRequested,
				source: 'trello',
				payload: makeReviewRequestedPayload(),
				personaIdentities: mockPersonaIdentities,
			};
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match on non-review_requested actions', () => {
			const ctx: TriggerContext = {
				project: mockProjectWithReviewRequested,
				source: 'github',
				payload: {
					...makeReviewRequestedPayload(),
					action: 'opened',
				},
				personaIdentities: mockPersonaIdentities,
			};
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match when payload is not a PR payload', () => {
			const ctx: TriggerContext = {
				project: mockProjectWithReviewRequested,
				source: 'github',
				payload: { action: 'review_requested', something: 'else' },
				personaIdentities: mockPersonaIdentities,
			};
			expect(trigger.matches(ctx)).toBe(false);
		});
	});

	describe('handle', () => {
		it('returns null when no persona identities', async () => {
			const ctx: TriggerContext = {
				project: mockProjectWithReviewRequested,
				source: 'github',
				payload: makeReviewRequestedPayload(),
				// no personaIdentities
			};
			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('returns null when requested reviewer is not a CASCADE persona', async () => {
			const ctx: TriggerContext = {
				project: mockProjectWithReviewRequested,
				source: 'github',
				payload: makeReviewRequestedPayload('human-reviewer'),
				personaIdentities: mockPersonaIdentities,
			};
			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('returns null when no requested reviewer in payload', async () => {
			const ctx: TriggerContext = {
				project: mockProjectWithReviewRequested,
				source: 'github',
				payload: {
					...makeReviewRequestedPayload(),
					requested_reviewer: undefined,
				},
				personaIdentities: mockPersonaIdentities,
			};
			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('fires without work item when PR has no work item reference', async () => {
			const ctx: TriggerContext = {
				project: mockProjectWithReviewRequested,
				source: 'github',
				payload: {
					...makeReviewRequestedPayload(),
					pull_request: {
						...makeReviewRequestedPayload().pull_request,
						body: 'No card URL here',
					},
				},
				personaIdentities: mockPersonaIdentities,
			};
			const result = await trigger.handle(ctx);
			expect(result).not.toBeNull();
			expect(result?.workItemId).toBeUndefined();
		});

		it('triggers review agent when reviewer persona is requested', async () => {
			const ctx: TriggerContext = {
				project: mockProjectWithReviewRequested,
				source: 'github',
				payload: makeReviewRequestedPayload('cascade-reviewer'),
				personaIdentities: mockPersonaIdentities,
			};
			const result = await trigger.handle(ctx);
			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('review');
			expect(result?.prNumber).toBe(42);
			expect(result?.workItemId).toBe('abc123');
			expect(result?.agentInput).toMatchObject({
				prNumber: 42,
				repoFullName: 'owner/repo',
				triggerType: 'review-requested',
				cardId: 'abc123',
			});
		});

		it('triggers review agent when implementer persona is requested', async () => {
			const ctx: TriggerContext = {
				project: mockProjectWithReviewRequested,
				source: 'github',
				payload: makeReviewRequestedPayload('cascade-impl'),
				personaIdentities: mockPersonaIdentities,
			};
			const result = await trigger.handle(ctx);
			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('review');
		});
	});
});
