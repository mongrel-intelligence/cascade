import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	mockConfigResolverModule,
	mockGitHubClientModule,
	mockTriggerCheckModule,
} from '../../helpers/sharedMocks.js';

vi.mock('../../../src/triggers/config-resolver.js', () => mockConfigResolverModule);

vi.mock('../../../src/triggers/shared/trigger-check.js', () => mockTriggerCheckModule);

vi.mock('../../../src/github/client.js', () => mockGitHubClientModule);

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
		it('should return null when trigger is disabled', async () => {
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
				},
				prNumber: 42,
				prUrl: 'https://github.com/owner/repo/pull/42',
				prTitle: 'Test PR',
				workItemId: 'abc123',
			});
		});

		it('returns null when PR targets non-base branch', async () => {
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
				user: { login: 'cascade-impl' },
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeFailurePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
			expect(githubClient.getCheckSuiteStatus).not.toHaveBeenCalled();
		});

		it('returns null when PR not authored by implementer persona', async () => {
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

			expect(result).toBeNull();
		});

		it('returns null when no personaIdentities available', async () => {
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

			expect(result).toBeNull();
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

		it('returns null when not all checks are complete', async () => {
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

			expect(result).toBeNull();
		});

		it('returns null when all checks actually passed (no failures)', async () => {
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

			expect(result).toBeNull();
		});

		it('posts warning and returns null after MAX_ATTEMPTS (3)', async () => {
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

			expect(result).toBeNull();
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
				},
				prNumber: 42,
				prUrl: 'https://github.com/owner/repo/pull/42',
				prTitle: 'Test PR',
				workItemId: 'abc123',
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
			expect(result).toBeNull();
		});

		it('returns null when pull_requests is empty and head_branch is absent', async () => {
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
			expect(result).toBeNull();
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
