import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConfigResolverModule, mockTriggerCheckModule } from '../../helpers/sharedMocks.js';

vi.mock('../../../src/triggers/config-resolver.js', () => mockConfigResolverModule);

vi.mock('../../../src/triggers/shared/trigger-check.js', () => mockTriggerCheckModule);

import { recentlyDispatched } from '../../../src/triggers/github/review-dispatch-dedup.js';
import { ReviewRequestedTrigger } from '../../../src/triggers/github/review-requested.js';
import type { TriggerContext } from '../../../src/triggers/types.js';
import { createMockProject } from '../../helpers/factories.js';
import { mockPersonaIdentities } from '../../helpers/mockPersonas.js';

vi.mock('../../../src/db/repositories/prWorkItemsRepository.js', () => ({
	lookupWorkItemForPR: vi.fn(),
}));
import { lookupWorkItemForPR } from '../../../src/db/repositories/prWorkItemsRepository.js';
import { checkTriggerEnabled } from '../../../src/triggers/shared/trigger-check.js';

describe('ReviewRequestedTrigger', () => {
	const trigger = new ReviewRequestedTrigger();

	const mockProject = createMockProject();

	beforeEach(() => {
		vi.mocked(lookupWorkItemForPR).mockResolvedValue('abc123');
		vi.mocked(checkTriggerEnabled).mockResolvedValue(true);
		recentlyDispatched.clear();
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

	describe('matches', () => {
		it('matches when review_requested action on a PR payload', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewRequestedPayload(),
				personaIdentities: mockPersonaIdentities,
			};
			expect(trigger.matches(ctx)).toBe(true);
		});

		it('does not match when source is not github', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: makeReviewRequestedPayload(),
				personaIdentities: mockPersonaIdentities,
			};
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match on non-review_requested actions', () => {
			const ctx: TriggerContext = {
				project: mockProject,
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
				project: mockProject,
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
				project: mockProject,
				source: 'github',
				payload: makeReviewRequestedPayload(),
				// no personaIdentities
			};
			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('returns null when sender is the implementer persona (loop prevention)', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					...makeReviewRequestedPayload('cascade-reviewer'),
					sender: { login: 'cascade-impl' },
				},
				personaIdentities: mockPersonaIdentities,
			};
			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('returns null when sender is the reviewer persona (loop prevention)', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					...makeReviewRequestedPayload('cascade-impl'),
					sender: { login: 'cascade-reviewer' },
				},
				personaIdentities: mockPersonaIdentities,
			};
			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('returns null when a persona requests review from itself (loop prevention)', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					...makeReviewRequestedPayload('cascade-impl'),
					sender: { login: 'cascade-impl' },
				},
				personaIdentities: mockPersonaIdentities,
			};
			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('returns null when requested reviewer is not a CASCADE persona', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewRequestedPayload('human-reviewer'),
				personaIdentities: mockPersonaIdentities,
			};
			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('returns null when no requested reviewer in payload', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
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
			vi.mocked(lookupWorkItemForPR).mockResolvedValue(null);
			const ctx: TriggerContext = {
				project: mockProject,
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
				project: mockProject,
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
				headSha: 'abc123',
				triggerType: 'review-requested',
				triggerEvent: 'scm:review-requested',
				workItemId: 'abc123',
			});
			expect(result?.onBlocked).toBeTypeOf('function');
		});

		it('triggers review agent when implementer persona is requested', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewRequestedPayload('cascade-impl'),
				personaIdentities: mockPersonaIdentities,
			};
			const result = await trigger.handle(ctx);
			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('review');
		});

		it('overrides a prior dispatch and fires even when the same PR+SHA was already dispatched', async () => {
			// Human-initiated review requests always supersede automated dispatch claims.
			recentlyDispatched.set('owner/repo:42:abc123', Date.now());

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewRequestedPayload('cascade-reviewer'),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result?.agentType).toBe('review');
		});
	});

	describe('trigger config via checkTriggerEnabled', () => {
		it('handle returns null when trigger is disabled', async () => {
			vi.mocked(checkTriggerEnabled).mockResolvedValueOnce(false);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewRequestedPayload('cascade-reviewer'),
				personaIdentities: mockPersonaIdentities,
			};
			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
			expect(checkTriggerEnabled).toHaveBeenCalledWith(
				'test',
				'review',
				'scm:review-requested',
				'review-requested',
			);
		});

		it('triggers review agent when trigger is enabled', async () => {
			vi.mocked(checkTriggerEnabled).mockResolvedValueOnce(true);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewRequestedPayload('cascade-reviewer'),
				personaIdentities: mockPersonaIdentities,
			};
			const result = await trigger.handle(ctx);
			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('review');
		});
	});
});
