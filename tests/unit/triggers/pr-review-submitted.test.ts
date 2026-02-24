import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRReviewSubmittedTrigger } from '../../../src/triggers/github/pr-review-submitted.js';
import type { TriggerContext } from '../../../src/triggers/types.js';

vi.mock('../../../src/db/repositories/prWorkItemsRepository.js', () => ({
	lookupWorkItemForPR: vi.fn(),
}));
import { lookupWorkItemForPR } from '../../../src/db/repositories/prWorkItemsRepository.js';

describe('PRReviewSubmittedTrigger', () => {
	const trigger = new PRReviewSubmittedTrigger();

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(lookupWorkItemForPR).mockResolvedValue(null);
	});

	const mockProject = {
		id: 'test',
		name: 'Test',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		trello: {
			boardId: 'board123',
			lists: {
				splitting: 'splitting-list-id',
				planning: 'planning-list-id',
				todo: 'todo-list-id',
			},
			labels: {},
		},
	};

	const mockPersonaIdentities = {
		implementer: 'cascade-impl',
		reviewer: 'cascade-reviewer',
	};

	const makeReviewPayload = (overrides: Record<string, unknown> = {}) => ({
		action: 'submitted',
		review: {
			id: 100,
			state: 'changes_requested',
			body: 'Please fix the bug',
			html_url: 'https://github.com/owner/repo/pull/42#pullrequestreview-100',
			user: { login: 'cascade-reviewer' },
		},
		pull_request: {
			number: 42,
			title: 'Test PR',
			body: 'https://trello.com/c/abc123/card-name',
			html_url: 'https://github.com/owner/repo/pull/42',
			head: { ref: 'feature/test', sha: 'abc' },
			base: { ref: 'main' },
		},
		repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
		sender: { login: 'cascade-reviewer' },
		...overrides,
	});

	describe('matches', () => {
		it('matches submitted review with changes_requested', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewPayload(),
			};

			expect(trigger.matches(ctx)).toBe(true);
		});

		it('does not match submitted review with commented state', () => {
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
					triggerCommentId: 100,
					triggerCommentBody: 'Please fix the bug',
					triggerCommentPath: '',
					triggerCommentUrl: 'https://github.com/owner/repo/pull/42#pullrequestreview-100',
				},
				prNumber: 42,
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

			expect(result).toBeNull();
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

			expect(result).toBeNull();
		});

		it('returns null when no persona identities available', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewPayload(),
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});

		it('fires without work item when PR has no work item reference', async () => {
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
	});
});
