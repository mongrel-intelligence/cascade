import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mocks before imports
const { mockJiraClient, mockAdfToPlainText, mockMarkdownToAdf } = vi.hoisted(() => ({
	mockJiraClient: {
		getIssue: vi.fn(),
		getIssueComments: vi.fn(),
		updateIssue: vi.fn(),
		addComment: vi.fn(),
		updateComment: vi.fn(),
		createIssue: vi.fn(),
		getIssueTypesForProject: vi.fn(),
		searchIssues: vi.fn(),
		getTransitions: vi.fn(),
		transitionIssue: vi.fn(),
		getIssueLabels: vi.fn(),
		updateLabels: vi.fn(),
		addAttachmentFile: vi.fn(),
		getCustomFieldValue: vi.fn(),
		updateCustomField: vi.fn(),
		getMyself: vi.fn(),
	},
	mockAdfToPlainText: vi.fn(),
	mockMarkdownToAdf: vi.fn(),
}));

vi.mock('../../../../src/jira/client.js', () => ({
	jiraClient: mockJiraClient,
}));

vi.mock('../../../../src/pm/jira/adf.js', () => ({
	adfToPlainText: mockAdfToPlainText,
	markdownToAdf: mockMarkdownToAdf,
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: {
		warn: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
		error: vi.fn(),
	},
}));

import { JiraPMProvider } from '../../../../src/pm/jira/adapter.js';

const mockConfig = {
	projectKey: 'PROJ',
	baseUrl: 'https://mycompany.atlassian.net',
	statuses: {
		briefing: 'Briefing',
		planning: 'Planning',
		todo: 'To Do',
		done: 'Done',
	},
	issueTypes: {
		default: 'Task',
		subtask: 'Sub-task',
	},
};

describe('JiraPMProvider', () => {
	let provider: JiraPMProvider;

	beforeEach(() => {
		vi.resetAllMocks();
		provider = new JiraPMProvider(mockConfig);
		mockAdfToPlainText.mockReturnValue('plain text description');
		mockMarkdownToAdf.mockReturnValue({ type: 'doc', version: 1, content: [] });
	});

	it('has type "jira"', () => {
		expect(provider.type).toBe('jira');
	});

	describe('getWorkItem', () => {
		it('delegates to jiraClient.getIssue and maps fields', async () => {
			mockJiraClient.getIssue.mockResolvedValue({
				key: 'PROJ-123',
				fields: {
					summary: 'Fix the bug',
					description: { type: 'doc' },
					status: { name: 'In Progress' },
					labels: ['backend', 'urgent'],
				},
			});

			const result = await provider.getWorkItem('PROJ-123');

			expect(mockJiraClient.getIssue).toHaveBeenCalledWith('PROJ-123');
			expect(result).toMatchObject({
				id: 'PROJ-123',
				title: 'Fix the bug',
				description: 'plain text description',
				url: 'https://mycompany.atlassian.net/browse/PROJ-123',
				status: 'In Progress',
				labels: [
					{ id: 'backend', name: 'backend' },
					{ id: 'urgent', name: 'urgent' },
				],
			});
		});

		it('falls back to id when key is missing', async () => {
			mockJiraClient.getIssue.mockResolvedValue({
				fields: { summary: 'Test' },
			});

			const result = await provider.getWorkItem('fallback-id');

			expect(result.id).toBe('fallback-id');
		});
	});

	describe('getWorkItemComments', () => {
		it('maps JIRA comments to WorkItemComment format', async () => {
			mockAdfToPlainText.mockReturnValue('Comment text');
			mockJiraClient.getIssueComments.mockResolvedValue([
				{
					id: 'comment-1',
					created: '2024-01-01T00:00:00.000Z',
					body: { type: 'doc' },
					author: {
						accountId: 'user-123',
						displayName: 'Alice',
						emailAddress: 'alice@example.com',
					},
				},
			]);

			const result = await provider.getWorkItemComments('PROJ-123');

			expect(result).toEqual([
				{
					id: 'comment-1',
					date: '2024-01-01T00:00:00.000Z',
					text: 'Comment text',
					author: {
						id: 'user-123',
						name: 'Alice',
						username: 'alice@example.com',
					},
				},
			]);
		});

		it('handles missing comment fields gracefully', async () => {
			mockJiraClient.getIssueComments.mockResolvedValue([{}]);
			mockAdfToPlainText.mockReturnValue('');

			const result = await provider.getWorkItemComments('PROJ-123');

			expect(result).toEqual([
				{
					id: '',
					date: '',
					text: '',
					author: { id: '', name: '', username: '' },
				},
			]);
		});
	});

	describe('updateWorkItem', () => {
		it('converts description markdown to ADF before updating', async () => {
			mockJiraClient.updateIssue.mockResolvedValue(undefined);
			const adfDoc = { type: 'doc', version: 1, content: [] };
			mockMarkdownToAdf.mockReturnValue(adfDoc);

			await provider.updateWorkItem('PROJ-123', {
				title: 'Updated title',
				description: 'New **markdown** desc',
			});

			expect(mockMarkdownToAdf).toHaveBeenCalledWith('New **markdown** desc');
			expect(mockJiraClient.updateIssue).toHaveBeenCalledWith('PROJ-123', {
				summary: 'Updated title',
				description: adfDoc,
			});
		});

		it('passes undefined description when not provided', async () => {
			mockJiraClient.updateIssue.mockResolvedValue(undefined);

			await provider.updateWorkItem('PROJ-123', { title: 'Title only' });

			expect(mockJiraClient.updateIssue).toHaveBeenCalledWith('PROJ-123', {
				summary: 'Title only',
				description: undefined,
			});
		});
	});

	describe('addComment', () => {
		it('converts markdown to ADF and calls jiraClient.addComment, returning the comment ID', async () => {
			const adfDoc = { type: 'doc', version: 1, content: [] };
			mockMarkdownToAdf.mockReturnValue(adfDoc);
			mockJiraClient.addComment.mockResolvedValue('comment-456');

			const id = await provider.addComment('PROJ-123', 'Hello **world**');

			expect(mockMarkdownToAdf).toHaveBeenCalledWith('Hello **world**');
			expect(mockJiraClient.addComment).toHaveBeenCalledWith('PROJ-123', adfDoc);
			expect(id).toBe('comment-456');
		});
	});

	describe('updateComment', () => {
		it('converts markdown to ADF and calls jiraClient.updateComment', async () => {
			const adfDoc = { type: 'doc', version: 1, content: [] };
			mockMarkdownToAdf.mockReturnValue(adfDoc);
			mockJiraClient.updateComment.mockResolvedValue(undefined);

			await provider.updateComment('PROJ-123', 'comment-456', 'Updated **text**');

			expect(mockMarkdownToAdf).toHaveBeenCalledWith('Updated **text**');
			expect(mockJiraClient.updateComment).toHaveBeenCalledWith('PROJ-123', 'comment-456', adfDoc);
		});
	});

	describe('createWorkItem', () => {
		it('creates JIRA issue with correct fields', async () => {
			mockJiraClient.createIssue.mockResolvedValue({ key: 'PROJ-456' });
			const adfDoc = { type: 'doc', version: 1, content: [] };
			mockMarkdownToAdf.mockReturnValue(adfDoc);

			const result = await provider.createWorkItem({
				containerId: 'PROJ',
				title: 'New Task',
				description: 'Task description',
				labels: ['backend'],
			});

			expect(mockJiraClient.createIssue).toHaveBeenCalledWith(
				expect.objectContaining({
					project: { key: 'PROJ' },
					summary: 'New Task',
					issuetype: { name: 'Task' },
					labels: ['backend'],
				}),
			);
			expect(result.id).toBe('PROJ-456');
			expect(result.url).toBe('https://mycompany.atlassian.net/browse/PROJ-456');
		});

		it('omits labels when not provided', async () => {
			mockJiraClient.createIssue.mockResolvedValue({ key: 'PROJ-789' });

			await provider.createWorkItem({
				containerId: 'PROJ',
				title: 'Task without labels',
			});

			expect(mockJiraClient.createIssue).toHaveBeenCalledWith(
				expect.not.objectContaining({ labels: expect.anything() }),
			);
		});
	});

	describe('listWorkItems', () => {
		it('searches by project key and maps results', async () => {
			mockJiraClient.searchIssues.mockResolvedValue([
				{
					key: 'PROJ-1',
					fields: {
						summary: 'Issue 1',
						status: { name: 'To Do' },
						labels: [],
					},
				},
			]);

			const result = await provider.listWorkItems('PROJ');

			expect(mockJiraClient.searchIssues).toHaveBeenCalledWith(
				'project = "PROJ" ORDER BY created DESC',
			);
			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({
				id: 'PROJ-1',
				title: 'Issue 1',
				status: 'To Do',
			});
		});
	});

	describe('moveWorkItem', () => {
		it('finds transition by name and transitions the issue', async () => {
			mockJiraClient.getTransitions.mockResolvedValue([
				{ id: 't-1', name: 'Start Progress', to: { name: 'In Progress' } },
				{ id: 't-2', name: 'Done', to: { name: 'Done' } },
			]);
			mockJiraClient.transitionIssue.mockResolvedValue(undefined);

			await provider.moveWorkItem('PROJ-1', 'Done');

			expect(mockJiraClient.transitionIssue).toHaveBeenCalledWith('PROJ-1', 't-2');
		});

		it('matches by destination name (case insensitive)', async () => {
			mockJiraClient.getTransitions.mockResolvedValue([
				{ id: 't-3', name: 'Move to Review', to: { name: 'Code Review' } },
			]);
			mockJiraClient.transitionIssue.mockResolvedValue(undefined);

			await provider.moveWorkItem('PROJ-1', 'code review');

			expect(mockJiraClient.transitionIssue).toHaveBeenCalledWith('PROJ-1', 't-3');
		});

		it('returns without throwing when no matching transition found', async () => {
			mockJiraClient.getTransitions.mockResolvedValue([
				{ id: 't-1', name: 'Done', to: { name: 'Done' } },
			]);

			await expect(provider.moveWorkItem('PROJ-1', 'unknown-status')).resolves.toBeUndefined();
		});
	});

	describe('addLabel', () => {
		it('adds label when not already present', async () => {
			mockJiraClient.getIssueLabels.mockResolvedValue(['existing-label']);
			mockJiraClient.updateLabels.mockResolvedValue(undefined);

			await provider.addLabel('PROJ-1', 'new-label');

			expect(mockJiraClient.updateLabels).toHaveBeenCalledWith('PROJ-1', [
				'existing-label',
				'new-label',
			]);
		});

		it('does not update when label already present', async () => {
			mockJiraClient.getIssueLabels.mockResolvedValue(['existing-label']);

			await provider.addLabel('PROJ-1', 'existing-label');

			expect(mockJiraClient.updateLabels).not.toHaveBeenCalled();
		});
	});

	describe('removeLabel', () => {
		it('removes label from the list', async () => {
			mockJiraClient.getIssueLabels.mockResolvedValue(['label-a', 'label-b', 'label-c']);
			mockJiraClient.updateLabels.mockResolvedValue(undefined);

			await provider.removeLabel('PROJ-1', 'label-b');

			expect(mockJiraClient.updateLabels).toHaveBeenCalledWith('PROJ-1', ['label-a', 'label-c']);
		});

		it('does not update when label not present', async () => {
			mockJiraClient.getIssueLabels.mockResolvedValue(['label-a']);

			await provider.removeLabel('PROJ-1', 'non-existent');

			expect(mockJiraClient.updateLabels).not.toHaveBeenCalled();
		});
	});

	describe('getChecklists', () => {
		it('maps subtasks to checklist items', async () => {
			mockJiraClient.getIssue.mockResolvedValue({
				fields: {
					subtasks: [
						{ key: 'PROJ-2', id: '2', fields: { summary: 'Subtask 1', status: { name: 'Done' } } },
						{
							key: 'PROJ-3',
							id: '3',
							fields: { summary: 'Subtask 2', status: { name: 'To Do' } },
						},
					],
				},
			});

			const result = await provider.getChecklists('PROJ-1');

			expect(result).toEqual([
				{
					id: 'subtasks-PROJ-1',
					name: 'Subtasks',
					workItemId: 'PROJ-1',
					items: [
						{ id: 'PROJ-2', name: 'Subtask 1', complete: true },
						{ id: 'PROJ-3', name: 'Subtask 2', complete: false },
					],
				},
			]);
		});

		it('returns empty array when no subtasks', async () => {
			mockJiraClient.getIssue.mockResolvedValue({
				fields: { subtasks: [] },
			});

			const result = await provider.getChecklists('PROJ-1');

			expect(result).toEqual([]);
		});
	});

	describe('createChecklist', () => {
		it('returns checklist object without calling JIRA API', async () => {
			const result = await provider.createChecklist('PROJ-1', 'My Checklist');

			expect(result.name).toBe('My Checklist');
			expect(result.workItemId).toBe('PROJ-1');
			expect(result.items).toEqual([]);
			expect(mockJiraClient.createIssue).not.toHaveBeenCalled();
		});
	});

	describe('addChecklistItem', () => {
		it('creates a subtask from checklist-format checklistId', async () => {
			mockJiraClient.createIssue.mockResolvedValue({ key: 'PROJ-99' });

			await provider.addChecklistItem('checklist-PROJ-1-1234567890', 'New subtask item');

			expect(mockJiraClient.createIssue).toHaveBeenCalledWith(
				expect.objectContaining({
					project: { key: 'PROJ' },
					parent: { key: 'PROJ-1' },
					summary: 'New subtask item',
					issuetype: { name: 'Sub-task' },
				}),
			);
		});

		it('creates a subtask from subtasks-format checklistId', async () => {
			mockJiraClient.createIssue.mockResolvedValue({ key: 'PROJ-100' });

			await provider.addChecklistItem('subtasks-PROJ-5', 'Another subtask');

			expect(mockJiraClient.createIssue).toHaveBeenCalledWith(
				expect.objectContaining({
					parent: { key: 'PROJ-5' },
					summary: 'Another subtask',
				}),
			);
		});

		it('strips timestamp from checklist-format ID', async () => {
			mockJiraClient.createIssue.mockResolvedValue({ key: 'PROJ-101' });

			await provider.addChecklistItem('checklist-BTS-15-1234567890123', 'Subtask with ts');

			expect(mockJiraClient.createIssue).toHaveBeenCalledWith(
				expect.objectContaining({
					parent: { key: 'BTS-15' },
				}),
			);
		});

		it('throws when parent key cannot be extracted', async () => {
			await expect(provider.addChecklistItem('invalid-format', 'Subtask')).rejects.toThrow(
				'Cannot extract parent issue key from checklist ID: invalid-format',
			);
		});

		it('auto-detects subtask type when not configured', async () => {
			const providerNoConfig = new JiraPMProvider({
				...mockConfig,
				issueTypes: undefined,
			});
			mockJiraClient.getIssueTypesForProject.mockResolvedValue([
				{ name: 'Task', subtask: false },
				{ name: 'Subtask', subtask: true },
			]);
			mockJiraClient.createIssue.mockResolvedValue({ key: 'PROJ-102' });

			await providerNoConfig.addChecklistItem('subtasks-PROJ-10', 'Auto-detected subtask');

			expect(mockJiraClient.getIssueTypesForProject).toHaveBeenCalled();
			expect(mockJiraClient.createIssue).toHaveBeenCalledWith(
				expect.objectContaining({
					issuetype: { name: 'Subtask' },
				}),
			);
		});

		it('caches resolved subtask type across calls', async () => {
			const providerNoConfig = new JiraPMProvider({
				...mockConfig,
				issueTypes: undefined,
			});
			mockJiraClient.getIssueTypesForProject.mockResolvedValue([
				{ name: 'Sub-task', subtask: true },
			]);
			mockJiraClient.createIssue.mockResolvedValue({ key: 'PROJ-103' });

			await providerNoConfig.addChecklistItem('subtasks-PROJ-10', 'First');
			await providerNoConfig.addChecklistItem('subtasks-PROJ-10', 'Second');

			// getIssueTypes should only be called once
			expect(mockJiraClient.getIssueTypesForProject).toHaveBeenCalledOnce();
		});

		it('passes description as ADF to createIssue when provided', async () => {
			const adfDoc = { type: 'doc', version: 1, content: [{ type: 'paragraph' }] };
			mockMarkdownToAdf.mockReturnValue(adfDoc);
			mockJiraClient.createIssue.mockResolvedValue({ key: 'PROJ-105' });

			await provider.addChecklistItem(
				'checklist-PROJ-1-1234567890',
				'Subtask with description',
				false,
				'**Files:** `src/api.ts`\n- Add POST route',
			);

			expect(mockMarkdownToAdf).toHaveBeenCalledWith('**Files:** `src/api.ts`\n- Add POST route');
			expect(mockJiraClient.createIssue).toHaveBeenCalledWith(
				expect.objectContaining({
					project: { key: 'PROJ' },
					parent: { key: 'PROJ-1' },
					summary: 'Subtask with description',
					issuetype: { name: 'Sub-task' },
					description: adfDoc,
				}),
			);
		});

		it('omits description from createIssue when not provided', async () => {
			mockJiraClient.createIssue.mockResolvedValue({ key: 'PROJ-106' });

			await provider.addChecklistItem('checklist-PROJ-1-1234567890', 'No description subtask');

			expect(mockJiraClient.createIssue).toHaveBeenCalledWith(
				expect.not.objectContaining({ description: expect.anything() }),
			);
		});

		it('falls back to "Subtask" when no subtask type found', async () => {
			const providerNoConfig = new JiraPMProvider({
				...mockConfig,
				issueTypes: undefined,
			});
			mockJiraClient.getIssueTypesForProject.mockResolvedValue([
				{ name: 'Task', subtask: false },
				{ name: 'Bug', subtask: false },
			]);
			mockJiraClient.createIssue.mockResolvedValue({ key: 'PROJ-104' });

			await providerNoConfig.addChecklistItem('subtasks-PROJ-10', 'Fallback subtask');

			expect(mockJiraClient.createIssue).toHaveBeenCalledWith(
				expect.objectContaining({
					issuetype: { name: 'Subtask' },
				}),
			);
		});
	});

	describe('updateChecklistItem', () => {
		it('moves subtask to Done when complete=true', async () => {
			mockJiraClient.getTransitions.mockResolvedValue([
				{ id: 't-done', name: 'Done', to: { name: 'Done' } },
			]);
			mockJiraClient.transitionIssue.mockResolvedValue(undefined);

			await provider.updateChecklistItem('PROJ-1', 'PROJ-2', true);

			expect(mockJiraClient.transitionIssue).toHaveBeenCalledWith('PROJ-2', 't-done');
		});
	});

	describe('getAttachments', () => {
		it('maps JIRA attachment fields to Attachment type', async () => {
			mockJiraClient.getIssue.mockResolvedValue({
				fields: {
					attachment: [
						{
							id: 'att-1',
							filename: 'screenshot.png',
							content: 'https://jira.example.com/attachment/content/att-1',
							mimeType: 'image/png',
							size: 2048,
							created: '2024-01-01T00:00:00.000Z',
						},
					],
				},
			});

			const result = await provider.getAttachments('PROJ-1');

			expect(result).toEqual([
				{
					id: 'att-1',
					name: 'screenshot.png',
					url: 'https://jira.example.com/attachment/content/att-1',
					mimeType: 'image/png',
					bytes: 2048,
					date: '2024-01-01T00:00:00.000Z',
				},
			]);
		});
	});

	describe('addAttachment', () => {
		it('adds URL attachment as a comment (JIRA cannot link attachments)', async () => {
			mockJiraClient.addComment.mockResolvedValue({ id: 'comment-123' });
			const adfDoc = { type: 'doc', version: 1, content: [] };
			mockMarkdownToAdf.mockReturnValue(adfDoc);

			await provider.addAttachment('PROJ-1', 'https://example.com/file.pdf', 'file.pdf');

			expect(mockJiraClient.addComment).toHaveBeenCalledWith('PROJ-1', adfDoc);
		});
	});

	describe('addAttachmentFile', () => {
		it('delegates to jiraClient.addAttachmentFile', async () => {
			mockJiraClient.addAttachmentFile.mockResolvedValue(undefined);
			const buffer = Buffer.from('binary data');

			await provider.addAttachmentFile('PROJ-1', buffer, 'file.zip', 'application/zip');

			expect(mockJiraClient.addAttachmentFile).toHaveBeenCalledWith('PROJ-1', buffer, 'file.zip');
		});
	});

	describe('getCustomFieldNumber', () => {
		it('returns numeric custom field value', async () => {
			mockJiraClient.getCustomFieldValue.mockResolvedValue(99);

			const result = await provider.getCustomFieldNumber('PROJ-1', 'field-123');

			expect(result).toBe(99);
		});

		it('parses string value as float', async () => {
			mockJiraClient.getCustomFieldValue.mockResolvedValue('12.5');

			const result = await provider.getCustomFieldNumber('PROJ-1', 'field-123');

			expect(result).toBe(12.5);
		});
	});

	describe('updateCustomFieldNumber', () => {
		it('delegates to jiraClient.updateCustomField', async () => {
			mockJiraClient.updateCustomField.mockResolvedValue(undefined);

			await provider.updateCustomFieldNumber('PROJ-1', 'field-123', 42);

			expect(mockJiraClient.updateCustomField).toHaveBeenCalledWith('PROJ-1', 'field-123', 42);
		});
	});

	describe('getWorkItemUrl', () => {
		it('builds JIRA browse URL', () => {
			const url = provider.getWorkItemUrl('PROJ-42');
			expect(url).toBe('https://mycompany.atlassian.net/browse/PROJ-42');
		});
	});

	describe('getAuthenticatedUser', () => {
		it('maps JIRA user fields to standard format', async () => {
			mockJiraClient.getMyself.mockResolvedValue({
				accountId: 'account-123',
				displayName: 'Bot User',
				emailAddress: 'bot@example.com',
			});

			const result = await provider.getAuthenticatedUser();

			expect(result).toEqual({
				id: 'account-123',
				name: 'Bot User',
				username: 'bot@example.com',
			});
		});
	});
});
