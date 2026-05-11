import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	mockConfigResolverModule,
	mockGitHubClientModule,
	mockTriggerCheckModule,
} from '../../helpers/sharedMocks.js';

vi.mock('../../../src/triggers/config-resolver.js', () => mockConfigResolverModule);

vi.mock('../../../src/triggers/shared/trigger-check.js', () => mockTriggerCheckModule);

vi.mock('../../../src/github/client.js', () => mockGitHubClientModule);

// Stub the Redis-backed dedup module so tests don't need a Redis connection.
// Each `claim` resolves to true (success) by default; per-test overrides via
// `mockClaimRespondToCiDispatch.mockResolvedValueOnce(false)` simulate a duplicate.
const mockClaimRespondToCiDispatch = vi.fn().mockResolvedValue(true);
const mockReleaseRespondToCiDispatch = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../src/triggers/github/respond-to-ci-dedup.js', () => ({
	buildRespondToCiDispatchKey: (owner: string, repo: string, prNumber: number, headSha: string) =>
		`${owner}/${repo}:${prNumber}:${headSha}`,
	claimRespondToCiDispatch: (...args: unknown[]) => mockClaimRespondToCiDispatch(...args),
	releaseRespondToCiDispatch: (...args: unknown[]) => mockReleaseRespondToCiDispatch(...args),
}));

import { githubClient } from '../../../src/github/client.js';
import {
	CheckSuiteFailureTrigger,
	resetFixAttempts,
} from '../../../src/triggers/github/check-suite-failure.js';
import type { TriggerContext } from '../../../src/triggers/types.js';
import { createCheckSuitePayload, createMockProject } from '../../helpers/factories.js';
import { mockPersonaIdentities } from '../../helpers/mockPersonas.js';

vi.mock('../../../src/db/repositories/prWorkItemsRepository.js', () => ({
	lookupWorkItemForPR: vi.fn(),
}));

import { lookupWorkItemForPR } from '../../../src/db/repositories/prWorkItemsRepository.js';
import { checkTriggerEnabled } from '../../../src/triggers/shared/trigger-check.js';

import { expectSkipFor } from '../../helpers/triggerAssertions.js';

const expectSkip = expectSkipFor('check-suite-failure');

describe('CheckSuiteFailureTrigger', () => {
	const trigger = new CheckSuiteFailureTrigger();

	const mockProject = createMockProject();

	const makeFailurePayload = (overrides: Record<string, unknown> = {}) =>
		createCheckSuitePayload({
			check_suite: {
				id: 1,
				status: 'completed',
				conclusion: 'failure',
				head_sha: 'sha123',
				pull_requests: [{ number: 42, head: { ref: 'feature/test', sha: 'sha123' } }],
			},
			...overrides,
		} as Parameters<typeof createCheckSuitePayload>[0]);

	beforeEach(() => {
		resetFixAttempts(42);
		vi.mocked(lookupWorkItemForPR).mockResolvedValue('abc123');
		mockClaimRespondToCiDispatch.mockReset().mockResolvedValue(true);
		mockReleaseRespondToCiDispatch.mockReset().mockResolvedValue(undefined);
	});

	describe('matches', () => {
		it('matches completed check suite with failure conclusion and PRs', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeFailurePayload(),
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
				payload: makeFailurePayload({ action: 'requested' }),
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match success conclusion', () => {
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
						pull_requests: [{ number: 42, head: { ref: 'feat', sha: 'sha123' } }],
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'github-actions' },
				},
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('matches when pull_requests is empty and head_branch is a plain branch name (e.g. CodeQL)', () => {
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
						head_branch: 'feature/adding-engines-guide',
						pull_requests: [],
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'github-actions' },
				},
			};

			// matches() now accepts all failure events; PR resolution happens in handle()
			expect(trigger.matches(ctx)).toBe(true);
		});

		it('matches when pull_requests is empty and head_branch is absent', () => {
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
						pull_requests: [],
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'github-actions' },
				},
			};

			// matches() accepts all failure events; handle() will skip if no PR can be resolved
			expect(trigger.matches(ctx)).toBe(true);
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
						conclusion: 'failure',
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
		it('returns null when trigger is disabled (so the registry can try the next matcher)', async () => {
			// Disabled-at-config returns null, not a structured skip — see
			// `checkTriggerEnablement` contract for the shadowing-bug context.
			vi.mocked(checkTriggerEnabled).mockResolvedValueOnce(false);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeFailurePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
			expect(checkTriggerEnabled).toHaveBeenCalledWith(
				'test',
				'respond-to-ci',
				'scm:check-suite-failure',
				'check-suite-failure',
			);
		});

		it('returns respond-to-ci result when PR has Trello URL and checks failed', async () => {
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
			vi.mocked(githubClient.getCheckSuiteStatus).mockResolvedValue({
				allPassing: false,
				totalCount: 2,
				checkRuns: [
					{ name: 'lint', status: 'completed', conclusion: 'success' },
					{ name: 'test', status: 'completed', conclusion: 'failure' },
				],
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeFailurePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).toEqual({
				agentType: 'respond-to-ci',
				agentInput: {
					prNumber: 42,
					prBranch: 'feature/test',
					repoFullName: 'owner/repo',
					headSha: 'sha123',
					triggerType: 'check-failure',
					workItemId: 'abc123',
					triggerEvent: 'scm:check-suite-failure',
					prUrl: 'https://github.com/owner/repo/pull/42',
					prTitle: 'Test PR',
				},
				prNumber: 42,
				prUrl: 'https://github.com/owner/repo/pull/42',
				prTitle: 'Test PR',
				workItemId: 'abc123',
				workItemUrl: undefined,
				workItemTitle: undefined,
				onBlocked: expect.any(Function),
				coalesceKey: undefined,
			});
		});

		// Bug 2 fix (2026-05-11): cascade-authored stacked PRs bypass the base-branch
		// gate — only non-cascade authors are filtered here. The base-branch gate
		// used to be applied unconditionally via `??` which also blocked cascade-
		// authored stacked PRs. Now only non-cascade authors hit the persona gate.
		it('returns a structured skip when PR not authored by cascade but targets non-base branch', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123/card-name',
				state: 'open',
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'develop',
				merged: false,
				user: { login: 'some-human' },
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeFailurePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expectSkip(result, /not authored by a cascade persona.*author: some-human/i);
			expect(githubClient.getCheckSuiteStatus).not.toHaveBeenCalled();
		});

		it('dispatches respond-to-ci for cascade-authored stacked PR targeting non-base branch', async () => {
			// Bug 2 fix: cascade-authored PRs bypass the base-branch gate.
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Stacked PR',
				body: null,
				state: 'open',
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				headRef: 'feature/stacked-child',
				headSha: 'sha123',
				baseRef: 'feature/stacked-parent',
				merged: false,
				user: { login: 'cascade-impl' },
			});
			vi.mocked(githubClient.getCheckSuiteStatus).mockResolvedValue({
				allPassing: false,
				totalCount: 1,
				checkRuns: [{ name: 'test', status: 'completed', conclusion: 'failure' }],
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeFailurePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result?.agentType).toBe('respond-to-ci');
			expect(result?.prNumber).toBe(42);
		});

		it('returns a structured skip when PR not authored by any cascade persona', async () => {
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
				user: { login: 'some-human' },
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeFailurePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expectSkip(result, /not authored by a cascade persona.*author: some-human/);
		});

		// Fix 3: gate widening — both implementer AND reviewer personas should
		// match. PR #155 incident: aaight is the implementer for ucho; respond-to-ci
		// should also fire for PRs authored by the reviewer persona.
		it('fires when PR is authored by the REVIEWER persona (not just the implementer)', async () => {
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
				user: { login: mockPersonaIdentities.reviewer },
			});
			vi.mocked(githubClient.getCheckSuiteStatus).mockResolvedValue({
				allPassing: false,
				totalCount: 2,
				checkRuns: [
					{ name: 'lint', status: 'completed', conclusion: 'success' },
					{ name: 'test', status: 'completed', conclusion: 'failure' },
				],
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeFailurePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result?.agentType).toBe('respond-to-ci');
		});

		it('returns a structured skip when no personaIdentities available', async () => {
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

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeFailurePayload(),
			};

			const result = await trigger.handle(ctx);

			expectSkip(result, /persona identities could not be resolved/);
		});

		it('fires without work item when DB has no link', async () => {
			vi.mocked(lookupWorkItemForPR).mockResolvedValue(null);
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'No work item link',
				state: 'open',
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				user: { login: 'cascade-impl' },
			});
			vi.mocked(githubClient.getCheckSuiteStatus).mockResolvedValue({
				allPassing: false,
				totalCount: 1,
				checkRuns: [{ name: 'test', status: 'completed', conclusion: 'failure' }],
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeFailurePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.workItemId).toBeUndefined();
			expect(result?.agentInput.workItemId).toBeUndefined();
		});

		// API-lag fix (same as check-suite-success Bug 1, 2026-05-11):
		// when the Actions API reports a check as in_progress even after the
		// final check_suite.completed event, a plain skip would wait for a
		// follow-up webhook that GitHub has already sent. The handler now
		// schedules a deferred re-check so it re-evaluates against fresh state.
		it('returns deferredRecheck (not plain skip) when not all checks are complete', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123',
				state: 'open',
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				user: { login: 'cascade-impl' },
			});
			vi.mocked(githubClient.getCheckSuiteStatus).mockResolvedValue({
				allPassing: false,
				totalCount: 2,
				checkRuns: [
					{ name: 'lint', status: 'completed', conclusion: 'success' },
					{ name: 'test', status: 'in_progress', conclusion: null },
				],
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeFailurePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			// No agent dispatch — wait for the deferred re-check.
			expect(result?.agentType).toBeNull();
			expect(result?.deferredRecheck).toBeDefined();
			expect(result?.deferredRecheck?.delayMs).toBe(30_000);
			// coalesceKey must include owner/repo + PR number + head SHA.
			expect(result?.deferredRecheck?.coalesceKey).toBe(
				'check-suite-failure:owner/repo:pr-42:sha123',
			);
			// recheckKind must be 'check-suite' so the router stamps
			// checkSuiteRecheckAttempt (not mergeabilityRecheckAttempt) on the
			// delayed job, enabling safe rescheduling if still stale.
			expect(result?.deferredRecheck?.recheckKind).toBe('check-suite');
			// Dedup must NOT be claimed for the deferred event.
			expect(result?.onBlocked).toBeUndefined();
		});

		it('returns a structured skip when all checks actually passed (no failures)', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123',
				state: 'open',
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				user: { login: 'cascade-impl' },
			});
			vi.mocked(githubClient.getCheckSuiteStatus).mockResolvedValue({
				allPassing: true,
				totalCount: 2,
				checkRuns: [
					{ name: 'lint', status: 'completed', conclusion: 'success' },
					{ name: 'test', status: 'completed', conclusion: 'success' },
				],
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeFailurePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expectSkip(result, /All 2 checks passed/);
		});

		it('posts warning and returns a structured skip after MAX_ATTEMPTS (3)', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123',
				state: 'open',
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				user: { login: 'cascade-impl' },
			});
			vi.mocked(githubClient.getCheckSuiteStatus).mockResolvedValue({
				allPassing: false,
				totalCount: 1,
				checkRuns: [{ name: 'test', status: 'completed', conclusion: 'failure' }],
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeFailurePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			// First 3 attempts should succeed
			await trigger.handle(ctx);
			await trigger.handle(ctx);
			await trigger.handle(ctx);

			// 4th attempt should be blocked
			const result = await trigger.handle(ctx);

			expectSkip(result, /Max auto-fix attempts \(3\) reached for PR #42/);
			expect(githubClient.createPRComment).toHaveBeenCalledWith(
				'owner',
				'repo',
				42,
				expect.stringContaining('Unable to automatically fix'),
			);
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
			vi.mocked(githubClient.getCheckSuiteStatus).mockResolvedValue({
				allPassing: false,
				totalCount: 1,
				checkRuns: [{ name: 'test', status: 'completed', conclusion: 'failure' }],
			});

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
						head_branch: 'refs/pull/42/head',
						pull_requests: [],
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'github-actions' },
				},
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).toEqual({
				agentType: 'respond-to-ci',
				agentInput: {
					prNumber: 42,
					prBranch: 'feature/test',
					repoFullName: 'owner/repo',
					headSha: 'sha123',
					triggerType: 'check-failure',
					workItemId: 'abc123',
					triggerEvent: 'scm:check-suite-failure',
					prUrl: 'https://github.com/owner/repo/pull/42',
					prTitle: 'Test PR',
				},
				prNumber: 42,
				prUrl: 'https://github.com/owner/repo/pull/42',
				prTitle: 'Test PR',
				workItemId: 'abc123',
				workItemUrl: undefined,
				workItemTitle: undefined,
				onBlocked: expect.any(Function),
				coalesceKey: undefined,
			});
		});

		it('fires via getOpenPRByBranch fallback when pull_requests is empty and head_branch is a plain name', async () => {
			vi.mocked(githubClient.getOpenPRByBranch).mockResolvedValue({
				number: 42,
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				title: 'Test PR',
			});
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: '',
				state: 'open',
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				headRef: 'feature/adding-engines-guide',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				user: { login: 'cascade-impl' },
			});
			vi.mocked(githubClient.getCheckSuiteStatus).mockResolvedValue({
				allPassing: false,
				totalCount: 1,
				checkRuns: [{ name: 'CodeQL', status: 'completed', conclusion: 'failure' }],
			});

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
						head_branch: 'feature/adding-engines-guide',
						pull_requests: [],
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'github-actions' },
				},
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(githubClient.getOpenPRByBranch).toHaveBeenCalledWith(
				'owner',
				'repo',
				'feature/adding-engines-guide',
			);
			expect(result?.agentType).toBe('respond-to-ci');
			expect(result?.prNumber).toBe(42);
		});

		it('returns null via getOpenPRByBranch fallback when no open PR exists for branch', async () => {
			vi.mocked(githubClient.getOpenPRByBranch).mockResolvedValue(null);

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
						head_branch: 'main',
						pull_requests: [],
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'github-actions' },
				},
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(githubClient.getOpenPRByBranch).toHaveBeenCalledWith('owner', 'repo', 'main');
			expectSkip(result, /Could not resolve PR number/);
		});

		it('returns a structured skip when pull_requests is empty and head_branch is absent', async () => {
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
						pull_requests: [],
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'github-actions' },
				},
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(githubClient.getOpenPRByBranch).not.toHaveBeenCalled();
			expectSkip(result, /Could not resolve PR number/);
		});

		it('resetFixAttempts clears attempts for a PR', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123',
				state: 'open',
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				user: { login: 'cascade-impl' },
			});
			vi.mocked(githubClient.getCheckSuiteStatus).mockResolvedValue({
				allPassing: false,
				totalCount: 1,
				checkRuns: [{ name: 'test', status: 'completed', conclusion: 'failure' }],
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeFailurePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			// Use up 3 attempts
			await trigger.handle(ctx);
			await trigger.handle(ctx);
			await trigger.handle(ctx);

			// Reset
			resetFixAttempts(42);

			// Should work again
			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('respond-to-ci');
		});
	});
});
