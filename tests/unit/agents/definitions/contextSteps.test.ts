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

import {
	fetchEmailsFromInputStep,
	prepopulateTodosStep,
} from '../../../../src/agents/definitions/contextSteps.js';
import type { FetchContextParams } from '../../../../src/agents/definitions/contextSteps.js';
import type { EmailSummary } from '../../../../src/email/types.js';
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

describe('fetchEmailsFromInputStep', () => {
	it('returns empty array when preFoundEmails is undefined', () => {
		const result = fetchEmailsFromInputStep(makeParams({}));
		expect(result).toEqual([]);
	});

	it('returns empty array when preFoundEmails is an empty array', () => {
		const result = fetchEmailsFromInputStep(makeParams({ preFoundEmails: [] }));
		expect(result).toEqual([]);
	});

	it('injects a single email with correct toolName, params, result, and description', () => {
		const email: EmailSummary = {
			uid: 42,
			date: new Date('2024-01-15T10:30:00Z'),
			from: 'sender@x.com',
			to: ['me@example.com'],
			subject: 'Subject',
			snippet: 'Snippet text',
		};

		const result = fetchEmailsFromInputStep(makeParams({ preFoundEmails: [email] }));

		expect(result).toHaveLength(1);
		const injection = result[0];

		expect(injection.toolName).toBe('SearchEmails');
		expect(injection.params).toEqual({
			comment: 'Pre-fetched unread emails before agent start',
			folder: 'INBOX',
			criteria: { unseen: true },
			maxResults: 10,
		});
		expect(injection.result).toBe(
			'Found 1 email(s):\n\n1. [UID:42] 2024-01-15 - "Subject" from sender@x.com',
		);
		expect(injection.description).toBe('Pre-fetched 1 unread email(s)');
	});

	it('includes criteria.from when senderEmail is set', () => {
		const email: EmailSummary = {
			uid: 7,
			date: new Date('2024-06-01T00:00:00Z'),
			from: 'boss@company.com',
			to: ['me@example.com'],
			subject: 'Hi',
			snippet: '',
		};

		const result = fetchEmailsFromInputStep(
			makeParams({ preFoundEmails: [email], senderEmail: 'boss@company.com' }),
		);

		expect(result[0].params).toEqual(
			expect.objectContaining({ criteria: { unseen: true, from: 'boss@company.com' } }),
		);
	});

	it('formats multiple emails as a numbered list with correct count in description', () => {
		const emails: EmailSummary[] = [
			{
				uid: 1,
				date: new Date('2024-03-10T00:00:00Z'),
				from: 'a@example.com',
				to: [],
				subject: 'First',
				snippet: '',
			},
			{
				uid: 2,
				date: new Date('2024-03-11T00:00:00Z'),
				from: 'b@example.com',
				to: [],
				subject: 'Second',
				snippet: '',
			},
		];

		const result = fetchEmailsFromInputStep(makeParams({ preFoundEmails: emails }));

		expect(result).toHaveLength(1);
		expect(result[0].description).toBe('Pre-fetched 2 unread email(s)');
		expect(result[0].result).toBe(
			'Found 2 email(s):\n\n' +
				'1. [UID:1] 2024-03-10 - "First" from a@example.com\n' +
				'2. [UID:2] 2024-03-11 - "Second" from b@example.com',
		);
	});

	it('extracts the date using UTC ISO split (ignores time component)', () => {
		const email: EmailSummary = {
			uid: 99,
			date: new Date('2024-12-31T23:59:59Z'),
			from: 'test@example.com',
			to: [],
			subject: 'NYE',
			snippet: '',
		};

		const result = fetchEmailsFromInputStep(makeParams({ preFoundEmails: [email] }));

		expect(result[0].result).toContain('2024-12-31');
	});
});

describe('prepopulateTodosStep', () => {
	it('returns empty array when no cardId', async () => {
		const result = await prepopulateTodosStep(makeParams({}));
		expect(result).toEqual([]);
	});

	it('returns empty array when no PM provider', async () => {
		mockGetPMProviderOrNull.mockReturnValue(null);
		const result = await prepopulateTodosStep(makeParams({ cardId: 'card-1' }));
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

		const result = await prepopulateTodosStep(makeParams({ cardId: 'card-1' }));
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

		const result = await prepopulateTodosStep(makeParams({ cardId: 'card-1' }));

		expect(result).toHaveLength(1);
		expect(result[0].toolName).toBe('TodoUpsert');
		expect(result[0].description).toBe('Pre-populated 2 todos from Implementation Steps');
		expect(mockInitTodoSession).toHaveBeenCalledWith('card-1');
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

		const result = await prepopulateTodosStep(makeParams({ cardId: 'card-1' }));
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

		const result = await prepopulateTodosStep(makeParams({ cardId: 'card-1' }));

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

		const params = makeParams({ cardId: 'card-1' });
		const result = await prepopulateTodosStep(params);
		expect(result).toEqual([]);
		expect(params.logWriter).toHaveBeenCalledWith('WARN', 'prepopulateTodosStep failed', {
			cardId: 'card-1',
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

		const result = await prepopulateTodosStep(makeParams({ cardId: 'card-1' }));
		expect(result).toEqual([]);
	});
});
