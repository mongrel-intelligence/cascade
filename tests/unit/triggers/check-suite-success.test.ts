import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockGitHubClientModule, mockTriggerCheckModule } from '../../helpers/sharedMocks.js';

vi.mock('../../../src/triggers/config-resolver.js', () => ({
	isTriggerEnabled: vi.fn().mockResolvedValue(true),
	getTriggerParameters: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../src/triggers/shared/trigger-check.js', () => mockTriggerCheckModule);

vi.mock('../../../src/github/client.js', () => mockGitHubClientModule);

import {
	CheckSuiteSuccessTrigger,
	recentlyDispatched,
	waitForChecks,
} from '../../../src/triggers/github/check-suite-success.js';
import { ReviewRequestedTrigger } from '../../../src/triggers/github/review-requested.js';
import type { TriggerContext } from '../../../src/triggers/types.js';
import { createMockProject } from '../../helpers/factories.js';
import { mockPersonaIdentities } from '../../helpers/mockPersonas.js';

import { githubClient } from '../../../src/github/client.js';

vi.mock('../../../src/db/repositories/prWorkItemsRepository.js', () => ({
	lookupWorkItemForPR: vi.fn(),
}));

import { lookupWorkItemForPR } from '../../../src/db/repositories/prWorkItemsRepository.js';
import { checkTriggerEnabledWithParams } from '../../../src/triggers/shared/trigger-check.js';

describe('CheckSuiteSuccessTrigger', () => {
	const trigger = new CheckSuiteSuccessTrigger();
	const reviewRequestedTrigger = new ReviewRequestedTrigger();

	const mockProject = createMockProject();

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
		vi.mocked(lookupWorkItemForPR).mockResolvedValue('abc123');
		recentlyDispatched.clear();
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
			expect(result).toEqual(
				expect.objectContaining({
					agentType: 'review',
					agentInput: {
						prNumber: 42,
						prBranch: 'feature/test',
						repoFullName: 'owner/repo',
						headSha: 'sha123',
						triggerType: 'ci-success',
						workItemId: 'abc123',
						triggerEvent: 'scm:check-suite-success',
					},
					prNumber: 42,
					workItemId: 'abc123',
					waitForChecks: true,
				}),
			);
			expect(result?.onBlocked).toBeTypeOf('function');
		});

		it('returns null when review-requested already claimed the same PR head SHA', async () => {
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
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([]);

			const reviewRequestedContext: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					action: 'review_requested',
					number: 42,
					pull_request: {
						number: 42,
						title: 'Test PR',
						body: 'https://trello.com/c/abc123/card-name',
						html_url: 'https://github.com/owner/repo/pull/42',
						state: 'open',
						draft: false,
						head: { ref: 'feature/test', sha: 'sha123' },
						base: { ref: 'main' },
						user: { login: 'author' },
					},
					requested_reviewer: { login: 'cascade-reviewer' },
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'author' },
				},
				personaIdentities: mockPersonaIdentities,
			};

			const reviewRequestedResult = await reviewRequestedTrigger.handle(reviewRequestedContext);
			expect(reviewRequestedResult?.agentType).toBe('review');

			const checkSuiteContext: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const checkSuiteResult = await trigger.handle(checkSuiteContext);

			expect(checkSuiteResult).toBeNull();
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

		it('fires without work item when DB has no link', async () => {
			vi.mocked(lookupWorkItemForPR).mockResolvedValue(null);
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
			expect(result?.agentInput.workItemId).toBeUndefined();
			expect(result?.waitForChecks).toBe(true);
		});

		it('skips duplicate check_suite events for the same PR+SHA', async () => {
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
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([]);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			// First call should succeed
			const result1 = await trigger.handle(ctx);
			expect(result1).not.toBeNull();
			expect(result1?.agentType).toBe('review');

			// Second call with same PR+SHA should be deduped
			const result2 = await trigger.handle(ctx);
			expect(result2).toBeNull();
		});

		it('onBlocked callback clears the dedup entry', async () => {
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
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([]);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);
			expect(result).not.toBeNull();
			expect(result?.onBlocked).toBeTypeOf('function');
			expect(recentlyDispatched.size).toBe(1);

			// Simulate router calling onBlocked (work-item lock or concurrency block)
			result?.onBlocked?.();
			expect(recentlyDispatched.size).toBe(0);

			// After onBlocked, a subsequent call should succeed (not be deduped)
			const result2 = await trigger.handle(ctx);
			expect(result2).not.toBeNull();
			expect(result2?.agentType).toBe('review');
		});

		it('allows review for same PR with a new SHA after dedup', async () => {
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([]);

			// First call with sha123
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

			const ctx1: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};
			const result1 = await trigger.handle(ctx1);
			expect(result1).not.toBeNull();

			// Second call with new SHA should trigger
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: null,
				state: 'open',
				headRef: 'feature/test',
				headSha: 'newsha456',
				baseRef: 'main',
				merged: false,
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				user: { login: 'cascade-impl' },
			});

			const ctx2: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload({
					check_suite: {
						id: 2,
						status: 'completed',
						conclusion: 'success',
						head_sha: 'newsha456',
						pull_requests: [{ number: 42, head: { ref: 'feature/test', sha: 'newsha456' } }],
					},
				}),
				personaIdentities: mockPersonaIdentities,
			};
			const result2 = await trigger.handle(ctx2);
			expect(result2).not.toBeNull();
			expect(result2?.agentInput.headSha).toBe('newsha456');
		});

		it('uses DB lookup result for work item resolution', async () => {
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

	describe('authorMode-aware behavior via trigger parameters', () => {
		it('handle returns null when trigger is disabled via checkTriggerEnabledWithParams', async () => {
			vi.mocked(checkTriggerEnabledWithParams).mockResolvedValueOnce({
				enabled: false,
				parameters: {},
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
			expect(checkTriggerEnabledWithParams).toHaveBeenCalledWith(
				'test',
				'review',
				'scm:check-suite-success',
				'check-suite-success',
			);
		});

		it('triggers for external PR author when authorMode=external', async () => {
			vi.mocked(checkTriggerEnabledWithParams).mockResolvedValueOnce({
				enabled: true,
				parameters: { authorMode: 'external' },
			});
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
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('review');
		});

		it('skips implementer PR when authorMode=external', async () => {
			vi.mocked(checkTriggerEnabledWithParams).mockResolvedValueOnce({
				enabled: true,
				parameters: { authorMode: 'external' },
			});
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
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});

		it('triggers for both authors when authorMode=all', async () => {
			vi.mocked(checkTriggerEnabledWithParams).mockResolvedValue({
				enabled: true,
				parameters: { authorMode: 'all' },
			});

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
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};
			const implResult = await trigger.handle(implCtx);
			expect(implResult).not.toBeNull();

			// External PR — clear dedup since we're testing author mode, not dedup
			recentlyDispatched.clear();
			vi.mocked(lookupWorkItemForPR).mockResolvedValue(null);
			setupMocks('external-contributor');
			const extCtx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};
			const extResult = await trigger.handle(extCtx);
			expect(extResult).not.toBeNull();
		});

		it('defaults to authorMode=own when no parameters configured', async () => {
			vi.mocked(checkTriggerEnabledWithParams).mockResolvedValueOnce({
				enabled: true,
				parameters: {},
			});
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
	});
});

// ==========================================================================
// waitForChecks() — exported standalone function
// ==========================================================================

describe('waitForChecks', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns immediately when all checks are passing', async () => {
		vi.mocked(githubClient.getCheckSuiteStatus).mockResolvedValue({
			allPassing: true,
			checkRuns: [],
		});

		const result = await waitForChecks('owner', 'repo', 'sha123', 42);

		expect(result.allPassing).toBe(true);
		expect(githubClient.getCheckSuiteStatus).toHaveBeenCalledTimes(1);
	});

	it('returns immediately when all checks completed (some failed) — no point retrying', async () => {
		vi.mocked(githubClient.getCheckSuiteStatus).mockResolvedValue({
			allPassing: false,
			checkRuns: [{ name: 'ci', status: 'completed', conclusion: 'failure' }],
		});

		const resultPromise = waitForChecks('owner', 'repo', 'sha123', 42);
		// No timer needed since all completed
		const result = await resultPromise;

		expect(result.allPassing).toBe(false);
		// Only called once (no in-progress checks → no retry)
		expect(githubClient.getCheckSuiteStatus).toHaveBeenCalledTimes(1);
	});

	it('retries when some checks are still in-progress, returns when all pass', async () => {
		vi.mocked(githubClient.getCheckSuiteStatus)
			.mockResolvedValueOnce({
				allPassing: false,
				checkRuns: [{ name: 'ci', status: 'in_progress', conclusion: null }],
			})
			.mockResolvedValue({
				allPassing: true,
				checkRuns: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
			});

		const resultPromise = waitForChecks('owner', 'repo', 'sha123', 42);
		// Advance past the RETRY_DELAY_MS (10000ms)
		await vi.runAllTimersAsync();
		const result = await resultPromise;

		expect(result.allPassing).toBe(true);
		expect(githubClient.getCheckSuiteStatus).toHaveBeenCalledTimes(2);
	});

	it('stops retrying when all checks complete (even if failed)', async () => {
		vi.mocked(githubClient.getCheckSuiteStatus)
			.mockResolvedValueOnce({
				allPassing: false,
				checkRuns: [{ name: 'ci', status: 'in_progress', conclusion: null }],
			})
			.mockResolvedValue({
				allPassing: false,
				checkRuns: [{ name: 'ci', status: 'completed', conclusion: 'failure' }],
			});

		const resultPromise = waitForChecks('owner', 'repo', 'sha123', 42);
		await vi.runAllTimersAsync();
		const result = await resultPromise;

		expect(result.allPassing).toBe(false);
		// Called once initially + once after retry (then stops since all completed)
		expect(githubClient.getCheckSuiteStatus).toHaveBeenCalledTimes(2);
	});
});
