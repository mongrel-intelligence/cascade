import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetCustomWorkflowStatusDefinition, mockListCustomWorkflowStatusDefinitions } =
	vi.hoisted(() => ({
		mockGetCustomWorkflowStatusDefinition: vi.fn(),
		mockListCustomWorkflowStatusDefinitions: vi.fn(),
	}));

vi.mock('../../../src/db/repositories/workflowStatusDefinitionsRepository.js', () => ({
	getCustomWorkflowStatusDefinition: mockGetCustomWorkflowStatusDefinition,
	listCustomWorkflowStatusDefinitions: mockListCustomWorkflowStatusDefinitions,
}));

import {
	BUILTIN_WORKFLOW_STATUS_KEYS,
	getBuiltinWorkflowStatusDefinition,
	listWorkflowStatusDefinitions,
	resolveWorkflowStatusDefinition,
} from '../../../src/workflow/statusDefinitions.js';

describe('workflow status definitions', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mockListCustomWorkflowStatusDefinitions.mockResolvedValue([]);
		mockGetCustomWorkflowStatusDefinition.mockResolvedValue(null);
	});

	it('exposes builtin workflow status keys and definitions', () => {
		expect(BUILTIN_WORKFLOW_STATUS_KEYS.has('todo')).toBe(true);
		expect(BUILTIN_WORKFLOW_STATUS_KEYS.has('friction')).toBe(true);
		expect(getBuiltinWorkflowStatusDefinition('todo')).toMatchObject({
			key: 'todo',
			agentType: 'implementation',
			isBuiltin: true,
		});
		expect(getBuiltinWorkflowStatusDefinition('friction')).toMatchObject({
			key: 'friction',
			agentType: null,
			isBuiltin: true,
		});
		expect(getBuiltinWorkflowStatusDefinition('unknown')).toBeUndefined();
	});

	it('lists builtin statuses followed by non-conflicting custom statuses', async () => {
		mockListCustomWorkflowStatusDefinitions.mockResolvedValue([
			{
				id: 1,
				key: 'todo',
				label: 'Todo override',
				agentType: 'custom-todo',
				sortOrder: 1000,
				createdAt: null,
				updatedAt: null,
			},
			{
				id: 2,
				key: 'prd',
				label: 'PRD',
				agentType: 'prd',
				sortOrder: 1010,
				createdAt: null,
				updatedAt: null,
			},
		]);

		const result = await listWorkflowStatusDefinitions();

		expect(result.some((status) => status.key === 'todo' && status.isBuiltin)).toBe(true);
		expect(result).toContainEqual({
			key: 'prd',
			label: 'PRD',
			agentType: 'prd',
			sortOrder: 1010,
			isBuiltin: false,
		});
		expect(result).not.toContainEqual(
			expect.objectContaining({ key: 'todo', label: 'Todo override' }),
		);
	});

	it('resolves builtin statuses without querying custom definitions', async () => {
		const result = await resolveWorkflowStatusDefinition('planning');

		expect(result).toMatchObject({ key: 'planning', isBuiltin: true });
		expect(mockGetCustomWorkflowStatusDefinition).not.toHaveBeenCalled();
	});

	it('resolves custom statuses', async () => {
		mockGetCustomWorkflowStatusDefinition.mockResolvedValue({
			id: 2,
			key: 'prd',
			label: 'PRD',
			agentType: null,
			sortOrder: 1010,
			createdAt: null,
			updatedAt: null,
		});

		await expect(resolveWorkflowStatusDefinition('prd')).resolves.toEqual({
			key: 'prd',
			label: 'PRD',
			agentType: null,
			sortOrder: 1010,
			isBuiltin: false,
		});
	});

	it('returns undefined when a status cannot be resolved', async () => {
		await expect(resolveWorkflowStatusDefinition('missing')).resolves.toBeUndefined();
	});
});
