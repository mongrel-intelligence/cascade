import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetCustomWorkflowStatusDefinition } = vi.hoisted(() => ({
	mockGetCustomWorkflowStatusDefinition: vi.fn(),
}));

vi.mock('../../../../src/db/repositories/workflowStatusDefinitionsRepository.js', () => ({
	getCustomWorkflowStatusDefinition: mockGetCustomWorkflowStatusDefinition,
	listCustomWorkflowStatusDefinitions: vi.fn().mockResolvedValue([]),
}));

import {
	buildPMLabelDispatchResult,
	resolvePMLabelAgentByList,
	resolvePMLabelAgentByStatusId,
	resolvePMLabelAgentByStatusIdFromWorkflowDefinitions,
	resolvePMLabelAgentByStatusIdOrNameFromWorkflowDefinitions,
	resolvePMLabelAgentByStatusName,
	resolvePMLabelAgentByStatusNameFromWorkflowDefinitions,
} from '../../../../src/triggers/shared/pm-label.js';

describe('PM label helpers', () => {
	beforeEach(() => {
		mockGetCustomWorkflowStatusDefinition.mockReset();
		mockGetCustomWorkflowStatusDefinition.mockResolvedValue(null);
	});

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

	it('resolves JIRA status names through workflow definitions case-insensitively', async () => {
		await expect(
			resolvePMLabelAgentByStatusNameFromWorkflowDefinitions({
				statusName: 'to do',
				configuredStatuses: {
					todo: 'To Do',
				},
			}),
		).resolves.toEqual({ agentType: 'implementation', cascadeStatus: 'todo' });
	});

	it('resolves custom JIRA status names through workflow definitions', async () => {
		mockGetCustomWorkflowStatusDefinition.mockResolvedValue({
			id: 1,
			key: 'prd',
			label: 'PRD',
			agentType: 'prd',
			sortOrder: 1000,
			createdAt: null,
			updatedAt: null,
		});

		await expect(
			resolvePMLabelAgentByStatusNameFromWorkflowDefinitions({
				statusName: 'PRD Review',
				configuredStatuses: {
					prd: 'PRD Review',
				},
			}),
		).resolves.toEqual({ agentType: 'prd', cascadeStatus: 'prd' });
	});

	it('returns undefined when JIRA workflow status has no dispatch agent', async () => {
		await expect(
			resolvePMLabelAgentByStatusNameFromWorkflowDefinitions({
				statusName: 'Done',
				configuredStatuses: {
					done: 'Done',
				},
			}),
		).resolves.toBeUndefined();
	});

	it('resolves Linear state IDs through workflow definitions', async () => {
		await expect(
			resolvePMLabelAgentByStatusIdFromWorkflowDefinitions({
				statusId: 'state-todo',
				configuredStatuses: {
					todo: 'state-todo',
				},
			}),
		).resolves.toEqual({ agentType: 'implementation', cascadeStatus: 'todo' });
	});

	describe('resolvePMLabelAgentByStatusIdOrNameFromWorkflowDefinitions (MNG-1768)', () => {
		it('matches on a locale-invariant JIRA status ID (foreign-language name)', async () => {
			await expect(
				resolvePMLabelAgentByStatusIdOrNameFromWorkflowDefinitions({
					statusId: '10010',
					// Foreign-language name that would never match by name.
					statusName: 'En cours',
					configuredStatuses: {
						todo: '10010',
					},
				}),
			).resolves.toEqual({ agentType: 'implementation', cascadeStatus: 'todo' });
		});

		it('falls back to case-insensitive name matching for legacy name-based configs', async () => {
			await expect(
				resolvePMLabelAgentByStatusIdOrNameFromWorkflowDefinitions({
					statusId: '10010',
					statusName: 'to do',
					configuredStatuses: {
						todo: 'To Do',
					},
				}),
			).resolves.toEqual({ agentType: 'implementation', cascadeStatus: 'todo' });
		});

		it('returns undefined when neither id nor name matches', async () => {
			await expect(
				resolvePMLabelAgentByStatusIdOrNameFromWorkflowDefinitions({
					statusId: '99999',
					statusName: 'Unknown',
					configuredStatuses: {
						todo: '10010',
					},
				}),
			).resolves.toBeUndefined();
		});
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
