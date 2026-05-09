import { describe, expect, it } from 'vitest';
import {
	buildPMLabelDispatchResult,
	resolvePMLabelAgentByList,
	resolvePMLabelAgentByStatusId,
	resolvePMLabelAgentByStatusName,
} from '../../../../src/triggers/shared/pm-label.js';

describe('PM label helpers', () => {
	it('resolves Trello current lists to agent types', () => {
		const lists = {
			splitting: 'list-splitting',
			planning: 'list-planning',
			todo: 'list-todo',
		};

		expect(resolvePMLabelAgentByList({ currentListId: 'list-splitting', lists })).toBe('splitting');
		expect(resolvePMLabelAgentByList({ currentListId: 'list-planning', lists })).toBe('planning');
		expect(resolvePMLabelAgentByList({ currentListId: 'list-todo', lists })).toBe('implementation');
		expect(resolvePMLabelAgentByList({ currentListId: 'list-backlog', lists })).toBeUndefined();
	});

	it('resolves JIRA status names to label-trigger agent types', () => {
		expect(
			resolvePMLabelAgentByStatusName({
				statusName: 'planning',
				configuredStatuses: {
					planning: 'Planning',
				},
			}),
		).toBe('planning');
	});

	it('resolves Linear state IDs to label-trigger agent types and matched cascade status', () => {
		expect(
			resolvePMLabelAgentByStatusId({
				statusId: 'state-todo',
				configuredStatuses: {
					todo: 'state-todo',
				},
			}),
		).toEqual({ agentType: 'implementation', cascadeStatus: 'todo' });
	});

	it('builds canonical label-added dispatch results', () => {
		expect(
			buildPMLabelDispatchResult({
				agentType: 'implementation',
				workItemId: 'CARD-123',
				workItemUrl: 'https://example.test/CARD-123',
				workItemTitle: 'Implement feature',
				agentInput: { linearIssueId: 'linear-issue-id' },
			}),
		).toEqual({
			agentType: 'implementation',
			agentInput: {
				workItemId: 'CARD-123',
				workItemUrl: 'https://example.test/CARD-123',
				workItemTitle: 'Implement feature',
				triggerEvent: 'pm:label-added',
				linearIssueId: 'linear-issue-id',
			},
			workItemId: 'CARD-123',
			workItemUrl: 'https://example.test/CARD-123',
			workItemTitle: 'Implement feature',
			onBlocked: undefined,
			coalesceKey: undefined,
		});
	});
});
