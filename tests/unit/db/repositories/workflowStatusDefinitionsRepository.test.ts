import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDbWithGetDb } from '../../../helpers/mockDb.js';
import { mockDbClientModule } from '../../../helpers/sharedMocks.js';

vi.mock('../../../../src/db/client.js', () => mockDbClientModule);

import {
	clearAgentTypeReferences,
	createCustomWorkflowStatusDefinition,
	deleteCustomWorkflowStatusDefinition,
	getCustomWorkflowStatusDefinition,
	listCustomWorkflowStatusDefinitions,
	updateCustomWorkflowStatusDefinition,
} from '../../../../src/db/repositories/workflowStatusDefinitionsRepository.js';

const now = new Date('2026-05-01T00:00:00.000Z');

const dbRow = {
	id: 1,
	statusKey: 'prd',
	label: 'PRD',
	agentType: 'prd',
	sortOrder: 1000,
	createdAt: now,
	updatedAt: now,
};

describe('workflowStatusDefinitionsRepository', () => {
	let mockDb: ReturnType<typeof createMockDbWithGetDb>;

	beforeEach(() => {
		mockDb = createMockDbWithGetDb();
	});

	it('lists custom workflow statuses ordered by sort order and key', async () => {
		mockDb.chain.orderBy.mockResolvedValueOnce([dbRow]);

		const result = await listCustomWorkflowStatusDefinitions();

		expect(result).toEqual([
			{
				id: 1,
				key: 'prd',
				label: 'PRD',
				agentType: 'prd',
				sortOrder: 1000,
				createdAt: now,
				updatedAt: now,
			},
		]);
		expect(mockDb.chain.orderBy).toHaveBeenCalledTimes(1);
	});

	it('gets one custom workflow status by key', async () => {
		mockDb.chain.where.mockResolvedValueOnce([dbRow]);

		const result = await getCustomWorkflowStatusDefinition('prd');

		expect(result?.key).toBe('prd');
	});

	it('returns null when custom workflow status is missing', async () => {
		mockDb.chain.where.mockResolvedValueOnce([]);

		await expect(getCustomWorkflowStatusDefinition('missing')).resolves.toBeNull();
	});

	it('creates a custom workflow status', async () => {
		mockDb.chain.returning.mockResolvedValueOnce([dbRow]);

		const result = await createCustomWorkflowStatusDefinition({
			key: 'prd',
			label: 'PRD',
			agentType: 'prd',
			sortOrder: 1000,
		});

		expect(result.key).toBe('prd');
		expect(mockDb.chain.values).toHaveBeenCalledWith({
			statusKey: 'prd',
			label: 'PRD',
			agentType: 'prd',
			sortOrder: 1000,
		});
	});

	it('creates a custom workflow status with default agent and sort order', async () => {
		mockDb.chain.returning.mockResolvedValueOnce([
			{
				...dbRow,
				agentType: null,
				sortOrder: 1000,
			},
		]);

		const result = await createCustomWorkflowStatusDefinition({
			key: 'qa',
			label: 'QA',
		});

		expect(result.agentType).toBeNull();
		expect(mockDb.chain.values).toHaveBeenCalledWith({
			statusKey: 'qa',
			label: 'QA',
			agentType: null,
			sortOrder: 1000,
		});
	});

	it('updates a custom workflow status', async () => {
		mockDb.chain.where.mockReturnValueOnce({ returning: mockDb.chain.returning });
		mockDb.chain.returning.mockResolvedValueOnce([{ ...dbRow, label: 'Product Requirements' }]);

		const result = await updateCustomWorkflowStatusDefinition('prd', {
			label: 'Product Requirements',
			agentType: null,
		});

		expect(result?.label).toBe('Product Requirements');
		expect(mockDb.chain.set).toHaveBeenCalledWith(
			expect.objectContaining({
				label: 'Product Requirements',
				agentType: null,
				updatedAt: expect.any(Date),
			}),
		);
	});

	it('updates only the provided custom workflow status fields', async () => {
		mockDb.chain.where.mockReturnValueOnce({ returning: mockDb.chain.returning });
		mockDb.chain.returning.mockResolvedValueOnce([{ ...dbRow, sortOrder: 1100 }]);

		const result = await updateCustomWorkflowStatusDefinition('prd', { sortOrder: 1100 });

		expect(result?.sortOrder).toBe(1100);
		expect(mockDb.chain.set).toHaveBeenCalledWith(
			expect.objectContaining({
				sortOrder: 1100,
				updatedAt: expect.any(Date),
			}),
		);
	});

	it('returns null when updating a missing custom workflow status', async () => {
		mockDb.chain.where.mockReturnValueOnce({ returning: mockDb.chain.returning });
		mockDb.chain.returning.mockResolvedValueOnce([]);

		await expect(
			updateCustomWorkflowStatusDefinition('missing', { label: 'Missing' }),
		).resolves.toBeNull();
	});

	it('deletes a custom workflow status', async () => {
		mockDb.chain.where.mockResolvedValueOnce({ rowCount: 1 });

		await expect(deleteCustomWorkflowStatusDefinition('prd')).resolves.toBe(true);
	});

	it('returns false when deleting a missing custom workflow status', async () => {
		mockDb.chain.where.mockResolvedValueOnce({ rowCount: 0 });

		await expect(deleteCustomWorkflowStatusDefinition('missing')).resolves.toBe(false);
	});

	it('returns false when delete result omits rowCount', async () => {
		mockDb.chain.where.mockResolvedValueOnce({});

		await expect(deleteCustomWorkflowStatusDefinition('missing')).resolves.toBe(false);
	});

	it('clears matching agent type references and returns affected row count', async () => {
		mockDb.chain.where.mockResolvedValueOnce({ rowCount: 2 });

		await expect(clearAgentTypeReferences('prd-agent')).resolves.toBe(2);
		expect(mockDb.db.update).toHaveBeenCalled();
		expect(mockDb.chain.set).toHaveBeenCalledWith({
			agentType: null,
		});
		expect(mockDb.chain.where).toHaveBeenCalledTimes(1);
	});

	it('returns zero when no workflow status references match the agent type', async () => {
		mockDb.chain.where.mockResolvedValueOnce({ rowCount: 0 });

		await expect(clearAgentTypeReferences('missing-agent')).resolves.toBe(0);
	});

	it('does not touch null agent type rows because cleanup filters by exact agent type', async () => {
		mockDb.chain.where.mockResolvedValueOnce({ rowCount: 1 });

		await clearAgentTypeReferences('story-agent');

		expect(mockDb.chain.set).toHaveBeenCalledWith(expect.objectContaining({ agentType: null }));
		expect(mockDb.chain.where).toHaveBeenCalledTimes(1);
	});
});
