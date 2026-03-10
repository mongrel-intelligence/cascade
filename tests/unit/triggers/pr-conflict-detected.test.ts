import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	PRConflictDetectedTrigger,
	resetConflictAttempts,
} from '../../../src/triggers/github/pr-conflict-detected.js';
import type { TriggerContext } from '../../../src/triggers/types.js';
import { createMockProject } from '../../helpers/factories.js';
import { mockPersonaIdentities } from '../../helpers/mockPersonas.js';

vi.mock('../../../src/triggers/config-resolver.js', () => ({
	isTriggerEnabled: vi.fn().mockResolvedValue(true),
	getTriggerParameters: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../src/triggers/shared/trigger-check.js', () => ({
	checkTriggerEnabled: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../src/github/client.js', () => ({
	githubClient: {
		getPR: vi.fn(),
		createPRComment: vi.fn(),
	},
}));

import { githubClient } from '../../../src/github/client.js';

vi.mock('../../../src/db/repositories/prWorkItemsRepository.js', () => ({
	lookupWorkItemForPR: vi.fn(),
}));
import { lookupWorkItemForPR } from '../../../src/db/repositories/prWorkItemsRepository.js';
import { checkTriggerEnabled } from '../../../src/triggers/shared/trigger-check.js';

describe('PRConflictDetectedTrigger', () => {
	const trigger = new PRConflictDetectedTrigger();

	const mockProject = createMockProject();

	const makeSynchronizePayload = (overrides: Record<string, unknown> = {}) => ({
		action: 'synchronize',
		number: 42,
		pull_request: {
			number: 42,
			title: 'Test PR',
			body: 'https://trello.com/c/abc123/card-name',
			html_url: 'https://github.com/owner/repo/pull/42',
			state: 'open' as const,
			draft: false,
			head: { ref: 'feature/test', sha: 'sha123' },
			base: { ref: 'main' },
			user: { login: 'cascade-impl' },
		},
		repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
		sender: { login: 'cascade-impl' },
		...overrides,
	});

	beforeEach(() => {
		resetConflictAttempts(42);
		vi.mocked(lookupWorkItemForPR).mockResolvedValue('abc123');
		vi.mocked(githubClient.createPRComment).mockResolvedValue(undefined);
	});

	describe('matches', () => {
		it('matches synchronize action on pull_request event', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeSynchronizePayload(),
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

		it('does not match non-synchronize action', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeSynchronizePayload({ action: 'opened' }),
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match closed action', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeSynchronizePayload({ action: 'closed' }),
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
				payload: makeSynchronizePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
			expect(checkTriggerEnabled).toHaveBeenCalledWith(
				'test',
				'resolve-conflicts',
				'scm:conflict-resolution',
				'pr-conflict-detected',
			);
		});

		it('returns resolve-conflicts result when PR has conflicts', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123/card-name',
				state: 'open',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				mergeable: false,
				user: { login: 'cascade-impl' },
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeSynchronizePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).toEqual({
				agentType: 'resolve-conflicts',
				agentInput: {
					prNumber: 42,
					prBranch: 'feature/test',
					repoFullName: 'owner/repo',
					headSha: 'sha123',
					triggerType: 'conflict-resolution',
					cardId: 'abc123',
					triggerEvent: 'scm:pr-conflict-detected',
				},
				prNumber: 42,
				workItemId: 'abc123',
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
				mergeable: false,
				user: { login: 'cascade-impl' },
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeSynchronizePayload({
					pull_request: {
						...makeSynchronizePayload().pull_request,
						base: { ref: 'develop' },
					},
				}),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
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
				mergeable: false,
				user: { login: 'some-human' },
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeSynchronizePayload({
					pull_request: {
						...makeSynchronizePayload().pull_request,
						user: { login: 'some-human' },
					},
				}),
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
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				mergeable: false,
				user: { login: 'cascade-impl' },
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeSynchronizePayload(),
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});

		it('fires without work item when PR body has no reference', async () => {
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
				mergeable: false,
				user: { login: 'cascade-impl' },
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeSynchronizePayload({
					pull_request: {
						...makeSynchronizePayload().pull_request,
						body: 'No work item link',
					},
				}),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.workItemId).toBeUndefined();
			expect(result?.agentInput.cardId).toBeUndefined();
		});

		it('returns null when PR is mergeable (no conflicts)', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123',
				state: 'open',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				mergeable: true,
				user: { login: 'cascade-impl' },
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeSynchronizePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});

		it('returns null when mergeable is null after retries', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123',
				state: 'open',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				mergeable: null,
				user: { login: 'cascade-impl' },
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeSynchronizePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
			// Should have retried 2 times + initial call = 3 calls
			expect(githubClient.getPR).toHaveBeenCalledTimes(3);
		});

		it('retries when mergeable is initially null, then succeeds when it becomes false', async () => {
			// First two calls return null, third returns false (conflict detected)
			vi.mocked(githubClient.getPR)
				.mockResolvedValueOnce({
					number: 42,
					title: 'Test PR',
					body: 'https://trello.com/c/abc123',
					state: 'open',
					headRef: 'feature/test',
					headSha: 'sha123',
					baseRef: 'main',
					merged: false,
					mergeable: null,
					user: { login: 'cascade-impl' },
				})
				.mockResolvedValueOnce({
					number: 42,
					title: 'Test PR',
					body: 'https://trello.com/c/abc123',
					state: 'open',
					headRef: 'feature/test',
					headSha: 'sha123',
					baseRef: 'main',
					merged: false,
					mergeable: false,
					user: { login: 'cascade-impl' },
				});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeSynchronizePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('resolve-conflicts');
			expect(githubClient.getPR).toHaveBeenCalledTimes(2);
		});

		it('posts warning and returns null after MAX_ATTEMPTS (2)', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123',
				state: 'open',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				mergeable: false,
				user: { login: 'cascade-impl' },
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeSynchronizePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			// First 2 attempts should succeed
			await trigger.handle(ctx);
			await trigger.handle(ctx);

			// 3rd attempt should be blocked
			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
			expect(githubClient.createPRComment).toHaveBeenCalledWith(
				'owner',
				'repo',
				42,
				expect.stringContaining('Unable to automatically resolve merge conflicts'),
			);
		});

		it('resetConflictAttempts clears attempts for a PR', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123',
				state: 'open',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				mergeable: false,
				user: { login: 'cascade-impl' },
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeSynchronizePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			// Use up 2 attempts
			await trigger.handle(ctx);
			await trigger.handle(ctx);

			// Reset
			resetConflictAttempts(42);

			// Should work again
			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('resolve-conflicts');
		});

		it('accepts bot variant of implementer login', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123',
				state: 'open',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				mergeable: false,
				user: { login: 'cascade-impl[bot]' },
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeSynchronizePayload({
					pull_request: {
						...makeSynchronizePayload().pull_request,
						user: { login: 'cascade-impl[bot]' },
					},
				}),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('resolve-conflicts');
		});
	});
});
