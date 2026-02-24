import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckSuiteSuccessTrigger } from '../../../src/triggers/github/check-suite-success.js';
import type { TriggerContext } from '../../../src/triggers/types.js';

vi.mock('../../../src/github/client.js', () => ({
	githubClient: {
		getPR: vi.fn(),
		getPRReviews: vi.fn(),
		getCheckSuiteStatus: vi.fn(),
	},
}));

import { githubClient } from '../../../src/github/client.js';

vi.mock('../../../src/db/repositories/prWorkItemsRepository.js', () => ({
	lookupWorkItemForPR: vi.fn(),
}));

import { lookupWorkItemForPR } from '../../../src/db/repositories/prWorkItemsRepository.js';

describe('CheckSuiteSuccessTrigger', () => {
	const trigger = new CheckSuiteSuccessTrigger();

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

	const makeCheckSuitePayload = (overrides: Record<string, unknown> = {}) => ({
		action: 'completed',
		check_suite: {
			id: 1,
			status: 'completed',
			conclusion: 'success',
			head_sha: 'sha123',
			pull_requests: [{ number: 42, head: { ref: 'feature/test', sha: 'sha123' } }],
		},
		repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
		sender: { login: 'github-actions' },
		...overrides,
	});

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(lookupWorkItemForPR).mockResolvedValue(null);
	});

	describe('matches', () => {
		it('matches completed check suite with success conclusion and PRs', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
			};

			expect(trigger.matches(ctx)).toBe(true);
		});

		it('does not match trello source', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: {},
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match non-completed action', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload({
					action: 'requested',
				}),
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match failure conclusion', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					action: 'completed',
					check_suite: {
						id: 1,
						status: 'completed',
						conclusion: 'failure',
						head_sha: 'sha123',
						pull_requests: [{ number: 42, head: { ref: 'feat', sha: 'sha123' } }],
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'github-actions' },
				},
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match when no PRs associated', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					action: 'completed',
					check_suite: {
						id: 1,
						status: 'completed',
						conclusion: 'success',
						head_sha: 'sha123',
						pull_requests: [],
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'github-actions' },
				},
			};

			expect(trigger.matches(ctx)).toBe(false);
		});
	});

	describe('handle', () => {
		it('returns review result with waitForChecks flag when PR matches', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123/card-name',
				state: 'closed',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				user: { login: 'cascade-impl' },
			});
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([]);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(githubClient.getPR).toHaveBeenCalledWith('owner', 'repo', 42);
			// handle() no longer polls checks — it defers to worker via waitForChecks flag
			expect(githubClient.getCheckSuiteStatus).not.toHaveBeenCalled();
			expect(result).toEqual({
				agentType: 'review',
				agentInput: {
					prNumber: 42,
					prBranch: 'feature/test',
					repoFullName: 'owner/repo',
					headSha: 'sha123',
					triggerType: 'ci-success',
					cardId: 'abc123',
				},
				prNumber: 42,
				workItemId: 'abc123',
				waitForChecks: true,
			});
		});

		it('returns null when PR targets non-base branch', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123/card-name',
				state: 'open',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'develop',
				merged: false,
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				user: { login: 'cascade-impl' },
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
			expect(githubClient.getPRReviews).not.toHaveBeenCalled();
			expect(githubClient.getCheckSuiteStatus).not.toHaveBeenCalled();
		});

		it('returns null when PR not authored by implementer persona', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123/card-name',
				state: 'open',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				user: { login: 'some-human' },
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
			expect(githubClient.getCheckSuiteStatus).not.toHaveBeenCalled();
		});

		it('returns null when no personaIdentities available', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123/card-name',
				state: 'open',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				user: { login: 'cascade-impl' },
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
			expect(githubClient.getCheckSuiteStatus).not.toHaveBeenCalled();
		});

		it('returns null when PR was already reviewed by reviewer persona at current HEAD', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123/card-name',
				state: 'open',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				user: { login: 'cascade-impl' },
			});
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([
				{
					id: 1,
					user: { login: 'cascade-reviewer' },
					state: 'approved',
					body: 'LGTM',
					submittedAt: '',
					commitId: 'sha123',
				},
			]);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
			expect(githubClient.getCheckSuiteStatus).not.toHaveBeenCalled();
		});

		it('re-triggers when review commitId differs from headSha', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123/card-name',
				state: 'open',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				user: { login: 'cascade-impl' },
			});
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([
				{
					id: 1,
					user: { login: 'cascade-reviewer' },
					state: 'changes_requested',
					body: 'Please fix',
					submittedAt: '',
					commitId: 'old-sha',
				},
			]);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('review');
			expect(result?.waitForChecks).toBe(true);
		});

		it('skips when latest of multiple reviews covers current HEAD', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123/card-name',
				state: 'open',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				user: { login: 'cascade-impl' },
			});
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([
				{
					id: 1,
					user: { login: 'cascade-reviewer' },
					state: 'changes_requested',
					body: 'Please fix',
					submittedAt: '',
					commitId: 'old-sha',
				},
				{
					id: 2,
					user: { login: 'cascade-reviewer' },
					state: 'approved',
					body: 'LGTM',
					submittedAt: '',
					commitId: 'sha123',
				},
			]);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
			expect(githubClient.getCheckSuiteStatus).not.toHaveBeenCalled();
		});

		it('ignores COMMENTED reviews from implementer bot when checking for prior review', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123/card-name',
				state: 'open',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				user: { login: 'cascade-impl' },
			});
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([
				{
					id: 1,
					user: { login: 'cascade-reviewer' },
					state: 'changes_requested',
					body: 'Please fix',
					submittedAt: '',
					commitId: 'old-sha',
				},
				{
					id: 2,
					user: { login: 'cascade-impl' },
					state: 'commented',
					body: '',
					submittedAt: '',
					commitId: 'sha123',
				},
				{
					id: 3,
					user: { login: 'cascade-impl' },
					state: 'commented',
					body: '',
					submittedAt: '',
					commitId: 'sha123',
				},
			]);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('review');
			expect(result?.waitForChecks).toBe(true);
		});

		it('proceeds when PR has reviews from other users only', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123/card-name',
				state: 'open',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				user: { login: 'cascade-impl' },
			});
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([
				{
					id: 1,
					user: { login: 'human-reviewer' },
					state: 'commented',
					body: 'Nice work',
					submittedAt: '',
					commitId: 'sha123',
				},
			]);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('review');
			expect(result?.waitForChecks).toBe(true);
		});

		it('fires without work item when PR body has no work item reference', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'No work item link',
				state: 'open',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				user: { login: 'cascade-impl' },
			});
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([]);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.workItemId).toBeUndefined();
			expect(result?.agentInput.cardId).toBeUndefined();
			expect(result?.waitForChecks).toBe(true);
		});

		it('uses DB lookup result over PR body extraction', async () => {
			vi.mocked(lookupWorkItemForPR).mockResolvedValue('db-work-item');
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123',
				state: 'open',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				user: { login: 'cascade-impl' },
			});
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([]);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.workItemId).toBe('db-work-item');
			expect(result?.waitForChecks).toBe(true);
		});
	});

	describe('reviewTrigger mode-aware behavior', () => {
		/** Project with only externalPrs enabled */
		const mockProjectExternalOnly = {
			...mockProject,
			github: {
				triggers: {
					reviewTrigger: { ownPrsOnly: false, externalPrs: true, onReviewRequested: false },
				},
			},
		};

		/** Project with both ownPrsOnly and externalPrs enabled */
		const mockProjectBothModes = {
			...mockProject,
			github: {
				triggers: {
					reviewTrigger: { ownPrsOnly: true, externalPrs: true, onReviewRequested: false },
				},
			},
		};

		/** Project with all modes disabled */
		const mockProjectNoModes = {
			...mockProject,
			github: {
				triggers: {
					reviewTrigger: { ownPrsOnly: false, externalPrs: false, onReviewRequested: false },
				},
			},
		};

		it('does not match when all modes are disabled', () => {
			const ctx: TriggerContext = {
				project: mockProjectNoModes,
				source: 'github',
				payload: makeCheckSuitePayload(),
			};
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('matches when externalPrs is enabled', () => {
			const ctx: TriggerContext = {
				project: mockProjectExternalOnly,
				source: 'github',
				payload: makeCheckSuitePayload(),
			};
			expect(trigger.matches(ctx)).toBe(true);
		});

		it('matches when both modes are enabled', () => {
			const ctx: TriggerContext = {
				project: mockProjectBothModes,
				source: 'github',
				payload: makeCheckSuitePayload(),
			};
			expect(trigger.matches(ctx)).toBe(true);
		});

		it('triggers for external PR author when externalPrs=true', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'External PR',
				body: 'https://trello.com/c/abc123',
				state: 'open',
				headRef: 'feature/external',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				user: { login: 'external-contributor' },
			});
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([]);

			const ctx: TriggerContext = {
				project: mockProjectExternalOnly,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('review');
		});

		it('skips implementer PR when only externalPrs=true', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Implementer PR',
				body: 'https://trello.com/c/abc123',
				state: 'open',
				headRef: 'feature/impl',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				user: { login: 'cascade-impl' },
			});

			const ctx: TriggerContext = {
				project: mockProjectExternalOnly,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});

		it('triggers for both authors when ownPrsOnly=true and externalPrs=true', async () => {
			const setupMocks = (authorLogin: string) => {
				vi.mocked(githubClient.getPR).mockResolvedValue({
					number: 42,
					title: 'Test PR',
					body: null,
					state: 'open',
					headRef: 'feature/test',
					headSha: 'sha123',
					baseRef: 'main',
					merged: false,
					htmlUrl: 'https://github.com/owner/repo/pull/42',
					user: { login: authorLogin },
				});
				vi.mocked(githubClient.getPRReviews).mockResolvedValue([]);
			};

			// Implementer PR
			setupMocks('cascade-impl');
			const implCtx: TriggerContext = {
				project: mockProjectBothModes,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};
			const implResult = await trigger.handle(implCtx);
			expect(implResult).not.toBeNull();

			// External PR
			vi.clearAllMocks();
			vi.mocked(lookupWorkItemForPR).mockResolvedValue(null);
			setupMocks('external-contributor');
			const extCtx: TriggerContext = {
				project: mockProjectBothModes,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};
			const extResult = await trigger.handle(extCtx);
			expect(extResult).not.toBeNull();
		});

		it('backward compat: legacy checkSuiteSuccess=true still triggers for implementer PRs', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: null,
				state: 'open',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				user: { login: 'cascade-impl' },
			});
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([]);

			// mockProject has no github triggers — resolves to legacy defaults (ownPrsOnly=true)
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);
			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('review');
		});

		it('backward compat: legacy checkSuiteSuccess=false skips even implementer PRs', () => {
			const ctx: TriggerContext = {
				project: {
					...mockProject,
					github: { triggers: { checkSuiteSuccess: false } },
				},
				source: 'github',
				payload: makeCheckSuitePayload(),
			};
			expect(trigger.matches(ctx)).toBe(false);
		});
	});
});
