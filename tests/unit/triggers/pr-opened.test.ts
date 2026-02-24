import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROpenedTrigger } from '../../../src/triggers/github/pr-opened.js';
import type { TriggerContext } from '../../../src/triggers/types.js';

vi.mock('../../../src/db/repositories/prWorkItemsRepository.js', () => ({
	lookupWorkItemForPR: vi.fn(),
}));
import { lookupWorkItemForPR } from '../../../src/db/repositories/prWorkItemsRepository.js';

describe('PROpenedTrigger', () => {
	const trigger = new PROpenedTrigger();

	const mockProject = {
		id: 'test',
		name: 'Test',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		trello: {
			boardId: 'board123',
			lists: {
				briefing: 'briefing-list-id',
				planning: 'planning-list-id',
				todo: 'todo-list-id',
			},
			labels: {},
		},
	};

	/** Project with prOpened + externalPrs enabled (most common config for external PR review) */
	const mockProjectWithPrOpenedEnabled = {
		...mockProject,
		github: {
			triggers: { prOpened: true, reviewTrigger: { externalPrs: true } },
		},
	};

	/** Project with prOpened + ownPrsOnly (fires on implementer-authored PRs) */
	const mockProjectWithOwnPrsOnly = {
		...mockProject,
		github: {
			triggers: { prOpened: true, reviewTrigger: { ownPrsOnly: true } },
		},
	};

	/** Project with prOpened + both modes (fires on all PRs) */
	const mockProjectWithBothModes = {
		...mockProject,
		github: {
			triggers: { prOpened: true, reviewTrigger: { ownPrsOnly: true, externalPrs: true } },
		},
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(lookupWorkItemForPR).mockResolvedValue(null);
	});

	describe('matches', () => {
		it('does not match by default (opt-in trigger, disabled without config)', () => {
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

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('matches when action is opened and not draft with prOpened + externalPrs enabled', () => {
			const ctx: TriggerContext = {
				project: mockProjectWithPrOpenedEnabled,
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

		it('does not match when prOpened is true but neither ownPrsOnly nor externalPrs', () => {
			const project = {
				...mockProject,
				github: {
					triggers: {
						prOpened: true,
						reviewTrigger: { ownPrsOnly: false, externalPrs: false },
					},
				},
			};
			const ctx: TriggerContext = {
				project,
				source: 'github',
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

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('matches when prOpened is true with ownPrsOnly only', () => {
			const ctx: TriggerContext = {
				project: mockProjectWithOwnPrsOnly,
				source: 'github',
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

			expect(trigger.matches(ctx)).toBe(true);
		});

		it('matches when prOpened is true with legacy config (no reviewTrigger, checkSuiteSuccess defaults to ownPrsOnly)', () => {
			const project = {
				...mockProject,
				github: {
					triggers: { prOpened: true },
				},
			};
			const ctx: TriggerContext = {
				project,
				source: 'github',
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

			// Legacy fallback: checkSuiteSuccess defaults to true → ownPrsOnly = true
			expect(trigger.matches(ctx)).toBe(true);
		});

		it('does not match when source is not github', () => {
			const ctx: TriggerContext = {
				project: mockProjectWithPrOpenedEnabled,
				source: 'trello',
				payload: {},
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match when action is not opened', () => {
			const ctx: TriggerContext = {
				project: mockProjectWithPrOpenedEnabled,
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
				project: mockProjectWithPrOpenedEnabled,
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
				project: mockProjectWithPrOpenedEnabled,
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
			const ctx: TriggerContext = {
				project: mockProjectWithPrOpenedEnabled,
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
				},
				prNumber: 42,
				workItemId: 'abc123',
			});
		});

		it('fires without work item when PR has no work item reference', async () => {
			const ctx: TriggerContext = {
				project: mockProjectWithPrOpenedEnabled,
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

		it('returns null for implementer PR when only externalPrs is enabled', async () => {
			const ctx: TriggerContext = {
				project: mockProjectWithPrOpenedEnabled,
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

		it('fires for implementer PR when ownPrsOnly is enabled', async () => {
			const ctx: TriggerContext = {
				project: mockProjectWithOwnPrsOnly,
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

		it('returns null for external PR when only ownPrsOnly is enabled', async () => {
			const ctx: TriggerContext = {
				project: mockProjectWithOwnPrsOnly,
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

		it('returns null for implementer [bot] variant when only externalPrs is enabled', async () => {
			const ctx: TriggerContext = {
				project: mockProjectWithPrOpenedEnabled,
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

		it('fires for external PR when externalPrs is enabled', async () => {
			const ctx: TriggerContext = {
				project: mockProjectWithPrOpenedEnabled,
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

		it('fires for reviewer persona PR when externalPrs is enabled (reviewer is not implementer)', async () => {
			const ctx: TriggerContext = {
				project: mockProjectWithPrOpenedEnabled,
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

		it('fires for both implementer and external PRs when both modes enabled', async () => {
			const implCtx: TriggerContext = {
				project: mockProjectWithBothModes,
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
				project: mockProjectWithBothModes,
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
				project: mockProjectWithPrOpenedEnabled,
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
			const ctx: TriggerContext = {
				project: mockProjectWithPrOpenedEnabled,
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
