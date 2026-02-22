import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROpenedTrigger } from '../../../src/triggers/github/pr-opened.js';
import type { TriggerContext } from '../../../src/triggers/types.js';

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

	/** Project with prOpened trigger explicitly enabled via github.triggers config */
	const mockProjectWithPrOpenedEnabled = {
		...mockProject,
		github: {
			triggers: { prOpened: true },
		},
	};

	beforeEach(() => {
		vi.clearAllMocks();
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

		it('matches when action is opened and not draft with prOpened enabled', () => {
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

	describe('resolveAgentType', () => {
		it('returns respond-to-review', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {},
			};
			expect(trigger.resolveAgentType(ctx)).toBe('respond-to-review');
		});
	});

	describe('handle', () => {
		it('returns result when PR body has Trello URL', async () => {
			const ctx: TriggerContext = {
				project: mockProjectWithPrOpenedEnabled,
				source: 'github',
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
				agentType: 'respond-to-review',
				agentInput: {
					prNumber: 42,
					prBranch: 'feature/test',
					repoFullName: 'owner/repo',
					triggerCommentId: 0,
					triggerCommentBody: 'New PR: Test PR\n\nImplements https://trello.com/c/abc123/card-name',
					triggerCommentPath: '',
					triggerCommentUrl: 'https://github.com/owner/repo/pull/42',
				},
				prNumber: 42,
				workItemId: 'abc123',
			});
		});

		it('returns null when PR body has no Trello URL', async () => {
			const ctx: TriggerContext = {
				project: mockProjectWithPrOpenedEnabled,
				source: 'github',
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

			expect(result).toBeNull();
		});

		it('handles null PR body', async () => {
			const ctx: TriggerContext = {
				project: mockProjectWithPrOpenedEnabled,
				source: 'github',
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

			expect(result).toBeNull();
		});
	});
});
