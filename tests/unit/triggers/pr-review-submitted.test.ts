import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConfigResolverModule, mockTriggerCheckModule } from '../../helpers/sharedMocks.js';
import { expectSkipFor } from '../../helpers/triggerAssertions.js';

const expectSkip = expectSkipFor('pr-review-submitted');

vi.mock('../../../src/triggers/config-resolver.js', () => mockConfigResolverModule);

vi.mock('../../../src/triggers/shared/trigger-check.js', () => mockTriggerCheckModule);

import { PRReviewSubmittedTrigger } from '../../../src/triggers/github/pr-review-submitted.js';
import type { TriggerContext } from '../../../src/triggers/types.js';
import { createMockProject, createReviewPayload } from '../../helpers/factories.js';
import { mockPersonaIdentities } from '../../helpers/mockPersonas.js';

vi.mock('../../../src/db/repositories/prWorkItemsRepository.js', () => ({
	lookupWorkItemForPR: vi.fn(),
}));

import { lookupWorkItemForPR } from '../../../src/db/repositories/prWorkItemsRepository.js';
import { checkTriggerEnabled } from '../../../src/triggers/shared/trigger-check.js';

describe('PRReviewSubmittedTrigger', () => {
	const trigger = new PRReviewSubmittedTrigger();

	beforeEach(() => {
		vi.mocked(lookupWorkItemForPR).mockResolvedValue('abc123');
	});

	const mockProject = createMockProject();

	const makeReviewPayload = (overrides: Record<string, unknown> = {}) =>
		createReviewPayload(overrides as Parameters<typeof createReviewPayload>[0]);

	describe('matches', () => {
		it('matches submitted review with changes_requested', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewPayload(),
			};

			expect(trigger.matches(ctx)).toBe(true);
		});

		it('matches submitted review with commented state', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewPayload({
					review: {
						id: 100,
						state: 'commented',
						body: 'Nice work',
						html_url: 'https://github.com/...',
						user: { login: 'cascade-reviewer' },
					},
				}),
			};

			expect(trigger.matches(ctx)).toBe(true);
		});

		it('does not match dismissed reviews (action is dismissed, not submitted)', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewPayload({
					action: 'dismissed',
					review: {
						id: 100,
						state: 'dismissed',
						body: 'Dismissed',
						html_url: 'https://github.com/...',
						user: { login: 'cascade-reviewer' },
					},
				}),
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match trello source', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: {},
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match non-submitted action', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewPayload({ action: 'edited' }),
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match approved reviews', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewPayload({
					review: {
						id: 100,
						state: 'approved',
						body: 'LGTM',
						html_url: 'https://github.com/...',
						user: { login: 'cascade-reviewer' },
					},
				}),
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match non-review payloads', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: { action: 'submitted' },
			};

			expect(trigger.matches(ctx)).toBe(false);
		});
	});

	describe('handle', () => {
		it('should return null when trigger is disabled', async () => {
			vi.mocked(checkTriggerEnabled).mockResolvedValueOnce(false);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewPayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);
			expectSkip(result);
			expect(checkTriggerEnabled).toHaveBeenCalledWith(
				'test',
				'respond-to-review',
				'scm:pr-review-submitted',
				'pr-review-submitted',
			);
		});

		it('returns respond-to-review result when reviewer persona posts changes_requested', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewPayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).toEqual({
				agentType: 'respond-to-review',
				agentInput: {
					prNumber: 42,
					prBranch: 'feature/test',
					repoFullName: 'owner/repo',
					headSha: 'sha123',
					triggerCommentId: 100,
					triggerCommentBody: 'Please fix the bug',
					triggerCommentPath: '',
					triggerCommentUrl: 'https://github.com/owner/repo/pull/42#pullrequestreview-100',
					triggerEvent: 'scm:pr-review-submitted',
					workItemId: 'abc123',
				},
				prNumber: 42,
				prUrl: 'https://github.com/owner/repo/pull/42',
				prTitle: 'Test PR',
				workItemId: 'abc123',
			});
		});

		it('returns null for review from implementer persona', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewPayload({
					review: {
						id: 100,
						state: 'changes_requested',
						body: 'Fix this',
						html_url: 'https://github.com/...',
						user: { login: 'cascade-impl' },
					},
				}),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expectSkip(result);
		});

		it('returns null for review from human user', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewPayload({
					review: {
						id: 100,
						state: 'changes_requested',
						body: 'Fix this',
						html_url: 'https://github.com/owner/repo/pull/42#pullrequestreview-100',
						user: { login: 'some-human' },
					},
				}),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expectSkip(result);
		});

		it('returns null when no persona identities available', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewPayload(),
			};

			const result = await trigger.handle(ctx);

			expectSkip(result);
		});

		it('fires without work item when PR has no work item reference', async () => {
			vi.mocked(lookupWorkItemForPR).mockResolvedValue(null);
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewPayload({
					pull_request: {
						number: 42,
						title: 'Test PR',
						body: 'No Trello link',
						html_url: 'https://github.com/owner/repo/pull/42',
						head: { ref: 'feature/test', sha: 'abc' },
						base: { ref: 'main' },
					},
				}),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.workItemId).toBeUndefined();
		});

		it('uses review state as fallback when review body is null', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewPayload({
					review: {
						id: 100,
						state: 'changes_requested',
						body: null,
						html_url: 'https://github.com/owner/repo/pull/42#pullrequestreview-100',
						user: { login: 'cascade-reviewer' },
					},
				}),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result?.agentInput.triggerCommentBody).toBe('Review: changes_requested');
		});

		it('returns respond-to-review result when reviewer persona posts commented review', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewPayload({
					review: {
						id: 200,
						state: 'commented',
						body: 'Left some inline comments',
						html_url: 'https://github.com/owner/repo/pull/42#pullrequestreview-200',
						user: { login: 'cascade-reviewer' },
					},
				}),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).toEqual({
				agentType: 'respond-to-review',
				agentInput: {
					prNumber: 42,
					prBranch: 'feature/test',
					repoFullName: 'owner/repo',
					headSha: 'sha123',
					triggerCommentId: 200,
					triggerCommentBody: 'Left some inline comments',
					triggerCommentPath: '',
					triggerCommentUrl: 'https://github.com/owner/repo/pull/42#pullrequestreview-200',
					triggerEvent: 'scm:pr-review-submitted',
					workItemId: 'abc123',
				},
				prNumber: 42,
				prUrl: 'https://github.com/owner/repo/pull/42',
				prTitle: 'Test PR',
				workItemId: 'abc123',
			});
		});

		it('propagates workItemId into agentInput so tryCreateRun persists it on agent_runs', async () => {
			// Regression: respond-to-review runs were stored with NULL work_item_id
			// because workItemId was set at the top-level only, not on agentInput.
			// runTracking reads input.workItemId from agentInput; the dashboard's
			// work-item page filters by agent_runs.work_item_id. Live incident:
			// 4 respond-to-review runs for ucho/MNG-400 (PR #136) on 2026-04-28
			// were invisible on the work-item page despite firing successfully.
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewPayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result?.workItemId).toBe('abc123');
			expect(result?.agentInput.workItemId).toBe('abc123');
		});

		it('uses Review: commented fallback when commented review has null body', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewPayload({
					review: {
						id: 200,
						state: 'commented',
						body: null,
						html_url: 'https://github.com/owner/repo/pull/42#pullrequestreview-200',
						user: { login: 'cascade-reviewer' },
					},
				}),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result?.agentInput.triggerCommentBody).toBe('Review: commented');
		});
	});
});
