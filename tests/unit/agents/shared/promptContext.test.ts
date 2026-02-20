import { describe, expect, it, vi } from 'vitest';

// Mock getPMProvider to control the PM type
vi.mock('../../../../src/pm/index.js', () => ({
	getPMProvider: vi.fn(),
}));

import { buildPromptContext } from '../../../../src/agents/shared/promptContext.js';
import { getPMProvider } from '../../../../src/pm/index.js';
import { createMockPMProvider } from '../../../helpers/mockPMProvider.js';

const mockGetPMProvider = vi.mocked(getPMProvider);

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
				briefing: 'list1',
				planning: 'list2',
				todo: 'list3',
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
});
