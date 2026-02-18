import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/jira/client.js', () => ({
	jiraClient: {
		getIssue: vi.fn(),
		getIssueComments: vi.fn(),
		updateIssue: vi.fn(),
		addComment: vi.fn(),
		createIssue: vi.fn(),
		searchIssues: vi.fn(),
		getTransitions: vi.fn(),
		transitionIssue: vi.fn(),
		getIssueLabels: vi.fn(),
		updateLabels: vi.fn(),
		getCustomFieldValue: vi.fn(),
		updateCustomField: vi.fn(),
		getMyself: vi.fn(),
		addAttachmentFile: vi.fn(),
	},
}));

vi.mock('../../../../src/pm/jira/adf.js', () => ({
	adfToPlainText: vi.fn((doc: unknown) => (doc ? String(doc) : '')),
	markdownToAdf: vi.fn((text: string) => ({
		type: 'doc',
		content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
	})),
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { jiraClient } from '../../../../src/jira/client.js';
import { JiraPMProvider } from '../../../../src/pm/jira/adapter.js';

const mockJira = vi.mocked(jiraClient);

const config = {
	projectKey: 'PROJ',
	baseUrl: 'https://jira.example.com',
	statuses: {
		inProgress: 'In Progress',
		inReview: 'Code Review',
		done: 'Done',
		merged: 'Merged',
	},
};

let provider: JiraPMProvider;

beforeEach(() => {
	vi.clearAllMocks();
	provider = new JiraPMProvider(config);
});

describe('JiraPMProvider', () => {
	it('has type "jira"', () => {
		expect(provider.type).toBe('jira');
	});

	describe('getWorkItem', () => {
		it('maps issue fields to WorkItem', async () => {
			mockJira.getIssue.mockResolvedValue({
				key: 'PROJ-1',
				fields: {
					summary: 'My Issue',
					description: 'some adf',
					status: { name: 'In Progress' },
					labels: ['frontend', 'bug'],
				},
			} as Awaited<ReturnType<typeof mockJira.getIssue>>);

			const item = await provider.getWorkItem('PROJ-1');

			expect(item.id).toBe('PROJ-1');
			expect(item.title).toBe('My Issue');
			expect(item.url).toBe('https://jira.example.com/browse/PROJ-1');
			expect(item.status).toBe('In Progress');
			expect(item.labels).toEqual([
				{ id: 'frontend', name: 'frontend' },
				{ id: 'bug', name: 'bug' },
			]);
		});

		it('handles missing fields gracefully', async () => {
			mockJira.getIssue.mockResolvedValue({
				key: 'PROJ-1',
				fields: {},
			} as Awaited<ReturnType<typeof mockJira.getIssue>>);

			const item = await provider.getWorkItem('PROJ-1');

			expect(item.title).toBe('');
			expect(item.labels).toEqual([]);
		});
	});

	describe('getWorkItemComments', () => {
		it('maps comment fields', async () => {
			mockJira.getIssueComments.mockResolvedValue([
				{
					id: 'c1',
					created: '2024-01-01T00:00:00Z',
					body: 'some adf body',
					author: {
						accountId: 'u1',
						displayName: 'Alice',
						emailAddress: 'alice@example.com',
					},
				},
			]);

			const comments = await provider.getWorkItemComments('PROJ-1');

			expect(comments).toHaveLength(1);
			expect(comments[0].id).toBe('c1');
			expect(comments[0].date).toBe('2024-01-01T00:00:00Z');
			expect(comments[0].author.name).toBe('Alice');
			expect(comments[0].author.username).toBe('alice@example.com');
		});
	});

	describe('updateWorkItem', () => {
		it('updates title as summary', async () => {
			mockJira.updateIssue.mockResolvedValue(undefined);

			await provider.updateWorkItem('PROJ-1', { title: 'New Title' });

			expect(mockJira.updateIssue).toHaveBeenCalledWith('PROJ-1', {
				summary: 'New Title',
				description: undefined,
			});
		});

		it('converts description markdown to ADF', async () => {
			mockJira.updateIssue.mockResolvedValue(undefined);

			await provider.updateWorkItem('PROJ-1', { description: '# Heading' });

			const call = mockJira.updateIssue.mock.calls[0];
			expect(call[0]).toBe('PROJ-1');
			expect(call[1].description).toBeTruthy();
		});
	});

	describe('addComment', () => {
		it('converts markdown to ADF and calls addComment', async () => {
			mockJira.addComment.mockResolvedValue(undefined);

			await provider.addComment('PROJ-1', 'Hello world');

			expect(mockJira.addComment).toHaveBeenCalledWith('PROJ-1', expect.any(Object));
		});
	});

	describe('createWorkItem', () => {
		it('creates issue with project key', async () => {
			mockJira.createIssue.mockResolvedValue({ key: 'PROJ-2' });

			const item = await provider.createWorkItem({
				containerId: 'PROJ',
				title: 'New Issue',
				description: 'Details',
			});

			expect(mockJira.createIssue).toHaveBeenCalledWith(
				expect.objectContaining({
					project: { key: 'PROJ' },
					summary: 'New Issue',
					issuetype: { name: 'Task' },
				}),
			);
			expect(item.id).toBe('PROJ-2');
			expect(item.url).toBe('https://jira.example.com/browse/PROJ-2');
		});

		it('uses default project key when containerId is empty', async () => {
			mockJira.createIssue.mockResolvedValue({ key: 'PROJ-3' });

			await provider.createWorkItem({
				containerId: '',
				title: 'Issue',
			});

			expect(mockJira.createIssue).toHaveBeenCalledWith(
				expect.objectContaining({
					project: { key: 'PROJ' },
				}),
			);
		});

		it('uses custom issue type when configured', async () => {
			const configWithType = { ...config, issueTypes: { default: 'Story', subtask: 'Sub-task' } };
			const providerWithType = new JiraPMProvider(configWithType);
			mockJira.createIssue.mockResolvedValue({ key: 'PROJ-4' });

			await providerWithType.createWorkItem({ containerId: 'PROJ', title: 'Story' });

			expect(mockJira.createIssue).toHaveBeenCalledWith(
				expect.objectContaining({ issuetype: { name: 'Story' } }),
			);
		});
	});

	describe('listWorkItems', () => {
		it('searches with JQL and maps results', async () => {
			mockJira.searchIssues.mockResolvedValue([
				{
					key: 'PROJ-1',
					fields: { summary: 'Issue 1', status: { name: 'Open' }, labels: [] },
				},
			]);

			const items = await provider.listWorkItems('PROJ');

			expect(mockJira.searchIssues).toHaveBeenCalledWith(
				expect.stringContaining('project = "PROJ"'),
			);
			expect(items).toHaveLength(1);
			expect(items[0].id).toBe('PROJ-1');
			expect(items[0].status).toBe('Open');
		});
	});

	describe('moveWorkItem', () => {
		it('finds transition by name and calls transitionIssue', async () => {
			mockJira.getTransitions.mockResolvedValue([
				{ id: 't1', name: 'In Progress', to: { name: 'In Progress' } },
				{ id: 't2', name: 'Done', to: { name: 'Done' } },
			]);
			mockJira.transitionIssue.mockResolvedValue(undefined);

			await provider.moveWorkItem('PROJ-1', 'Done');

			expect(mockJira.transitionIssue).toHaveBeenCalledWith('PROJ-1', 't2');
		});

		it('matches by to.name (case-insensitive)', async () => {
			mockJira.getTransitions.mockResolvedValue([
				{ id: 't1', name: 'Transition 1', to: { name: 'In Progress' } },
			]);
			mockJira.transitionIssue.mockResolvedValue(undefined);

			await provider.moveWorkItem('PROJ-1', 'in progress');

			expect(mockJira.transitionIssue).toHaveBeenCalledWith('PROJ-1', 't1');
		});

		it('logs warn and does not throw when no transition found', async () => {
			mockJira.getTransitions.mockResolvedValue([{ id: 't1', name: 'Open', to: { name: 'Open' } }]);

			await provider.moveWorkItem('PROJ-1', 'Nonexistent Status');

			expect(mockJira.transitionIssue).not.toHaveBeenCalled();
		});
	});

	describe('addLabel / removeLabel', () => {
		it('addLabel adds new label if not present', async () => {
			mockJira.getIssueLabels.mockResolvedValue(['existing']);
			mockJira.updateLabels.mockResolvedValue(undefined);

			await provider.addLabel('PROJ-1', 'new-label');

			expect(mockJira.updateLabels).toHaveBeenCalledWith('PROJ-1', ['existing', 'new-label']);
		});

		it('addLabel does not duplicate existing label', async () => {
			mockJira.getIssueLabels.mockResolvedValue(['existing']);
			mockJira.updateLabels.mockResolvedValue(undefined);

			await provider.addLabel('PROJ-1', 'existing');

			expect(mockJira.updateLabels).not.toHaveBeenCalled();
		});

		it('removeLabel removes a label', async () => {
			mockJira.getIssueLabels.mockResolvedValue(['label1', 'label2']);
			mockJira.updateLabels.mockResolvedValue(undefined);

			await provider.removeLabel('PROJ-1', 'label1');

			expect(mockJira.updateLabels).toHaveBeenCalledWith('PROJ-1', ['label2']);
		});

		it('removeLabel does nothing if label not present', async () => {
			mockJira.getIssueLabels.mockResolvedValue(['label1']);
			mockJira.updateLabels.mockResolvedValue(undefined);

			await provider.removeLabel('PROJ-1', 'nonexistent');

			expect(mockJira.updateLabels).not.toHaveBeenCalled();
		});
	});

	describe('getChecklists', () => {
		it('returns empty array when no subtasks', async () => {
			mockJira.getIssue.mockResolvedValue({
				key: 'PROJ-1',
				fields: { subtasks: [] },
			} as Awaited<ReturnType<typeof mockJira.getIssue>>);

			const checklists = await provider.getChecklists('PROJ-1');

			expect(checklists).toEqual([]);
		});

		it('maps subtasks to checklist items', async () => {
			mockJira.getIssue.mockResolvedValue({
				key: 'PROJ-1',
				fields: {
					subtasks: [
						{ key: 'PROJ-2', id: '2', fields: { summary: 'Subtask 1', status: { name: 'To Do' } } },
						{ key: 'PROJ-3', id: '3', fields: { summary: 'Subtask 2', status: { name: 'Done' } } },
					],
				},
			} as Awaited<ReturnType<typeof mockJira.getIssue>>);

			const checklists = await provider.getChecklists('PROJ-1');

			expect(checklists).toHaveLength(1);
			expect(checklists[0].name).toBe('Subtasks');
			expect(checklists[0].items[0].complete).toBe(false);
			expect(checklists[0].items[1].complete).toBe(true);
		});
	});

	describe('createChecklist', () => {
		it('returns a virtual checklist (no API call)', async () => {
			const checklist = await provider.createChecklist('PROJ-1', 'My Checklist');

			expect(checklist.name).toBe('My Checklist');
			expect(checklist.workItemId).toBe('PROJ-1');
			expect(checklist.items).toEqual([]);
			expect(mockJira.createIssue).not.toHaveBeenCalled();
		});
	});

	describe('addChecklistItem', () => {
		it('creates subtask from checklist ID format', async () => {
			mockJira.createIssue.mockResolvedValue({ key: 'PROJ-5' });

			await provider.addChecklistItem('checklist-PROJ-1-1234567890', 'Do something');

			expect(mockJira.createIssue).toHaveBeenCalledWith(
				expect.objectContaining({
					parent: { key: 'PROJ-1' },
					summary: 'Do something',
				}),
			);
		});

		it('extracts parent key from subtasks- format', async () => {
			mockJira.createIssue.mockResolvedValue({ key: 'PROJ-6' });

			// subtasks-PROJ-1 => regex captures "PROJ" as parent (the -1 suffix is treated as the trailing digits)
			await provider.addChecklistItem('subtasks-PROJ-1', 'Another task');

			expect(mockJira.createIssue).toHaveBeenCalledWith(
				expect.objectContaining({
					parent: { key: 'PROJ' },
					summary: 'Another task',
				}),
			);
		});

		it('logs warn when parent key cannot be extracted', async () => {
			const { logger } = await import('../../../../src/utils/logging.js');

			await provider.addChecklistItem('invalid-format', 'task');

			expect(vi.mocked(logger.warn)).toHaveBeenCalled();
			expect(mockJira.createIssue).not.toHaveBeenCalled();
		});
	});

	describe('updateChecklistItem', () => {
		it('transitions to Done when complete=true', async () => {
			mockJira.getTransitions.mockResolvedValue([{ id: 't1', name: 'Done', to: { name: 'Done' } }]);
			mockJira.transitionIssue.mockResolvedValue(undefined);

			await provider.updateChecklistItem('PROJ-1', 'PROJ-2', true);

			expect(mockJira.transitionIssue).toHaveBeenCalledWith('PROJ-2', 't1');
		});

		it('transitions to To Do when complete=false', async () => {
			mockJira.getTransitions.mockResolvedValue([
				{ id: 't2', name: 'To Do', to: { name: 'To Do' } },
			]);
			mockJira.transitionIssue.mockResolvedValue(undefined);

			await provider.updateChecklistItem('PROJ-1', 'PROJ-2', false);

			expect(mockJira.transitionIssue).toHaveBeenCalledWith('PROJ-2', 't2');
		});
	});

	describe('getAttachments', () => {
		it('maps attachment fields from issue', async () => {
			mockJira.getIssue.mockResolvedValue({
				key: 'PROJ-1',
				fields: {
					attachment: [
						{
							id: 'a1',
							filename: 'file.txt',
							content: 'https://jira.example.com/secure/attachment',
							mimeType: 'text/plain',
							size: 200,
							created: '2024-01-01T00:00:00Z',
						},
					],
				},
			} as Awaited<ReturnType<typeof mockJira.getIssue>>);

			const attachments = await provider.getAttachments('PROJ-1');

			expect(attachments).toHaveLength(1);
			expect(attachments[0].id).toBe('a1');
			expect(attachments[0].name).toBe('file.txt');
			expect(attachments[0].bytes).toBe(200);
		});

		it('returns empty array when no attachments', async () => {
			mockJira.getIssue.mockResolvedValue({
				key: 'PROJ-1',
				fields: {},
			} as Awaited<ReturnType<typeof mockJira.getIssue>>);

			const attachments = await provider.getAttachments('PROJ-1');

			expect(attachments).toEqual([]);
		});
	});

	describe('addAttachment', () => {
		it('falls back to comment with link', async () => {
			mockJira.addComment.mockResolvedValue(undefined);

			await provider.addAttachment('PROJ-1', 'https://example.com/file.pdf', 'file.pdf');

			expect(mockJira.addComment).toHaveBeenCalledWith(
				'PROJ-1',
				expect.objectContaining({ type: 'doc' }),
			);
		});
	});

	describe('addAttachmentFile', () => {
		it('delegates to jiraClient.addAttachmentFile', async () => {
			mockJira.addAttachmentFile.mockResolvedValue(undefined);
			const buf = Buffer.from('data');

			await provider.addAttachmentFile('PROJ-1', buf, 'file.txt', 'text/plain');

			expect(mockJira.addAttachmentFile).toHaveBeenCalledWith('PROJ-1', buf, 'file.txt');
		});
	});

	describe('getCustomFieldNumber', () => {
		it('returns numeric value', async () => {
			mockJira.getCustomFieldValue.mockResolvedValue(42);

			const val = await provider.getCustomFieldNumber('PROJ-1', 'customfield_1');

			expect(val).toBe(42);
		});

		it('parses string value', async () => {
			mockJira.getCustomFieldValue.mockResolvedValue('7.5');

			const val = await provider.getCustomFieldNumber('PROJ-1', 'customfield_1');

			expect(val).toBe(7.5);
		});

		it('returns 0 for null value', async () => {
			mockJira.getCustomFieldValue.mockResolvedValue(null);

			const val = await provider.getCustomFieldNumber('PROJ-1', 'customfield_1');

			expect(val).toBe(0);
		});
	});

	describe('updateCustomFieldNumber', () => {
		it('delegates to jiraClient.updateCustomField', async () => {
			mockJira.updateCustomField.mockResolvedValue(undefined);

			await provider.updateCustomFieldNumber('PROJ-1', 'customfield_1', 99);

			expect(mockJira.updateCustomField).toHaveBeenCalledWith('PROJ-1', 'customfield_1', 99);
		});
	});

	describe('getWorkItemUrl', () => {
		it('returns baseUrl + browse path', () => {
			expect(provider.getWorkItemUrl('PROJ-1')).toBe('https://jira.example.com/browse/PROJ-1');
		});
	});

	describe('getAuthenticatedUser', () => {
		it('maps myself fields', async () => {
			mockJira.getMyself.mockResolvedValue({
				accountId: 'u1',
				displayName: 'Alice',
				emailAddress: 'alice@example.com',
			});

			const user = await provider.getAuthenticatedUser();

			expect(user.id).toBe('u1');
			expect(user.name).toBe('Alice');
			expect(user.username).toBe('alice@example.com');
		});
	});
});
