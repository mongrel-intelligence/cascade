import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/trello/client.js', () => ({
	trelloClient: {
		getCardCustomFieldItems: vi.fn(),
	},
}));

import { trelloClient } from '../../../src/trello/client.js';
import { checkBudgetExceeded, resolveCardBudget } from '../../../src/triggers/shared/budget.js';
import type { CascadeConfig, ProjectConfig } from '../../../src/types/index.js';

const mockGetCustomFields = vi.mocked(trelloClient.getCardCustomFieldItems);

const baseProject: ProjectConfig = {
	id: 'test',
	name: 'Test',
	repo: 'owner/repo',
	baseBranch: 'main',
	branchPrefix: 'feature/',
	trello: {
		boardId: 'board123',
		lists: {},
		labels: {},
		customFields: { cost: 'cf-cost-123' },
	},
};

const baseConfig: CascadeConfig = {
	defaults: {
		model: 'test-model',
		agentModels: {},
		maxIterations: 50,
		agentIterations: {},
		watchdogTimeoutMs: 1800000,
		cardBudgetUsd: 5,
		agentBackend: 'llmist',
		progressModel: 'openrouter:google/gemini-2.5-flash-lite',
		progressIntervalMinutes: 5,
	},
	projects: [baseProject],
};

describe('resolveCardBudget', () => {
	it('returns null when no cost custom field configured', () => {
		const project = {
			...baseProject,
			trello: { ...baseProject.trello, customFields: undefined },
		};
		expect(resolveCardBudget(project, baseConfig)).toBeNull();
	});

	it('returns null when cost field is missing from customFields', () => {
		const project = {
			...baseProject,
			trello: { ...baseProject.trello, customFields: {} },
		};
		expect(resolveCardBudget(project, baseConfig)).toBeNull();
	});

	it('returns global default when project has no override', () => {
		expect(resolveCardBudget(baseProject, baseConfig)).toBe(5);
	});

	it('returns project override when set', () => {
		const project = { ...baseProject, cardBudgetUsd: 8.0 };
		expect(resolveCardBudget(project, baseConfig)).toBe(8.0);
	});
});

describe('checkBudgetExceeded', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns null when no cost field configured', async () => {
		const project = {
			...baseProject,
			trello: { ...baseProject.trello, customFields: undefined },
		};
		const result = await checkBudgetExceeded('card1', project, baseConfig);
		expect(result).toBeNull();
		expect(mockGetCustomFields).not.toHaveBeenCalled();
	});

	it('returns not exceeded with full budget when no cost value yet', async () => {
		mockGetCustomFields.mockResolvedValue([]);
		const result = await checkBudgetExceeded('card1', baseProject, baseConfig);
		expect(result).toEqual({
			exceeded: false,
			currentCost: 0,
			budget: 5,
			remaining: 5,
		});
	});

	it('returns not exceeded when under budget', async () => {
		mockGetCustomFields.mockResolvedValue([
			{ idCustomField: 'cf-cost-123', value: { number: '1.25' } },
		]);
		const result = await checkBudgetExceeded('card1', baseProject, baseConfig);
		expect(result).toEqual({
			exceeded: false,
			currentCost: 1.25,
			budget: 5,
			remaining: 3.75,
		});
	});

	it('returns exceeded when cost equals budget', async () => {
		mockGetCustomFields.mockResolvedValue([
			{ idCustomField: 'cf-cost-123', value: { number: '5.00' } },
		]);
		const result = await checkBudgetExceeded('card1', baseProject, baseConfig);
		expect(result).toEqual({
			exceeded: true,
			currentCost: 5,
			budget: 5,
			remaining: 0,
		});
	});

	it('returns exceeded when over budget', async () => {
		mockGetCustomFields.mockResolvedValue([
			{ idCustomField: 'cf-cost-123', value: { number: '6.00' } },
		]);
		const result = await checkBudgetExceeded('card1', baseProject, baseConfig);
		expect(result).toEqual({
			exceeded: true,
			currentCost: 6,
			budget: 5,
			remaining: 0,
		});
	});

	it('uses project budget override', async () => {
		const project = { ...baseProject, cardBudgetUsd: 10.0 };
		mockGetCustomFields.mockResolvedValue([
			{ idCustomField: 'cf-cost-123', value: { number: '5.00' } },
		]);
		const result = await checkBudgetExceeded('card1', project, baseConfig);
		expect(result).toEqual({
			exceeded: false,
			currentCost: 5.0,
			budget: 10.0,
			remaining: 5.0,
		});
	});
});
