import { describe, expect, it, vi } from 'vitest';

// Mock getPMProviderOrNull to control the PM type
vi.mock('../../../../src/pm/index.js', () => ({
	getPMProviderOrNull: vi.fn(),
}));

import { buildPromptContext } from '../../../../src/agents/shared/promptContext.js';
import { getPMProviderOrNull } from '../../../../src/pm/index.js';
import { createMockPMProvider } from '../../../helpers/mockPMProvider.js';

const mockGetPMProvider = vi.mocked(getPMProviderOrNull);

function makeProject(overrides: Record<string, unknown> = {}) {
	return {
		id: 'test-project',
		name: 'Test Project',
		repo: 'owner/repo',
		orgId: 'org1',
		baseBranch: 'main',
		branchPrefix: 'cascade/',
		trello: {
			boardId: 'board1',
			lists: {
				splitting: 'list1',
				planning: 'list2',
				todo: 'list3',
				backlog: 'list-backlog',
				inProgress: 'list-in-progress',
				inReview: 'list-in-review',
				stories: 'list-stories',
				debug: 'list-debug',
			},
			labels: { readyToProcess: 'label1', processed: 'label2' },
		},
		...overrides,
	};
}

describe('buildPromptContext', () => {
	describe('with Trello provider', () => {
		beforeEach(() => {
			const mockProvider = createMockPMProvider();
			mockProvider.type = 'trello';
			mockProvider.getWorkItemUrl = vi.fn((id: string) => `https://trello.com/c/${id}`);
			mockGetPMProvider.mockReturnValue(mockProvider);
		});

		it('sets workItemNoun to "card" for Trello', () => {
			const ctx = buildPromptContext('card123', makeProject() as never);
			expect(ctx.workItemNoun).toBe('card');
		});

		it('sets workItemNounPlural to "cards" for Trello', () => {
			const ctx = buildPromptContext('card123', makeProject() as never);
			expect(ctx.workItemNounPlural).toBe('cards');
		});

		it('sets workItemNounCap to "Card" for Trello', () => {
			const ctx = buildPromptContext('card123', makeProject() as never);
			expect(ctx.workItemNounCap).toBe('Card');
		});

		it('sets workItemNounPluralCap to "Cards" for Trello', () => {
			const ctx = buildPromptContext('card123', makeProject() as never);
			expect(ctx.workItemNounPluralCap).toBe('Cards');
		});

		it('sets pmName to "Trello"', () => {
			const ctx = buildPromptContext('card123', makeProject() as never);
			expect(ctx.pmName).toBe('Trello');
		});

		it('sets pmType to "trello"', () => {
			const ctx = buildPromptContext('card123', makeProject() as never);
			expect(ctx.pmType).toBe('trello');
		});

		it('generates cardUrl from provider', () => {
			const ctx = buildPromptContext('card123', makeProject() as never);
			expect(ctx.cardUrl).toBe('https://trello.com/c/card123');
		});

		it('sets cardId from parameter', () => {
			const ctx = buildPromptContext('card-abc', makeProject() as never);
			expect(ctx.cardId).toBe('card-abc');
		});

		it('includes storiesListId from project trello config', () => {
			const ctx = buildPromptContext('card123', makeProject() as never);
			expect(ctx.storiesListId).toBe('list-stories');
		});

		it('includes processedLabelId from project trello config', () => {
			const ctx = buildPromptContext('card123', makeProject() as never);
			expect(ctx.processedLabelId).toBe('label2');
		});

		it('includes backlogListId from project trello config', () => {
			const ctx = buildPromptContext('card123', makeProject() as never);
			expect(ctx.backlogListId).toBe('list-backlog');
		});

		it('includes todoListId from project trello config', () => {
			const ctx = buildPromptContext('card123', makeProject() as never);
			expect(ctx.todoListId).toBe('list3');
		});

		it('includes inProgressListId from project trello config', () => {
			const ctx = buildPromptContext('card123', makeProject() as never);
			expect(ctx.inProgressListId).toBe('list-in-progress');
		});

		it('includes inReviewListId from project trello config', () => {
			const ctx = buildPromptContext('card123', makeProject() as never);
			expect(ctx.inReviewListId).toBe('list-in-review');
		});
	});

	describe('with JIRA provider', () => {
		beforeEach(() => {
			const mockProvider = createMockPMProvider();
			mockProvider.type = 'jira' as never;
			mockProvider.getWorkItemUrl = vi.fn(
				(id: string) => `https://company.atlassian.net/browse/${id}`,
			);
			mockGetPMProvider.mockReturnValue(mockProvider);
		});

		it('sets workItemNoun to "issue" for JIRA', () => {
			const ctx = buildPromptContext('PROJ-123', makeProject() as never);
			expect(ctx.workItemNoun).toBe('issue');
		});

		it('sets workItemNounPlural to "issues" for JIRA', () => {
			const ctx = buildPromptContext('PROJ-123', makeProject() as never);
			expect(ctx.workItemNounPlural).toBe('issues');
		});

		it('sets workItemNounCap to "Issue" for JIRA', () => {
			const ctx = buildPromptContext('PROJ-123', makeProject() as never);
			expect(ctx.workItemNounCap).toBe('Issue');
		});

		it('sets workItemNounPluralCap to "Issues" for JIRA', () => {
			const ctx = buildPromptContext('PROJ-123', makeProject() as never);
			expect(ctx.workItemNounPluralCap).toBe('Issues');
		});

		it('sets pmName to "JIRA"', () => {
			const ctx = buildPromptContext('PROJ-123', makeProject() as never);
			expect(ctx.pmName).toBe('JIRA');
		});

		it('sets pmType to "jira"', () => {
			const ctx = buildPromptContext('PROJ-123', makeProject() as never);
			expect(ctx.pmType).toBe('jira');
		});

		it('sets storiesListId to JIRA project key when no Trello config', () => {
			const jiraProject = makeProject({
				trello: undefined,
				pm: { type: 'jira' },
				jira: {
					projectKey: 'BTS',
					baseUrl: 'https://company.atlassian.net',
					statuses: { todo: 'To Do' },
				},
			});
			const ctx = buildPromptContext('BTS-148', jiraProject as never);
			expect(ctx.storiesListId).toBe('BTS');
		});

		it('sets pipeline list IDs from JIRA statuses', () => {
			const jiraProject = makeProject({
				trello: undefined,
				pm: { type: 'jira' },
				jira: {
					projectKey: 'PROJ',
					baseUrl: 'https://company.atlassian.net',
					statuses: {
						backlog: 'Backlog',
						todo: 'To Do',
						inProgress: 'In Progress',
						inReview: 'In Review',
					},
				},
			});
			const ctx = buildPromptContext('PROJ-1', jiraProject as never);
			expect(ctx.backlogListId).toBe('Backlog');
			expect(ctx.todoListId).toBe('To Do');
			expect(ctx.inProgressListId).toBe('In Progress');
			expect(ctx.inReviewListId).toBe('In Review');
		});

		it('leaves pipeline list IDs undefined when JIRA statuses are missing', () => {
			const jiraProject = makeProject({
				trello: undefined,
				pm: { type: 'jira' },
				jira: {
					projectKey: 'PROJ',
					baseUrl: 'https://company.atlassian.net',
					statuses: {},
				},
			});
			const ctx = buildPromptContext('PROJ-1', jiraProject as never);
			expect(ctx.backlogListId).toBeUndefined();
			expect(ctx.todoListId).toBeUndefined();
			expect(ctx.inProgressListId).toBeUndefined();
			expect(ctx.inReviewListId).toBeUndefined();
		});
	});

	describe('with prContext', () => {
		beforeEach(() => {
			const mockProvider = createMockPMProvider();
			mockProvider.getWorkItemUrl = vi.fn((id: string) => `https://trello.com/c/${id}`);
			mockGetPMProvider.mockReturnValue(mockProvider);
		});

		const prContext = {
			prNumber: 42,
			prBranch: 'feature/my-branch',
			repoFullName: 'owner/repo',
			headSha: 'abc123def456',
		};

		it('includes prNumber', () => {
			const ctx = buildPromptContext('card1', makeProject() as never, 'check_suite', prContext);
			expect(ctx.prNumber).toBe(42);
		});

		it('includes prBranch', () => {
			const ctx = buildPromptContext('card1', makeProject() as never, 'check_suite', prContext);
			expect(ctx.prBranch).toBe('feature/my-branch');
		});

		it('includes repoFullName', () => {
			const ctx = buildPromptContext('card1', makeProject() as never, 'check_suite', prContext);
			expect(ctx.repoFullName).toBe('owner/repo');
		});

		it('includes headSha', () => {
			const ctx = buildPromptContext('card1', makeProject() as never, 'check_suite', prContext);
			expect(ctx.headSha).toBe('abc123def456');
		});

		it('includes triggerType', () => {
			const ctx = buildPromptContext('card1', makeProject() as never, 'check_suite', prContext);
			expect(ctx.triggerType).toBe('check_suite');
		});
	});

	describe('with debugContext', () => {
		beforeEach(() => {
			const mockProvider = createMockPMProvider();
			mockProvider.getWorkItemUrl = vi.fn((id: string) => `https://trello.com/c/${id}`);
			mockGetPMProvider.mockReturnValue(mockProvider);
		});

		const debugContext = {
			logDir: '/tmp/logs/debug-session',
			originalCardId: 'original-card-id',
			originalCardName: 'My Feature Card',
			originalCardUrl: 'https://trello.com/c/abc',
			detectedAgentType: 'implementation',
		};

		it('includes logDir', () => {
			const ctx = buildPromptContext(
				undefined,
				makeProject() as never,
				undefined,
				undefined,
				debugContext,
			);
			expect(ctx.logDir).toBe('/tmp/logs/debug-session');
		});

		it('includes originalCardName', () => {
			const ctx = buildPromptContext(
				undefined,
				makeProject() as never,
				undefined,
				undefined,
				debugContext,
			);
			expect(ctx.originalCardName).toBe('My Feature Card');
		});

		it('includes originalCardUrl', () => {
			const ctx = buildPromptContext(
				undefined,
				makeProject() as never,
				undefined,
				undefined,
				debugContext,
			);
			expect(ctx.originalCardUrl).toBe('https://trello.com/c/abc');
		});

		it('includes detectedAgentType', () => {
			const ctx = buildPromptContext(
				undefined,
				makeProject() as never,
				undefined,
				undefined,
				debugContext,
			);
			expect(ctx.detectedAgentType).toBe('implementation');
		});

		it('includes debugListId from project trello config', () => {
			const ctx = buildPromptContext(
				undefined,
				makeProject() as never,
				undefined,
				undefined,
				debugContext,
			);
			expect(ctx.debugListId).toBe('list-debug');
		});
	});

	describe('without optional contexts', () => {
		beforeEach(() => {
			const mockProvider = createMockPMProvider();
			mockProvider.getWorkItemUrl = vi.fn(() => undefined);
			mockGetPMProvider.mockReturnValue(mockProvider);
		});

		it('has undefined prNumber when no prContext', () => {
			const ctx = buildPromptContext('card1', makeProject() as never);
			expect(ctx.prNumber).toBeUndefined();
		});

		it('has undefined logDir when no debugContext', () => {
			const ctx = buildPromptContext('card1', makeProject() as never);
			expect(ctx.logDir).toBeUndefined();
		});

		it('handles undefined cardId', () => {
			const ctx = buildPromptContext(undefined, makeProject() as never);
			expect(ctx.cardId).toBeUndefined();
			expect(ctx.cardUrl).toBeUndefined();
		});

		it('includes projectId from project', () => {
			const ctx = buildPromptContext('card1', makeProject() as never);
			expect(ctx.projectId).toBe('test-project');
		});

		it('includes baseBranch from project', () => {
			const ctx = buildPromptContext('card1', makeProject() as never);
			expect(ctx.baseBranch).toBe('main');
		});
	});

	describe('without PM provider (no PM context — e.g. debug agent from dashboard)', () => {
		beforeEach(() => {
			mockGetPMProvider.mockReturnValue(null);
		});

		it('does not throw when PM provider is null', () => {
			expect(() => buildPromptContext('card1', makeProject() as never)).not.toThrow();
		});

		it('leaves pmType undefined', () => {
			const ctx = buildPromptContext('card1', makeProject() as never);
			expect(ctx.pmType).toBeUndefined();
		});

		it('leaves cardUrl undefined even when cardId is provided', () => {
			const ctx = buildPromptContext('card123', makeProject() as never);
			expect(ctx.cardUrl).toBeUndefined();
		});

		it('defaults workItemNoun to "card" (Trello vocabulary fallback)', () => {
			const ctx = buildPromptContext('card1', makeProject() as never);
			expect(ctx.workItemNoun).toBe('card');
		});

		it('defaults workItemNounPlural to "cards"', () => {
			const ctx = buildPromptContext('card1', makeProject() as never);
			expect(ctx.workItemNounPlural).toBe('cards');
		});

		it('defaults pmName to "Trello"', () => {
			const ctx = buildPromptContext('card1', makeProject() as never);
			expect(ctx.pmName).toBe('Trello');
		});

		it('still includes projectId and baseBranch from project config', () => {
			const ctx = buildPromptContext('card1', makeProject() as never);
			expect(ctx.projectId).toBe('test-project');
			expect(ctx.baseBranch).toBe('main');
		});

		it('still includes debugContext fields when provided', () => {
			const debugContext = {
				logDir: '/tmp/logs',
				originalCardId: 'orig-id',
				originalCardName: 'Original Card',
				originalCardUrl: 'https://trello.com/c/orig',
				detectedAgentType: 'implementation',
			};
			const ctx = buildPromptContext(
				undefined,
				makeProject() as never,
				undefined,
				undefined,
				debugContext,
			);
			expect(ctx.logDir).toBe('/tmp/logs');
			expect(ctx.detectedAgentType).toBe('implementation');
		});
	});
});
