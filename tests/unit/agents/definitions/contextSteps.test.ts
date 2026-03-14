import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/pm/index.js', () => ({
	getPMProviderOrNull: vi.fn(),
}));

vi.mock('../../../../src/gadgets/todo/storage.js', () => ({
	initTodoSession: vi.fn(),
	saveTodos: vi.fn(),
	getNextId: vi.fn((todos: unknown[]) => String(todos.length + 1)),
	formatTodoList: vi.fn(() => '📋 Todo List\n   Progress: 0/2 done, 0 in progress, 2 pending'),
}));

import { prepopulateTodosStep } from '../../../../src/agents/definitions/contextSteps.js';
import type { FetchContextParams } from '../../../../src/agents/definitions/contextSteps.js';
import { initTodoSession, saveTodos } from '../../../../src/gadgets/todo/storage.js';
import { getPMProviderOrNull } from '../../../../src/pm/index.js';
import type { AgentInput } from '../../../../src/types/index.js';

const mockGetPMProviderOrNull = vi.mocked(getPMProviderOrNull);
const mockInitTodoSession = vi.mocked(initTodoSession);
const mockSaveTodos = vi.mocked(saveTodos);

function makeParams(input: Partial<AgentInput>): FetchContextParams {
	return {
		input: input as AgentInput,
		repoDir: '/tmp/repo',
		contextFiles: [],
		logWriter: vi.fn(),
	};
}

describe('prepopulateTodosStep', () => {
	it('returns empty array when no workItemId', async () => {
		const result = await prepopulateTodosStep(makeParams({}));
		expect(result).toEqual([]);
	});

	it('returns empty array when no PM provider', async () => {
		mockGetPMProviderOrNull.mockReturnValue(null);
		const result = await prepopulateTodosStep(makeParams({ workItemId: 'card-1' }));
		expect(result).toEqual([]);
	});

	it('returns empty array when no Implementation Steps checklist', async () => {
		const provider = {
			getChecklists: vi
				.fn()
				.mockResolvedValue([
					{ id: 'cl-1', name: 'Acceptance Criteria', workItemId: 'card-1', items: [] },
				]),
		};
		mockGetPMProviderOrNull.mockReturnValue(provider as never);

		const result = await prepopulateTodosStep(makeParams({ workItemId: 'card-1' }));
		expect(result).toEqual([]);
	});

	it('pre-populates from incomplete items, skips completed items', async () => {
		const provider = {
			getChecklists: vi.fn().mockResolvedValue([
				{
					id: 'cl-1',
					name: '📋 Implementation Steps',
					workItemId: 'card-1',
					items: [
						{ id: 'i1', name: 'Step 1 (done)', complete: true },
						{ id: 'i2', name: 'Step 2', complete: false },
						{ id: 'i3', name: 'Step 3', complete: false },
					],
				},
			]),
		};
		mockGetPMProviderOrNull.mockReturnValue(provider as never);

		const result = await prepopulateTodosStep(makeParams({ workItemId: 'card-1' }));

		expect(result).toHaveLength(1);
		expect(result[0].toolName).toBe('TodoUpsert');
		expect(result[0].description).toBe('Pre-populated 2 todos from Implementation Steps');
		expect(mockInitTodoSession).toHaveBeenCalledWith('card-1'); // workItemId value
		expect(mockSaveTodos).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({ content: 'Step 2', status: 'pending' }),
				expect.objectContaining({ content: 'Step 3', status: 'pending' }),
			]),
		);
	});

	it('handles emoji prefix in checklist name', async () => {
		const provider = {
			getChecklists: vi.fn().mockResolvedValue([
				{
					id: 'cl-1',
					name: '📋 Implementation Steps',
					workItemId: 'card-1',
					items: [{ id: 'i1', name: 'Step 1', complete: false }],
				},
			]),
		};
		mockGetPMProviderOrNull.mockReturnValue(provider as never);

		const result = await prepopulateTodosStep(makeParams({ workItemId: 'card-1' }));
		expect(result).toHaveLength(1);
	});

	it('returns correct ContextInjection format', async () => {
		const provider = {
			getChecklists: vi.fn().mockResolvedValue([
				{
					id: 'cl-1',
					name: 'Implementation Steps',
					workItemId: 'card-1',
					items: [{ id: 'i1', name: 'Do something', complete: false }],
				},
			]),
		};
		mockGetPMProviderOrNull.mockReturnValue(provider as never);

		const result = await prepopulateTodosStep(makeParams({ workItemId: 'card-1' }));

		expect(result[0]).toEqual({
			toolName: 'TodoUpsert',
			params: { comment: 'Pre-populated todos from Implementation Steps checklist' },
			result: expect.stringContaining('Do NOT delete or recreate these'),
			description: 'Pre-populated 1 todos from Implementation Steps',
		});
	});

	it('returns empty array and logs warning on PM provider error', async () => {
		const provider = {
			getChecklists: vi.fn().mockRejectedValue(new Error('PM error')),
		};
		mockGetPMProviderOrNull.mockReturnValue(provider as never);

		const params = makeParams({ workItemId: 'card-1' });
		const result = await prepopulateTodosStep(params);
		expect(result).toEqual([]);
		expect(params.logWriter).toHaveBeenCalledWith('WARN', 'prepopulateTodosStep failed', {
			workItemId: 'card-1',
			error: 'PM error',
		});
	});

	it('returns empty array when all items are completed', async () => {
		const provider = {
			getChecklists: vi.fn().mockResolvedValue([
				{
					id: 'cl-1',
					name: 'Implementation Steps',
					workItemId: 'card-1',
					items: [
						{ id: 'i1', name: 'Step 1', complete: true },
						{ id: 'i2', name: 'Step 2', complete: true },
					],
				},
			]),
		};
		mockGetPMProviderOrNull.mockReturnValue(provider as never);

		const result = await prepopulateTodosStep(makeParams({ workItemId: 'card-1' }));
		expect(result).toEqual([]);
	});
});
