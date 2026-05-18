import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetCustomWorkflowStatusDefinition } = vi.hoisted(() => ({
	mockGetCustomWorkflowStatusDefinition: vi.fn(),
}));

vi.mock('../../../../src/db/repositories/workflowStatusDefinitionsRepository.js', () => ({
	getCustomWorkflowStatusDefinition: mockGetCustomWorkflowStatusDefinition,
	listCustomWorkflowStatusDefinitions: vi.fn().mockResolvedValue([]),
}));

import {
	buildPMStatusCoalesceKey,
	buildPMStatusDispatchResult,
	resolvePMStatusAgentById,
	resolvePMStatusAgentByIdFromWorkflowDefinitions,
	resolvePMStatusAgentByName,
	resolvePMStatusAgentByNameFromWorkflowDefinitions,
	shouldFirePMStatusEvent,
} from '../../../../src/triggers/shared/pm-status.js';

describe('PM status helpers', () => {
	beforeEach(() => {
		mockGetCustomWorkflowStatusDefinition.mockReset();
		mockGetCustomWorkflowStatusDefinition.mockResolvedValue(null);
	});

	it('resolves provider status names to agent types case-insensitively', () => {
		expect(
			resolvePMStatusAgentByName({
				statusName: 'to do',
				configuredStatuses: {
					splitting: 'Splitting',
					todo: 'To Do',
				},
			}),
		).toEqual({ agentType: 'implementation', cascadeStatus: 'todo' });
	});

	it('resolves provider status IDs to agent types exactly', () => {
		expect(
			resolvePMStatusAgentById({
				statusId: 'state-planning',
				configuredStatuses: {
					planning: 'state-planning',
					todo: 'state-todo',
				},
			}),
		).toEqual({ agentType: 'planning', cascadeStatus: 'planning' });
	});

	it('ignores configured statuses without an agent mapping', () => {
		expect(
			resolvePMStatusAgentByName({
				statusName: 'Done',
				configuredStatuses: {
					merged: 'Done',
				},
			}),
		).toBeUndefined();
	});

	it('resolves custom workflow status IDs to custom agents', async () => {
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
			resolvePMStatusAgentByIdFromWorkflowDefinitions({
				statusId: 'state-prd',
				configuredStatuses: {
					prd: 'state-prd',
				},
			}),
		).resolves.toEqual({ agentType: 'prd', cascadeStatus: 'prd' });
	});

	it('ignores workflow statuses with no dispatch agent', async () => {
		await expect(
			resolvePMStatusAgentByIdFromWorkflowDefinitions({
				statusId: 'state-done',
				configuredStatuses: {
					done: 'state-done',
				},
			}),
		).resolves.toBeUndefined();
	});

	it('resolves custom workflow status names to custom agents case-insensitively', async () => {
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
			resolvePMStatusAgentByNameFromWorkflowDefinitions({
				statusName: 'prd review',
				configuredStatuses: {
					prd: 'PRD Review',
				},
			}),
		).resolves.toEqual({ agentType: 'prd', cascadeStatus: 'prd' });
	});

	it('resolves built-in status names through workflow definitions case-insensitively', async () => {
		await expect(
			resolvePMStatusAgentByNameFromWorkflowDefinitions({
				statusName: 'to do',
				configuredStatuses: {
					todo: 'To Do',
				},
			}),
		).resolves.toEqual({ agentType: 'implementation', cascadeStatus: 'todo' });
	});

	it('ignores workflow statuses with no dispatch agent when resolving by name', async () => {
		await expect(
			resolvePMStatusAgentByNameFromWorkflowDefinitions({
				statusName: 'Done',
				configuredStatuses: {
					done: 'Done',
				},
			}),
		).resolves.toBeUndefined();
	});

	it('returns undefined when name does not match any configured status', async () => {
		await expect(
			resolvePMStatusAgentByNameFromWorkflowDefinitions({
				statusName: 'Unknown',
				configuredStatuses: {
					todo: 'To Do',
					planning: 'Planning',
				},
			}),
		).resolves.toBeUndefined();
	});

	it('applies shared onCreate/onMove trigger parameter semantics', () => {
		expect(shouldFirePMStatusEvent(true, { onCreate: true })).toBe(true);
		expect(shouldFirePMStatusEvent(true, {})).toBe(false);
		expect(shouldFirePMStatusEvent(false, {})).toBe(true);
		expect(shouldFirePMStatusEvent(false, { onMove: false })).toBe(false);
	});

	it('builds project-scoped coalesce keys', () => {
		expect(buildPMStatusCoalesceKey('project-1', 'CARD-123')).toBe('project-1:CARD-123');
	});

	it('builds canonical status-changed dispatch results', () => {
		expect(
			buildPMStatusDispatchResult({
				projectId: 'project-1',
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
				triggerEvent: 'pm:status-changed',
				linearIssueId: 'linear-issue-id',
			},
			workItemId: 'CARD-123',
			workItemUrl: 'https://example.test/CARD-123',
			workItemTitle: 'Implement feature',
			onBlocked: undefined,
			coalesceKey: 'project-1:CARD-123',
		});
	});
});
