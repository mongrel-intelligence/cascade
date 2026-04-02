import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/pm/index.js', () => ({
	getPMProvider: vi.fn(),
}));

import type { PMProvider } from '../../../src/pm/index.js';
import { getPMProvider } from '../../../src/pm/index.js';
import { checkBudgetExceeded, resolveWorkItemBudget } from '../../../src/triggers/shared/budget.js';
import type { ProjectConfig } from '../../../src/types/index.js';
import { createMockProject } from '../../helpers/factories.js';

const mockPMProvider = { getCustomFieldNumber: vi.fn() };
vi.mocked(getPMProvider).mockReturnValue(mockPMProvider as unknown as PMProvider);

const baseProject: ProjectConfig = createMockProject({
	workItemBudgetUsd: 5,
	trello: {
		boardId: 'board123',
		lists: {},
		labels: {},
		customFields: { cost: 'cf-cost-123' },
	},
});

describe('resolveWorkItemBudget', () => {
	it('returns null when no cost custom field configured', () => {
		const project = {
			...baseProject,
			trello: { ...baseProject.trello, customFields: undefined },
		};
		expect(resolveWorkItemBudget(project)).toBeNull();
	});

	it('returns null when cost field is missing from customFields', () => {
		const project = {
			...baseProject,
			trello: { ...baseProject.trello, customFields: {} },
		};
		expect(resolveWorkItemBudget(project)).toBeNull();
	});

	it('returns project budget when cost field is configured', () => {
		expect(resolveWorkItemBudget(baseProject)).toBe(5);
	});

	it('returns project override when set', () => {
		const project = { ...baseProject, workItemBudgetUsd: 8.0 };
		expect(resolveWorkItemBudget(project)).toBe(8.0);
	});
});

describe('checkBudgetExceeded', () => {
	it('returns null when no cost field configured', async () => {
		const project = {
			...baseProject,
			trello: { ...baseProject.trello, customFields: undefined },
		};
		const result = await checkBudgetExceeded('card1', project);
		expect(result).toBeNull();
	});

	it('returns not exceeded with full budget when no cost value yet', async () => {
		mockPMProvider.getCustomFieldNumber.mockResolvedValue(0);
		const result = await checkBudgetExceeded('card1', baseProject);
		expect(result).toEqual({
			exceeded: false,
			currentCost: 0,
			budget: 5,
			remaining: 5,
		});
	});

	it('returns not exceeded when under budget', async () => {
		mockPMProvider.getCustomFieldNumber.mockResolvedValue(1.25);
		const result = await checkBudgetExceeded('card1', baseProject);
		expect(result).toEqual({
			exceeded: false,
			currentCost: 1.25,
			budget: 5,
			remaining: 3.75,
		});
	});

	it('returns exceeded when cost equals budget', async () => {
		mockPMProvider.getCustomFieldNumber.mockResolvedValue(5);
		const result = await checkBudgetExceeded('card1', baseProject);
		expect(result).toEqual({
			exceeded: true,
			currentCost: 5,
			budget: 5,
			remaining: 0,
		});
	});

	it('returns exceeded when over budget', async () => {
		mockPMProvider.getCustomFieldNumber.mockResolvedValue(6);
		const result = await checkBudgetExceeded('card1', baseProject);
		expect(result).toEqual({
			exceeded: true,
			currentCost: 6,
			budget: 5,
			remaining: 0,
		});
	});

	it('uses project budget override', async () => {
		const project = { ...baseProject, workItemBudgetUsd: 10.0 };
		mockPMProvider.getCustomFieldNumber.mockResolvedValue(5);
		const result = await checkBudgetExceeded('card1', project);
		expect(result).toEqual({
			exceeded: false,
			currentCost: 5.0,
			budget: 10.0,
			remaining: 5.0,
		});
	});
});
