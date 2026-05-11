import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	mockConfigResolverModule,
	mockGitHubClientModule,
	mockTriggerCheckModule,
} from '../../helpers/sharedMocks.js';
import { expectSkipFor } from '../../helpers/triggerAssertions.js';

const expectSkip = expectSkipFor('check-suite-success');

vi.mock('../../../src/triggers/config-resolver.js', () => mockConfigResolverModule);

vi.mock('../../../src/triggers/shared/trigger-check.js', () => mockTriggerCheckModule);

vi.mock('../../../src/github/client.js', () => mockGitHubClientModule);

// Stub the Redis-backed review dedup module so tests don't need a Redis connection.
// Each `claim` resolves to true (success) by default; per-test overrides via
// `mockClaimReviewDispatch.mockResolvedValueOnce(false)` simulate a duplicate.
const mockClaimReviewDispatch = vi.fn().mockResolvedValue(true);
const mockReleaseReviewDispatch = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../src/triggers/github/review-dispatch-dedup.js', () => ({
	buildReviewDispatchKey: (owner: string, repo: string, prNumber: number, headSha: string) =>
		`${owner}/${repo}:${prNumber}:${headSha}`,
	claimReviewDispatch: (...args: unknown[]) => mockClaimReviewDispatch(...args),
	releaseReviewDispatch: (...args: unknown[]) => mockReleaseReviewDispatch(...args),
}));

// Stub the Redis-backed respond-to-ci dedup module (used by dispatchRespondToCi
// called from the success handler's mixed-state fork).
const mockClaimRespondToCiDispatch = vi.fn().mockResolvedValue(true);
const mockReleaseRespondToCiDispatch = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../src/triggers/github/respond-to-ci-dedup.js', () => ({
	buildRespondToCiDispatchKey: (owner: string, repo: string, prNumber: number, headSha: string) =>
		`${owner}/${repo}:${prNumber}:${headSha}`,
	claimRespondToCiDispatch: (...args: unknown[]) => mockClaimRespondToCiDispatch(...args),
	releaseRespondToCiDispatch: (...args: unknown[]) => mockReleaseRespondToCiDispatch(...args),
}));

import { githubClient } from '../../../src/github/client.js';
import { resetFixAttempts } from '../../../src/triggers/github/check-suite-failure.js';
import { CheckSuiteSuccessTrigger } from '../../../src/triggers/github/check-suite-success.js';
import { ReviewRequestedTrigger } from '../../../src/triggers/github/review-requested.js';
import type { TriggerContext } from '../../../src/triggers/types.js';
import { createCheckSuitePayload, createMockProject } from '../../helpers/factories.js';
import { mockPersonaIdentities } from '../../helpers/mockPersonas.js';

vi.mock('../../../src/db/repositories/prWorkItemsRepository.js', () => ({
	lookupWorkItemForPR: vi.fn(),
}));

import { lookupWorkItemForPR } from '../../../src/db/repositories/prWorkItemsRepository.js';
import { checkTriggerEnabledWithParams } from '../../../src/triggers/shared/trigger-check.js';

describe('CheckSuiteSuccessTrigger', () => {
	const trigger = new CheckSuiteSuccessTrigger();
	const reviewRequestedTrigger = new ReviewRequestedTrigger();

	const mockProject = createMockProject();

	const makeCheckSuitePayload = (overrides: Record<string, unknown> = {}) =>
		createCheckSuitePayload(overrides as Parameters<typeof createCheckSuitePayload>[0]);

	beforeEach(() => {
		vi.mocked(lookupWorkItemForPR).mockResolvedValue('abc123');
		mockClaimReviewDispatch.mockReset().mockResolvedValue(true);
		mockReleaseReviewDispatch.mockReset().mockResolvedValue(undefined);
		mockClaimRespondToCiDispatch.mockReset().mockResolvedValue(true);
		mockReleaseRespondToCiDispatch.mockReset().mockResolvedValue(undefined);
		resetFixAttempts(42);
		// Default: aggregate status reflects all checks passing. Tests that need
		// a mixed-state SHA override this per-case.
		vi.mocked(githubClient.getCheckSuiteStatus).mockResolvedValue({
			allPassing: true,
			totalCount: 1,
			checkRuns: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
		});
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

		it('does not match when no PRs associated and no PR ref in head_branch', () => {
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
						head_branch: 'main',
						pull_requests: [],
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'github-actions' },
				},
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match when pull_requests is empty and head_branch is absent', () => {
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

		it('matches when pull_requests is empty but head_branch is refs/pull/{N}/head', () => {
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
						head_branch: 'refs/pull/42/head',
						pull_requests: [],
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'github-actions' },
				},
			};

			expect(trigger.matches(ctx)).toBe(true);
		});
	});

	describe('handle', () => {
		it('returns review result without waitForChecks flag when PR matches and aggregate is all-passing', async () => {
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
			// handle() queries aggregate status to fork between review (allPassing)
			// and respond-to-ci (any check failed on the SHA).
			expect(githubClient.getCheckSuiteStatus).toHaveBeenCalledWith('owner', 'repo', 'sha123');
			expect(result).toEqual(
				expect.objectContaining({
					agentType: 'review',
					agentInput: expect.objectContaining({
						prNumber: 42,
						prBranch: 'feature/test',
						repoFullName: 'owner/repo',
						headSha: 'sha123',
						triggerType: 'ci-success',
						workItemId: 'abc123',
						triggerEvent: 'scm:check-suite-success',
						prUrl: 'https://github.com/owner/repo/pull/42',
						prTitle: 'Test PR',
					}),
					prNumber: 42,
					workItemId: 'abc123',
				}),
			);
			// waitForChecks is gone — handler defers on incomplete state instead
			// of dispatching with a worker-side polling flag (PR #1245 incident).
			expect(result?.waitForChecks).toBeUndefined();
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
			// Simulate Redis state: review-requested claims first (true), then
			// check-suite-success loses the SET NX EX race (false).
			mockClaimReviewDispatch.mockReset().mockResolvedValueOnce(true).mockResolvedValueOnce(false);

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

			expectSkip(checkSuiteResult);
		});

		it('returns skip when non-cascade-authored PR targets non-base branch', async () => {
			// Fix B (2026-05-11): the base-branch gate still applies to NON-
			// cascade-authored PRs. Cascade-authored stacked PRs now bypass
			// the gate — see the "cascade-authored stacked PR" test below.
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
				user: { login: 'random-contributor' },
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expectSkip(result);
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

			expectSkip(result);
			// Author gate fails BEFORE the aggregate-status fork — no API call.
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

			expectSkip(result);
			// Persona gate fails BEFORE the aggregate-status fork — no API call.
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

			expectSkip(result);
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
			expect(result?.waitForChecks).toBeUndefined();
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

			expectSkip(result);
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
			expect(result?.waitForChecks).toBeUndefined();
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
			expect(result?.waitForChecks).toBeUndefined();
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
			expect(result?.waitForChecks).toBeUndefined();
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

			// Simulate the Redis-backed dedup: first claim succeeds, second loses
			// the SET NX EX race and returns false.
			mockClaimReviewDispatch.mockReset().mockResolvedValueOnce(true).mockResolvedValueOnce(false);

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
			expectSkip(result2, /already claimed by another path \(dedup\)/);
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
			// First handle() called claim once.
			expect(mockClaimReviewDispatch).toHaveBeenCalledTimes(1);

			// Simulate router calling onBlocked (work-item lock or concurrency block) —
			// it should release the dedup so a subsequent legitimate trigger can claim.
			result?.onBlocked?.();
			expect(mockReleaseReviewDispatch).toHaveBeenCalledTimes(1);
			expect(mockReleaseReviewDispatch).toHaveBeenCalledWith('owner/repo:42:sha123');
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
			expect(result?.waitForChecks).toBeUndefined();
		});

		it('fires correctly when pull_requests is empty but head_branch has PR ref', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123/card-name',
				state: 'open',
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				user: { login: 'cascade-impl' },
			});
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([]);

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
						head_branch: 'refs/pull/42/head',
						pull_requests: [],
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'github-actions' },
				},
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('review');
			expect(result?.agentInput).toMatchObject({
				prNumber: 42,
				prBranch: 'feature/test',
				headSha: 'sha123',
			});
			expect(result?.waitForChecks).toBeUndefined();
		});
	});

	// Mixed-state SHA: GitHub fires check_suite.completed once per workflow.
	// When workflow A's suite succeeds but workflow B's suite (same SHA) failed
	// fast and earlier — the failure handler at the time saw "not all complete
	// yet" and deferred. The success event arrives last; without this fork it
	// would dispatch review (which then silently skips at the worker because
	// allPassing=false). Closes the gap so respond-to-ci is dispatched on the
	// success event when aggregate state shows any failure.
	describe('mixed-state SHA — aggregate-status fork', () => {
		const baseImplementerPR = {
			number: 42,
			title: 'Test PR',
			body: null,
			state: 'open' as const,
			headRef: 'feature/test',
			headSha: 'sha123',
			baseRef: 'main',
			merged: false,
			htmlUrl: 'https://github.com/owner/repo/pull/42',
			user: { login: 'cascade-impl' },
		};

		it('dispatches respond-to-ci when aggregate has any failure on the SHA', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue(baseImplementerPR);
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([]);
			vi.mocked(githubClient.getCheckSuiteStatus).mockResolvedValue({
				allPassing: false,
				totalCount: 2,
				checkRuns: [
					{ name: 'CI', status: 'completed', conclusion: 'success' },
					{ name: 'E2B Template Rebuild', status: 'completed', conclusion: 'failure' },
				],
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result?.agentType).toBe('respond-to-ci');
			expect(result?.agentInput.triggerEvent).toBe('scm:check-suite-failure');
			expect(result?.agentInput.triggerType).toBe('check-failure');
			expect(result?.agentInput.headSha).toBe('sha123');
			expect(result?.prNumber).toBe(42);
			// Should NOT carry waitForChecks — that's a review-path flag and the
			// aggregate is already complete.
			expect(result?.waitForChecks).toBeFalsy();
		});

		it('dispatches review when aggregate is all complete and all passing', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue(baseImplementerPR);
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([]);
			vi.mocked(githubClient.getCheckSuiteStatus).mockResolvedValue({
				allPassing: true,
				totalCount: 2,
				checkRuns: [
					{ name: 'CI', status: 'completed', conclusion: 'success' },
					{ name: 'E2B Template Rebuild', status: 'completed', conclusion: 'success' },
				],
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result?.agentType).toBe('review');
		});

		// Defer-on-incomplete: PR #1245 (2026-05-01) shipped a doomed worker
		// because the success handler dispatched on the FIRST check_suite event
		// (CodeQL completing) while CI's slower lint-and-test was still running.
		// Worker polled 12×10s and bailed; the dedup then blocked the legitimate
		// later success event. Mirrors the existing check-suite-failure deferral
		// shape — the LAST check_suite event makes the dispatch decision based
		// on full aggregate state.
		// Bug 1 (2026-05-11 prod incident on ucho PR #394, MNG-683):
		// the handler used to return a plain skip when checks were incomplete,
		// relying on GitHub to fire another check_suite event when the final
		// suite finishes. But when the GitHub Actions API lags webhook delivery
		// by >0ms, the API still shows that final suite as "in_progress" — and
		// no further webhook arrives because GitHub already fired its event.
		// Review never dispatched; user had to manually request from the
		// reviewer persona. Fix: schedule a deferred re-check with delay.
		it('returns deferredRecheck (not plain skip) when an in-progress check exists', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue(baseImplementerPR);
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([]);
			vi.mocked(githubClient.getCheckSuiteStatus).mockResolvedValue({
				allPassing: false,
				totalCount: 2,
				checkRuns: [
					{ name: 'CI', status: 'completed', conclusion: 'success' },
					{ name: 'lint-and-test', status: 'in_progress', conclusion: null },
				],
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			// No agent dispatch — the worker bail-out path is gone.
			expect(result?.agentType).toBeNull();
			// New contract: a deferredRecheck job is scheduled so the trigger
			// re-evaluates even when GitHub does not fire another check_suite event.
			expect(result?.deferredRecheck).toBeDefined();
			expect(result?.deferredRecheck?.delayMs).toBe(30_000);
			// coalesceKey must include owner/repo + PR number + head SHA so
			// concurrent deferrals collapse to a single delayed job.
			expect(result?.deferredRecheck?.coalesceKey).toBe(
				'check-suite-success:owner/repo:pr-42:sha123',
			);
			// recheckKind must be 'check-suite' so buildJob sets checkSuiteRecheckAttempt
			// (not mergeabilityRecheckAttempt) on the delayed job, allowing safe
			// rescheduling if the Actions API is still stale on the first re-check.
			expect(result?.deferredRecheck?.recheckKind).toBe('check-suite');
			// Dedup must NOT be claimed for a deferred event; the recheck must
			// be free to make the dispatch call.
			expect(result?.onBlocked).toBeUndefined();
		});

		it('does NOT claim the review-dispatch dedup when deferring', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue(baseImplementerPR);
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([]);
			vi.mocked(githubClient.getCheckSuiteStatus)
				.mockResolvedValueOnce({
					// First event: CI still in progress → defer.
					allPassing: false,
					totalCount: 2,
					checkRuns: [
						{ name: 'CodeQL', status: 'completed', conclusion: 'success' },
						{ name: 'lint-and-test', status: 'in_progress', conclusion: null },
					],
				})
				.mockResolvedValueOnce({
					// Later event: everything complete → must dispatch.
					allPassing: true,
					totalCount: 2,
					checkRuns: [
						{ name: 'CodeQL', status: 'completed', conclusion: 'success' },
						{ name: 'lint-and-test', status: 'completed', conclusion: 'success' },
					],
				});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const firstResult = await trigger.handle(ctx);
			// First event: defer-with-recheck (no dedup claim yet).
			expect(firstResult?.agentType).toBeNull();
			expect(firstResult?.deferredRecheck).toBeDefined();
			expect(mockClaimReviewDispatch).not.toHaveBeenCalled();

			const secondResult = await trigger.handle(ctx);
			expect(secondResult?.agentType).toBe('review');
		});

		// Bug 2 (2026-05-11 prod incident on ucho PR #393, MNG-691):
		// the handler rejected stacked PRs targeting a feature branch even
		// when the PR was opened by the cascade implementer persona. Fix:
		// the base-branch gate now skips cascade-authored PRs.
		it('dispatches review for cascade-authored stacked PR targeting a feature branch', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				...baseImplementerPR,
				baseRef: 'feature/MNG-690-calendar-event-context-tables',
			});
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([]);
			vi.mocked(githubClient.getCheckSuiteStatus).mockResolvedValue({
				allPassing: true,
				totalCount: 2,
				checkRuns: [
					{ name: 'CI', status: 'completed', conclusion: 'success' },
					{ name: 'lint-and-test', status: 'completed', conclusion: 'success' },
				],
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result?.agentType).toBe('review');
			expect(result?.prNumber).toBe(42);
		});

		it('dispatches respond-to-ci on timed_out conclusion', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue(baseImplementerPR);
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([]);
			vi.mocked(githubClient.getCheckSuiteStatus).mockResolvedValue({
				allPassing: false,
				totalCount: 2,
				checkRuns: [
					{ name: 'CI', status: 'completed', conclusion: 'success' },
					{ name: 'E2B Template Rebuild', status: 'completed', conclusion: 'timed_out' },
				],
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result?.agentType).toBe('respond-to-ci');
		});

		it('dispatches respond-to-ci even when SHA was already reviewed (CI failure still needs fixing)', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue(baseImplementerPR);
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
			vi.mocked(githubClient.getCheckSuiteStatus).mockResolvedValue({
				allPassing: false,
				totalCount: 2,
				checkRuns: [
					{ name: 'CI', status: 'completed', conclusion: 'success' },
					{ name: 'E2B Template Rebuild', status: 'completed', conclusion: 'failure' },
				],
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result?.agentType).toBe('respond-to-ci');
		});
	});

	describe('authorMode-aware behavior via trigger parameters', () => {
		it('handle returns null when trigger is disabled (so the registry can try the next matcher)', async () => {
			// Disabled-at-config returns bare null, not a structured skip,
			// so the registry's first-match loop continues to the next
			// matcher. Mirror of the contract change in
			// `src/triggers/shared/trigger-check.ts:checkTriggerEnablement`.
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

			expectSkip(result);
		});

		it('triggers when PR authored by reviewer persona and authorMode=own', async () => {
			vi.mocked(checkTriggerEnabledWithParams).mockResolvedValueOnce({
				enabled: true,
				parameters: { authorMode: 'own' },
			});
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Reviewer persona PR',
				body: 'https://trello.com/c/abc123',
				state: 'open',
				headRef: 'feature/reviewer-authored',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				user: { login: 'cascade-reviewer' },
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

		it('skips reviewer persona PR when authorMode=external', async () => {
			vi.mocked(checkTriggerEnabledWithParams).mockResolvedValueOnce({
				enabled: true,
				parameters: { authorMode: 'external' },
			});
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Reviewer persona PR',
				body: 'https://trello.com/c/abc123',
				state: 'open',
				headRef: 'feature/reviewer-authored',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				user: { login: 'cascade-reviewer' },
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expectSkip(result);
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

			// External PR — reset dedup mock since we're testing author mode, not dedup
			mockClaimReviewDispatch.mockReset().mockResolvedValue(true);
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

// waitForChecks() and the worker-side polling layer were deleted: the success
// handler now defers (skips) when aggregate state is incomplete, and the LAST
// check_suite event makes the dispatch decision. See the
// `mixed-state SHA — aggregate-status fork` describe block above.
