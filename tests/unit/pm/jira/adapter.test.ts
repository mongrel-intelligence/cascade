import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mocks before imports
const {
	mockJiraClient,
	mockAdfToPlainText,
	mockMarkdownToAdf,
	mockExtractAdfMediaNodes,
	mockResolveJiraMediaUrls,
} = vi.hoisted(() => ({
	mockJiraClient: {
		getIssue: vi.fn(),
		getIssueComments: vi.fn(),
		updateIssue: vi.fn(),
		addComment: vi.fn(),
		updateComment: vi.fn(),
		createIssue: vi.fn(),
		deleteIssue: vi.fn(),
		getIssueTypesForProject: vi.fn(),
		searchIssues: vi.fn(),
		getTransitions: vi.fn(),
		transitionIssue: vi.fn(),
		getIssueLabels: vi.fn(),
		updateLabels: vi.fn(),
		addAttachmentFile: vi.fn(),
		addRemoteLink: vi.fn(),
		getCustomFieldValue: vi.fn(),
		updateCustomField: vi.fn(),
		getMyself: vi.fn(),
	},
	mockAdfToPlainText: vi.fn(),
	mockMarkdownToAdf: vi.fn(),
	mockExtractAdfMediaNodes: vi.fn(),
	mockResolveJiraMediaUrls: vi.fn(),
}));

vi.mock('../../../../src/jira/client.js', () => ({
	jiraClient: mockJiraClient,
}));

vi.mock('../../../../src/pm/jira/adf.js', () => ({
	adfToPlainText: mockAdfToPlainText,
	markdownToAdf: mockMarkdownToAdf,
	extractAdfMediaNodes: mockExtractAdfMediaNodes,
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: {
		warn: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock('../../../../src/pm/media.js', () => ({
	resolveJiraMediaUrls: mockResolveJiraMediaUrls,
}));

import { JiraPMProvider } from '../../../../src/pm/jira/adapter.js';

const mockConfig = {
	projectKey: 'PROJ',
	baseUrl: 'https://mycompany.atlassian.net',
	statuses: {
		splitting: 'Briefing',
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
		// Default: no media nodes found (most tests don't need media extraction)
		mockExtractAdfMediaNodes.mockReturnValue([]);
		mockResolveJiraMediaUrls.mockReturnValue([]);
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

		it('does not include inlineMedia when no media nodes found', async () => {
			mockJiraClient.getIssue.mockResolvedValue({
				key: 'PROJ-123',
				fields: {
					summary: 'No media',
					description: { type: 'doc' },
					status: { name: 'To Do' },
					labels: [],
					attachment: [],
				},
			});
			mockExtractAdfMediaNodes.mockReturnValue([]);

			const result = await provider.getWorkItem('PROJ-123');

			expect(result.inlineMedia).toBeUndefined();
		});

		it('populates inlineMedia when media nodes are found', async () => {
			const mediaRef = { mediaId: 'att-id-1', mediaType: 'file', altText: 'screenshot' };
			const resolvedMedia = [
				{
					url: 'https://jira.example.com/attachment/att-id-1',
					mimeType: 'image/png',
					altText: 'screenshot',
					source: 'description' as const,
				},
			];
			mockJiraClient.getIssue.mockResolvedValue({
				key: 'PROJ-200',
				fields: {
					summary: 'Issue with image',
					description: { type: 'doc' },
					status: { name: 'In Progress' },
					labels: [],
					attachment: [
						{
							id: 'att-id-1',
							filename: 'screenshot.png',
							content: 'https://jira.example.com/attachment/att-id-1',
							mimeType: 'image/png',
						},
					],
				},
			});
			mockExtractAdfMediaNodes.mockReturnValue([mediaRef]);
			mockResolveJiraMediaUrls.mockReturnValue(resolvedMedia);

			const result = await provider.getWorkItem('PROJ-200');

			expect(mockExtractAdfMediaNodes).toHaveBeenCalledWith({ type: 'doc' });
			expect(mockResolveJiraMediaUrls).toHaveBeenCalledWith(
				[mediaRef],
				expect.arrayContaining([expect.objectContaining({ id: 'att-id-1' })]),
				'description',
			);
			expect(result.inlineMedia).toEqual(resolvedMedia);
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

		it('does not include inlineMedia on comments (comment media resolution is not supported)', async () => {
			mockJiraClient.getIssueComments.mockResolvedValue([
				{
					id: 'c-1',
					created: '2024-01-01T00:00:00.000Z',
					body: { type: 'doc' },
					author: { accountId: 'u-1', displayName: 'Bob', emailAddress: 'bob@example.com' },
				},
			]);

			const result = await provider.getWorkItemComments('PROJ-123');

			expect(result[0].inlineMedia).toBeUndefined();
			// Comments don't perform media extraction — these should never be called
			expect(mockExtractAdfMediaNodes).not.toHaveBeenCalled();
			expect(mockResolveJiraMediaUrls).not.toHaveBeenCalled();
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

		it('transitions new issue to backlog status when configured', async () => {
			const backlogProvider = new JiraPMProvider({
				...mockConfig,
				statuses: { ...mockConfig.statuses, backlog: 'Backlog' },
			});
			mockJiraClient.createIssue.mockResolvedValue({ key: 'PROJ-100' });
			mockJiraClient.getTransitions.mockResolvedValue([
				{ id: '31', name: 'Backlog', to: { name: 'Backlog' } },
			]);
			mockJiraClient.transitionIssue.mockResolvedValue(undefined);

			await backlogProvider.createWorkItem({
				containerId: 'PROJ',
				title: 'Backlog task',
			});

			expect(mockJiraClient.getTransitions).toHaveBeenCalledWith('PROJ-100');
			expect(mockJiraClient.transitionIssue).toHaveBeenCalledWith('PROJ-100', '31');
		});

		it('does not transition when backlog status is not configured', async () => {
			mockJiraClient.createIssue.mockResolvedValue({ key: 'PROJ-101' });

			await provider.createWorkItem({
				containerId: 'PROJ',
				title: 'Regular task',
			});

			expect(mockJiraClient.getTransitions).not.toHaveBeenCalled();
		});

		it('logs warning and continues when backlog transition fails', async () => {
			const backlogProvider = new JiraPMProvider({
				...mockConfig,
				statuses: { ...mockConfig.statuses, backlog: 'Backlog' },
			});
			mockJiraClient.createIssue.mockResolvedValue({ key: 'PROJ-102' });
			mockJiraClient.getTransitions.mockRejectedValue(new Error('API error'));

			const result = await backlogProvider.createWorkItem({
				containerId: 'PROJ',
				title: 'Task with failing transition',
			});

			expect(result.id).toBe('PROJ-102');
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

		it('applies status filter to JQL when provided', async () => {
			mockJiraClient.searchIssues.mockResolvedValue([
				{
					key: 'PROJ-2',
					fields: {
						summary: 'Backlog Item',
						status: { name: 'Backlog' },
						labels: [],
					},
				},
			]);

			const result = await provider.listWorkItems('PROJ', { status: 'Backlog' });

			expect(mockJiraClient.searchIssues).toHaveBeenCalledWith(
				'project = "PROJ" AND status = "Backlog" ORDER BY created DESC',
			);
			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({
				id: 'PROJ-2',
				title: 'Backlog Item',
				status: 'Backlog',
			});
		});

		describe('self-resolution from config', () => {
			it('uses config.projectKey when containerId is omitted', async () => {
				mockJiraClient.searchIssues.mockResolvedValue([]);
				await provider.listWorkItems(undefined, { status: 'backlog' });
				expect(mockJiraClient.searchIssues).toHaveBeenCalledWith(
					expect.stringContaining(`project = "${mockConfig.projectKey}"`),
				);
			});

			it('maps a CASCADE status key (e.g. "todo") through config.statuses to the native status name', async () => {
				mockJiraClient.searchIssues.mockResolvedValue([]);
				await provider.listWorkItems(undefined, { status: 'todo' });
				const native = mockConfig.statuses.todo;
				expect(mockJiraClient.searchIssues).toHaveBeenCalledWith(
					expect.stringContaining(`status = "${native}"`),
				);
			});

			it('falls through to literal status when config.statuses has no mapping (backwards compat)', async () => {
				mockJiraClient.searchIssues.mockResolvedValue([]);
				await provider.listWorkItems(undefined, { status: 'Custom Status' });
				expect(mockJiraClient.searchIssues).toHaveBeenCalledWith(
					expect.stringContaining(`status = "Custom Status"`),
				);
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

	// =========================================================================
	// Inline checklist methods (spec 008) — ADF round-trip
	// =========================================================================

	describe('getChecklists (inline)', () => {
		it('parses inline checklists from ADF description via markdown round-trip', async () => {
			mockJiraClient.getIssue.mockResolvedValue({
				fields: { description: { type: 'doc', content: [] } },
			});
			mockAdfToPlainText.mockReturnValue('### ✅ AC\n- [ ] First\n- [x] Second');

			const result = await provider.getChecklists('PROJ-1');

			expect(result).toHaveLength(1);
			expect(result[0].name).toBe('✅ AC');
			expect(result[0].workItemId).toBe('PROJ-1');
			expect(result[0].items).toHaveLength(2);
			expect(result[0].items[0]).toMatchObject({ name: 'First', complete: false });
			expect(result[0].items[1]).toMatchObject({ name: 'Second', complete: true });
			expect(result[0].id).toMatch(/^inline-PROJ-1-[0-9a-f]{8}$/);
		});

		it('returns empty array when description has no checklist sections', async () => {
			mockJiraClient.getIssue.mockResolvedValue({
				fields: { description: { type: 'doc', content: [] } },
			});
			mockAdfToPlainText.mockReturnValue('Just text.');

			const result = await provider.getChecklists('PROJ-1');
			expect(result).toEqual([]);
		});

		it('returns empty array when description is missing', async () => {
			mockJiraClient.getIssue.mockResolvedValue({ fields: {} });
			const result = await provider.getChecklists('PROJ-1');
			expect(result).toEqual([]);
		});
	});

	describe('createChecklist (inline)', () => {
		it('appends checklist section to ADF description via round-trip', async () => {
			mockJiraClient.getIssue.mockResolvedValue({
				fields: { description: { type: 'doc', content: [] } },
			});
			mockAdfToPlainText.mockReturnValue('Existing.');
			const adfDoc = { type: 'doc', version: 1, content: [] };
			mockMarkdownToAdf.mockReturnValue(adfDoc);
			mockJiraClient.updateIssue.mockResolvedValue(undefined);

			const result = await provider.createChecklist('PROJ-1', '✅ AC');

			expect(mockMarkdownToAdf).toHaveBeenCalledWith('Existing.\n\n### ✅ AC');
			expect(mockJiraClient.updateIssue).toHaveBeenCalledWith('PROJ-1', { description: adfDoc });
			expect(result.workItemId).toBe('PROJ-1');
			expect(result.id).toMatch(/^inline-PROJ-1-[0-9a-f]{8}$/);
		});

		it('does NOT call createIssue (no subtask creation)', async () => {
			mockJiraClient.getIssue.mockResolvedValue({
				fields: { description: { type: 'doc', content: [] } },
			});
			mockAdfToPlainText.mockReturnValue('');
			mockJiraClient.updateIssue.mockResolvedValue(undefined);

			await provider.createChecklist('PROJ-1', 'AC');

			expect(mockJiraClient.createIssue).not.toHaveBeenCalled();
		});
	});

	describe('addChecklistItem (inline)', () => {
		it('appends a markdown checkbox via ADF round-trip', async () => {
			mockJiraClient.getIssue.mockResolvedValue({
				fields: { description: { type: 'doc', content: [] } },
			});
			mockAdfToPlainText.mockReturnValue('### ✅ AC\n- [ ] Existing');
			mockMarkdownToAdf.mockReturnValue({ type: 'doc', version: 1, content: [] });
			mockJiraClient.updateIssue.mockResolvedValue(undefined);

			const checklist = await provider.createChecklist('PROJ-1', '✅ AC');
			await provider.addChecklistItem(checklist.id, 'New item');

			const lastCall = mockMarkdownToAdf.mock.calls[mockMarkdownToAdf.mock.calls.length - 1];
			expect(lastCall[0]).toContain('- [ ] New item');
		});

		it('does NOT call createIssue (no subtask creation)', async () => {
			mockJiraClient.getIssue.mockResolvedValue({
				fields: { description: { type: 'doc', content: [] } },
			});
			mockAdfToPlainText.mockReturnValue('### ✅ AC');
			mockMarkdownToAdf.mockReturnValue({ type: 'doc', version: 1, content: [] });
			mockJiraClient.updateIssue.mockResolvedValue(undefined);

			const checklist = await provider.createChecklist('PROJ-1', '✅ AC');
			await provider.addChecklistItem(checklist.id, 'Item');

			expect(mockJiraClient.createIssue).not.toHaveBeenCalled();
		});

		it('throws when checklistId has wrong format', async () => {
			await expect(provider.addChecklistItem('invalid-format', 'Item')).rejects.toThrow(
				'Invalid JIRA checklist ID',
			);
		});
	});

	describe('updateChecklistItem (inline)', () => {
		it('toggles a checkbox in the ADF description', async () => {
			const desc = '### ✅ AC\n- [ ] Item A';
			mockJiraClient.getIssue.mockResolvedValue({
				fields: { description: { type: 'doc', content: [] } },
			});
			mockAdfToPlainText.mockReturnValue(desc);
			mockMarkdownToAdf.mockReturnValue({ type: 'doc', version: 1, content: [] });
			mockJiraClient.updateIssue.mockResolvedValue(undefined);

			const checklists = await provider.getChecklists('PROJ-1');
			const itemId = checklists[0].items[0].id;
			await provider.updateChecklistItem('PROJ-1', itemId, true);

			const lastCall = mockMarkdownToAdf.mock.calls[mockMarkdownToAdf.mock.calls.length - 1];
			expect(lastCall[0]).toContain('- [x] Item A');
		});

		it('does NOT call transitionIssue', async () => {
			const desc = '### ✅ AC\n- [ ] Item A';
			mockJiraClient.getIssue.mockResolvedValue({
				fields: { description: { type: 'doc', content: [] } },
			});
			mockAdfToPlainText.mockReturnValue(desc);
			mockMarkdownToAdf.mockReturnValue({ type: 'doc', version: 1, content: [] });
			mockJiraClient.updateIssue.mockResolvedValue(undefined);

			const checklists = await provider.getChecklists('PROJ-1');
			await provider.updateChecklistItem('PROJ-1', checklists[0].items[0].id, true);

			expect(mockJiraClient.transitionIssue).not.toHaveBeenCalled();
		});
	});

	describe('deleteChecklistItem (inline)', () => {
		it('removes the item line from the ADF description', async () => {
			const desc = '### ✅ AC\n- [ ] Keep\n- [ ] Remove';
			mockJiraClient.getIssue.mockResolvedValue({
				fields: { description: { type: 'doc', content: [] } },
			});
			mockAdfToPlainText.mockReturnValue(desc);
			mockMarkdownToAdf.mockReturnValue({ type: 'doc', version: 1, content: [] });
			mockJiraClient.updateIssue.mockResolvedValue(undefined);

			const checklists = await provider.getChecklists('PROJ-1');
			const removeId = checklists[0].items[1].id;
			await provider.deleteChecklistItem('PROJ-1', removeId);

			const lastCall = mockMarkdownToAdf.mock.calls[mockMarkdownToAdf.mock.calls.length - 1];
			expect(lastCall[0]).toBe('### ✅ AC\n- [ ] Keep');
		});

		it('does NOT call deleteIssue', async () => {
			const desc = '### ✅ AC\n- [ ] Item';
			mockJiraClient.getIssue.mockResolvedValue({
				fields: { description: { type: 'doc', content: [] } },
			});
			mockAdfToPlainText.mockReturnValue(desc);
			mockMarkdownToAdf.mockReturnValue({ type: 'doc', version: 1, content: [] });
			mockJiraClient.updateIssue.mockResolvedValue(undefined);

			const checklists = await provider.getChecklists('PROJ-1');
			await provider.deleteChecklistItem('PROJ-1', checklists[0].items[0].id);

			expect(mockJiraClient.deleteIssue).not.toHaveBeenCalled();
		});
	});

	describe('checklist update retry on conflict', () => {
		it('retries description update once on failure', async () => {
			mockJiraClient.getIssue.mockResolvedValue({
				fields: { description: { type: 'doc', content: [] } },
			});
			mockAdfToPlainText.mockReturnValue('### ✅ AC\n- [ ] Item');
			mockMarkdownToAdf.mockReturnValue({ type: 'doc', version: 1, content: [] });
			mockJiraClient.updateIssue
				.mockRejectedValueOnce(new Error('stale'))
				.mockResolvedValueOnce(undefined);

			const checklists = await provider.getChecklists('PROJ-1');
			await provider.updateChecklistItem('PROJ-1', checklists[0].items[0].id, true);

			expect(mockJiraClient.updateIssue).toHaveBeenCalledTimes(2);
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

	describe('linkPR', () => {
		it('delegates to jiraClient.addRemoteLink with workItemId, prUrl, and prTitle', async () => {
			mockJiraClient.addRemoteLink.mockResolvedValue(undefined);

			await provider.linkPR('PROJ-1', 'https://github.com/owner/repo/pull/42', 'Pull Request #42');

			expect(mockJiraClient.addRemoteLink).toHaveBeenCalledWith(
				'PROJ-1',
				'https://github.com/owner/repo/pull/42',
				'Pull Request #42',
			);
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
