import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROpenedTrigger } from '../../../src/triggers/github/pr-opened.js';
import type { TriggerContext } from '../../../src/triggers/types.js';
import { createMockProject } from '../../helpers/factories.js';

vi.mock('../../../src/triggers/config-resolver.js', () => ({
	isTriggerEnabled: vi.fn().mockResolvedValue(true),
	getTriggerParameters: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../src/triggers/shared/trigger-check.js', () => ({
	checkTriggerEnabled: vi.fn().mockResolvedValue(true),
	checkTriggerEnabledWithParams: vi.fn().mockResolvedValue({ enabled: true, parameters: {} }),
}));

vi.mock('../../../src/db/repositories/prWorkItemsRepository.js', () => ({
	lookupWorkItemForPR: vi.fn(),
}));
import { lookupWorkItemForPR } from '../../../src/db/repositories/prWorkItemsRepository.js';
import { checkTriggerEnabledWithParams } from '../../../src/triggers/shared/trigger-check.js';

describe('PROpenedTrigger', () => {
	const trigger = new PROpenedTrigger();

	const mockProject = createMockProject();

	beforeEach(() => {
		vi.mocked(lookupWorkItemForPR).mockResolvedValue('abc123');
		vi.mocked(checkTriggerEnabledWithParams).mockResolvedValue({ enabled: true, parameters: {} });
	});

	describe('matches', () => {
		it('matches when action is opened and not draft', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					action: 'opened',
					number: 42,
					pull_request: {
						number: 42,
						title: 'Test PR',
						body: 'https://trello.com/c/abc123',
						html_url: 'https://github.com/owner/repo/pull/42',
						state: 'open',
						draft: false,
						head: { ref: 'feature/test', sha: 'abc123' },
						base: { ref: 'main' },
						user: { login: 'author' },
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'author' },
				},
			};

			expect(trigger.matches(ctx)).toBe(true);
		});

		it('does not match when source is not github', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: {},
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match when action is not opened', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					action: 'closed',
					number: 42,
					pull_request: {
						number: 42,
						title: 'Test PR',
						body: 'desc',
						html_url: 'https://github.com/owner/repo/pull/42',
						state: 'closed',
						draft: false,
						head: { ref: 'feature/test', sha: 'abc' },
						base: { ref: 'main' },
						user: { login: 'author' },
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'author' },
				},
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match draft PRs', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					action: 'opened',
					number: 42,
					pull_request: {
						number: 42,
						title: 'Draft PR',
						body: 'desc',
						html_url: 'https://github.com/owner/repo/pull/42',
						state: 'open',
						draft: true,
						head: { ref: 'feature/test', sha: 'abc' },
						base: { ref: 'main' },
						user: { login: 'author' },
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'author' },
				},
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match non-PR payloads', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					action: 'opened',
					// missing number and pull_request
				},
			};

			expect(trigger.matches(ctx)).toBe(false);
		});
	});

	describe('handle', () => {
		it('returns result when PR body has Trello URL', async () => {
			vi.mocked(checkTriggerEnabledWithParams).mockResolvedValueOnce({
				enabled: true,
				parameters: { authorMode: 'all' },
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				personaIdentities: { implementer: 'cascade-impl', reviewer: 'cascade-review' },
				payload: {
					action: 'opened',
					number: 42,
					pull_request: {
						number: 42,
						title: 'Test PR',
						body: 'Implements https://trello.com/c/abc123/card-name',
						html_url: 'https://github.com/owner/repo/pull/42',
						state: 'open',
						draft: false,
						head: { ref: 'feature/test', sha: 'abc' },
						base: { ref: 'main' },
						user: { login: 'author' },
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'author' },
				},
			};

			const result = await trigger.handle(ctx);

			expect(result).toEqual({
				agentType: 'review',
				agentInput: {
					prNumber: 42,
					prBranch: 'feature/test',
					repoFullName: 'owner/repo',
					headSha: 'abc',
					triggerType: 'pr-opened',
					cardId: 'abc123',
					triggerEvent: 'scm:pr-opened',
				},
				prNumber: 42,
				workItemId: 'abc123',
			});
		});

		it('fires without work item when PR has no work item reference', async () => {
			vi.mocked(lookupWorkItemForPR).mockResolvedValue(null);
			vi.mocked(checkTriggerEnabledWithParams).mockResolvedValueOnce({
				enabled: true,
				parameters: { authorMode: 'all' },
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				personaIdentities: { implementer: 'cascade-impl', reviewer: 'cascade-review' },
				payload: {
					action: 'opened',
					number: 42,
					pull_request: {
						number: 42,
						title: 'Test PR',
						body: 'Just a regular PR',
						html_url: 'https://github.com/owner/repo/pull/42',
						state: 'open',
						draft: false,
						head: { ref: 'feature/test', sha: 'abc' },
						base: { ref: 'main' },
						user: { login: 'author' },
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'author' },
				},
			};

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.workItemId).toBeUndefined();
		});

		it('returns null when trigger is disabled via checkTriggerEnabledWithParams', async () => {
			vi.mocked(checkTriggerEnabledWithParams).mockResolvedValueOnce({
				enabled: false,
				parameters: {},
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				personaIdentities: { implementer: 'cascade-impl', reviewer: 'cascade-review' },
				payload: {
					action: 'opened',
					number: 42,
					pull_request: {
						number: 42,
						title: 'Test PR',
						body: 'desc',
						html_url: 'https://github.com/owner/repo/pull/42',
						state: 'open',
						draft: false,
						head: { ref: 'feature/test', sha: 'abc' },
						base: { ref: 'main' },
						user: { login: 'author' },
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'author' },
				},
			};

			expect(await trigger.handle(ctx)).toBeNull();
			expect(checkTriggerEnabledWithParams).toHaveBeenCalledWith(
				'test',
				'review',
				'scm:pr-opened',
				'pr-opened',
			);
		});

		it('returns null for implementer PR when authorMode=external', async () => {
			vi.mocked(checkTriggerEnabledWithParams).mockResolvedValueOnce({
				enabled: true,
				parameters: { authorMode: 'external' },
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				personaIdentities: { implementer: 'cascade-impl', reviewer: 'cascade-review' },
				payload: {
					action: 'opened',
					number: 42,
					pull_request: {
						number: 42,
						title: 'feat: add login',
						body: 'Implements feature',
						html_url: 'https://github.com/owner/repo/pull/42',
						state: 'open',
						draft: false,
						head: { ref: 'feature/login', sha: 'abc' },
						base: { ref: 'main' },
						user: { login: 'cascade-impl' },
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'cascade-impl' },
				},
			};

			expect(await trigger.handle(ctx)).toBeNull();
		});

		it('fires for implementer PR when authorMode=own', async () => {
			vi.mocked(checkTriggerEnabledWithParams).mockResolvedValueOnce({
				enabled: true,
				parameters: { authorMode: 'own' },
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				personaIdentities: { implementer: 'cascade-impl', reviewer: 'cascade-review' },
				payload: {
					action: 'opened',
					number: 42,
					pull_request: {
						number: 42,
						title: 'feat: add login',
						body: 'Implements feature',
						html_url: 'https://github.com/owner/repo/pull/42',
						state: 'open',
						draft: false,
						head: { ref: 'feature/login', sha: 'abc' },
						base: { ref: 'main' },
						user: { login: 'cascade-impl' },
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'cascade-impl' },
				},
			};

			const result = await trigger.handle(ctx);
			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('review');
		});

		it('returns null for external PR when authorMode=own', async () => {
			vi.mocked(checkTriggerEnabledWithParams).mockResolvedValueOnce({
				enabled: true,
				parameters: { authorMode: 'own' },
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				personaIdentities: { implementer: 'cascade-impl', reviewer: 'cascade-review' },
				payload: {
					action: 'opened',
					number: 42,
					pull_request: {
						number: 42,
						title: 'feat: external change',
						body: 'External contribution',
						html_url: 'https://github.com/owner/repo/pull/42',
						state: 'open',
						draft: false,
						head: { ref: 'feature/external', sha: 'abc' },
						base: { ref: 'main' },
						user: { login: 'external-dev' },
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'external-dev' },
				},
			};

			expect(await trigger.handle(ctx)).toBeNull();
		});

		it('returns null for implementer [bot] variant when authorMode=external', async () => {
			vi.mocked(checkTriggerEnabledWithParams).mockResolvedValueOnce({
				enabled: true,
				parameters: { authorMode: 'external' },
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				personaIdentities: { implementer: 'cascade-impl', reviewer: 'cascade-review' },
				payload: {
					action: 'opened',
					number: 42,
					pull_request: {
						number: 42,
						title: 'feat: add login',
						body: 'Implements feature',
						html_url: 'https://github.com/owner/repo/pull/42',
						state: 'open',
						draft: false,
						head: { ref: 'feature/login', sha: 'abc' },
						base: { ref: 'main' },
						user: { login: 'cascade-impl[bot]' },
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'cascade-impl[bot]' },
				},
			};

			expect(await trigger.handle(ctx)).toBeNull();
		});

		it('fires for external PR when authorMode=external', async () => {
			vi.mocked(checkTriggerEnabledWithParams).mockResolvedValueOnce({
				enabled: true,
				parameters: { authorMode: 'external' },
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				personaIdentities: { implementer: 'cascade-impl', reviewer: 'cascade-review' },
				payload: {
					action: 'opened',
					number: 42,
					pull_request: {
						number: 42,
						title: 'Test PR',
						body: 'Just a regular PR',
						html_url: 'https://github.com/owner/repo/pull/42',
						state: 'open',
						draft: false,
						head: { ref: 'feature/test', sha: 'abc' },
						base: { ref: 'main' },
						user: { login: 'external-dev' },
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'external-dev' },
				},
			};

			const result = await trigger.handle(ctx);
			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('review');
		});

		it('fires for reviewer persona PR when authorMode=external (reviewer is not implementer)', async () => {
			vi.mocked(checkTriggerEnabledWithParams).mockResolvedValueOnce({
				enabled: true,
				parameters: { authorMode: 'external' },
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				personaIdentities: { implementer: 'cascade-impl', reviewer: 'cascade-review' },
				payload: {
					action: 'opened',
					number: 42,
					pull_request: {
						number: 42,
						title: 'feat: add login',
						body: 'Implements feature',
						html_url: 'https://github.com/owner/repo/pull/42',
						state: 'open',
						draft: false,
						head: { ref: 'feature/login', sha: 'abc' },
						base: { ref: 'main' },
						user: { login: 'cascade-review' },
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'cascade-review' },
				},
			};

			const result = await trigger.handle(ctx);
			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('review');
		});

		it('fires for both implementer and external PRs when authorMode=all', async () => {
			vi.mocked(checkTriggerEnabledWithParams).mockResolvedValue({
				enabled: true,
				parameters: { authorMode: 'all' },
			});

			const implCtx: TriggerContext = {
				project: mockProject,
				source: 'github',
				personaIdentities: { implementer: 'cascade-impl', reviewer: 'cascade-review' },
				payload: {
					action: 'opened',
					number: 42,
					pull_request: {
						number: 42,
						title: 'impl PR',
						body: 'PR by implementer',
						html_url: 'https://github.com/owner/repo/pull/42',
						state: 'open',
						draft: false,
						head: { ref: 'feature/impl', sha: 'abc' },
						base: { ref: 'main' },
						user: { login: 'cascade-impl' },
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'cascade-impl' },
				},
			};

			const extCtx: TriggerContext = {
				project: mockProject,
				source: 'github',
				personaIdentities: { implementer: 'cascade-impl', reviewer: 'cascade-review' },
				payload: {
					action: 'opened',
					number: 43,
					pull_request: {
						number: 43,
						title: 'ext PR',
						body: 'PR by external dev',
						html_url: 'https://github.com/owner/repo/pull/43',
						state: 'open',
						draft: false,
						head: { ref: 'feature/ext', sha: 'def' },
						base: { ref: 'main' },
						user: { login: 'external-dev' },
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'external-dev' },
				},
			};

			expect(await trigger.handle(implCtx)).not.toBeNull();
			expect(await trigger.handle(extCtx)).not.toBeNull();
		});

		it('returns null without personaIdentities (cannot determine author type)', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				// no personaIdentities — credential resolution failed
				payload: {
					action: 'opened',
					number: 42,
					pull_request: {
						number: 42,
						title: 'Test PR',
						body: 'Just a regular PR',
						html_url: 'https://github.com/owner/repo/pull/42',
						state: 'open',
						draft: false,
						head: { ref: 'feature/test', sha: 'abc' },
						base: { ref: 'main' },
						user: { login: 'cascade-impl' },
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'cascade-impl' },
				},
			};

			expect(await trigger.handle(ctx)).toBeNull();
		});

		it('fires with undefined workItemId for null PR body', async () => {
			vi.mocked(lookupWorkItemForPR).mockResolvedValue(null);
			vi.mocked(checkTriggerEnabledWithParams).mockResolvedValueOnce({
				enabled: true,
				parameters: { authorMode: 'all' },
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				personaIdentities: { implementer: 'cascade-impl', reviewer: 'cascade-review' },
				payload: {
					action: 'opened',
					number: 42,
					pull_request: {
						number: 42,
						title: 'Test PR',
						body: null,
						html_url: 'https://github.com/owner/repo/pull/42',
						state: 'open',
						draft: false,
						head: { ref: 'feature/test', sha: 'abc' },
						base: { ref: 'main' },
						user: { login: 'author' },
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'author' },
				},
			};

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.workItemId).toBeUndefined();
		});
	});
});
