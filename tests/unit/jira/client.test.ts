import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

// Use vi.hoisted to create mock objects before vi.mock factories run
const {
	mockIssues,
	mockIssueComments,
	mockIssueSearch,
	mockIssueAttachments,
	mockIssueRemoteLinks,
	mockMyself,
	mockProjects,
	mockIssueFields,
} = vi.hoisted(() => ({
	mockIssues: {
		getIssue: vi.fn(),
		editIssue: vi.fn(),
		createIssue: vi.fn(),
		deleteIssue: vi.fn(),
		doTransition: vi.fn(),
		getTransitions: vi.fn(),
	},
	mockIssueComments: {
		getComments: vi.fn(),
		addComment: vi.fn(),
		updateComment: vi.fn(),
	},
	mockIssueSearch: {
		searchForIssuesUsingJql: vi.fn(),
	},
	mockIssueAttachments: {
		addAttachment: vi.fn(),
	},
	mockIssueRemoteLinks: {
		createOrUpdateRemoteIssueLink: vi.fn(),
	},
	mockMyself: {
		getCurrentUser: vi.fn(),
	},
	mockProjects: {
		getProject: vi.fn(),
		searchProjects: vi.fn(),
		getAllStatuses: vi.fn(),
	},
	mockIssueFields: {
		getFields: vi.fn(),
	},
}));

vi.mock('jira.js', () => ({
	Version3Client: vi.fn().mockImplementation(() => ({
		issues: mockIssues,
		issueComments: mockIssueComments,
		issueSearch: mockIssueSearch,
		issueAttachments: mockIssueAttachments,
		issueRemoteLinks: mockIssueRemoteLinks,
		myself: mockMyself,
		projects: mockProjects,
		issueFields: mockIssueFields,
	})),
}));

import {
	_resetCloudIdCache,
	getJiraCredentials,
	jiraClient,
	withJiraCredentials,
} from '../../../src/jira/client.js';

describe('jiraClient', () => {
	const creds = {
		email: 'bot@example.com',
		apiToken: 'jira-token',
		baseUrl: 'https://jira.example.com',
	};
	const expectedAuth = `Basic ${Buffer.from('bot@example.com:jira-token').toString('base64')}`;

	beforeEach(() => {
		// Reset only the call history of mock client methods, not their implementations
		mockIssues.getIssue.mockReset();
		mockIssues.editIssue.mockReset();
		mockIssues.createIssue.mockReset();
		mockIssues.deleteIssue.mockReset();
		mockIssues.doTransition.mockReset();
		mockIssues.getTransitions.mockReset();
		mockIssueComments.getComments.mockReset();
		mockIssueComments.addComment.mockReset();
		mockIssueComments.updateComment.mockReset();
		mockIssueSearch.searchForIssuesUsingJql.mockReset();
		mockIssueAttachments.addAttachment.mockReset();
		mockIssueRemoteLinks.createOrUpdateRemoteIssueLink.mockReset();
		mockMyself.getCurrentUser.mockReset();
		mockProjects.getProject.mockReset();
		mockProjects.searchProjects.mockReset();
		mockProjects.getAllStatuses.mockReset();
		mockIssueFields.getFields.mockReset();
		_resetCloudIdCache();
	});

	afterEach(() => {
		// Note: We don't call vi.restoreAllMocks() here because it would reset
		// the Version3Client mock implementation from vi.mock(), breaking subsequent tests.
		// Instead we clear only the fetch spy manually.
		vi.clearAllMocks();
	});

	describe('getCloudId', () => {
		it('fetches cloud ID from tenant_info endpoint', async () => {
			const fetchSpy = vi
				.spyOn(globalThis, 'fetch')
				.mockResolvedValue(
					new Response(JSON.stringify({ cloudId: 'cloud-abc-123' }), { status: 200 }),
				);

			const result = await withJiraCredentials(creds, () => jiraClient.getCloudId());

			expect(result).toBe('cloud-abc-123');
			expect(fetchSpy).toHaveBeenCalledWith(
				'https://jira.example.com/_edge/tenant_info',
				expect.objectContaining({
					headers: { Authorization: expectedAuth },
				}),
			);
		});

		it('caches cloud ID across calls', async () => {
			const fetchSpy = vi
				.spyOn(globalThis, 'fetch')
				.mockResolvedValue(
					new Response(JSON.stringify({ cloudId: 'cloud-abc-123' }), { status: 200 }),
				);

			await withJiraCredentials(creds, () => jiraClient.getCloudId());
			const second = await withJiraCredentials(creds, () => jiraClient.getCloudId());

			expect(second).toBe('cloud-abc-123');
			// Should only fetch once due to caching
			expect(fetchSpy).toHaveBeenCalledOnce();
		});

		it('throws on non-OK response', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				new Response('Unauthorized', { status: 401 }),
			);

			await expect(withJiraCredentials(creds, () => jiraClient.getCloudId())).rejects.toThrow(
				'Failed to fetch JIRA cloud ID: 401',
			);
		});

		it('throws when response is missing cloudId', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				new Response(JSON.stringify({}), { status: 200 }),
			);

			await expect(withJiraCredentials(creds, () => jiraClient.getCloudId())).rejects.toThrow(
				'JIRA tenant_info response missing cloudId',
			);
		});
	});

	describe('addCommentReaction', () => {
		it('PUTs reaction with correct ARI and emoji ID', async () => {
			const fetchSpy = vi
				.spyOn(globalThis, 'fetch')
				// First call: getCloudId
				.mockResolvedValueOnce(
					new Response(JSON.stringify({ cloudId: 'cloud-xyz' }), { status: 200 }),
				)
				// Second call: the actual reaction PUT
				.mockResolvedValueOnce(new Response('{}', { status: 200 }));

			await withJiraCredentials(creds, () =>
				jiraClient.addCommentReaction('10001', '20001', 'atlassian-thought_balloon'),
			);

			expect(fetchSpy).toHaveBeenCalledTimes(2);

			// Verify the reaction PUT call
			const [url, options] = fetchSpy.mock.calls[1];
			expect(url).toBe(
				'https://jira.example.com/rest/reactions/1.0/reactions/ari%3Acloud%3Ajira%3Acloud-xyz%3Acomment%2F10001%2F20001/atlassian-thought_balloon',
			);
			expect(options).toEqual(
				expect.objectContaining({
					method: 'PUT',
					headers: expect.objectContaining({
						Authorization: expectedAuth,
						'Content-Type': 'application/json',
					}),
				}),
			);
		});

		it('uses cached cloud ID on subsequent calls', async () => {
			const fetchSpy = vi
				.spyOn(globalThis, 'fetch')
				// First call: getCloudId
				.mockResolvedValueOnce(
					new Response(JSON.stringify({ cloudId: 'cloud-xyz' }), { status: 200 }),
				)
				// Second call: reaction PUT
				.mockResolvedValueOnce(new Response('{}', { status: 200 }))
				// Third call: reaction PUT (no getCloudId — cached)
				.mockResolvedValueOnce(new Response('{}', { status: 200 }));

			await withJiraCredentials(creds, () =>
				jiraClient.addCommentReaction('10001', '20001', 'atlassian-thought_balloon'),
			);
			await withJiraCredentials(creds, () =>
				jiraClient.addCommentReaction('10002', '20002', 'atlassian-thought_balloon'),
			);

			// 1 getCloudId + 2 reaction PUTs = 3 total
			expect(fetchSpy).toHaveBeenCalledTimes(3);
		});

		it('throws on non-OK reaction response', async () => {
			vi.spyOn(globalThis, 'fetch')
				// getCloudId succeeds
				.mockResolvedValueOnce(
					new Response(JSON.stringify({ cloudId: 'cloud-xyz' }), { status: 200 }),
				)
				// reaction PUT fails
				.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

			await expect(
				withJiraCredentials(creds, () =>
					jiraClient.addCommentReaction('10001', '20001', 'atlassian-thought_balloon'),
				),
			).rejects.toThrow('Failed to add JIRA comment reaction: 404');
		});

		it('throws when called outside withJiraCredentials scope', async () => {
			await expect(
				jiraClient.addCommentReaction('10001', '20001', 'atlassian-thought_balloon'),
			).rejects.toThrow('No JIRA credentials in scope');
		});
	});

	describe('getIssue', () => {
		it('calls getIssue with the issue key and required fields', async () => {
			const issueData = { key: 'TEST-1', fields: { summary: 'Test Issue' } };
			mockIssues.getIssue.mockResolvedValue(issueData);

			const result = await withJiraCredentials(creds, () => jiraClient.getIssue('TEST-1'));

			expect(result).toEqual(issueData);
			expect(mockIssues.getIssue).toHaveBeenCalledWith(
				expect.objectContaining({ issueIdOrKey: 'TEST-1' }),
			);
		});

		it('throws when called outside scope', async () => {
			await expect(jiraClient.getIssue('TEST-1')).rejects.toThrow('No JIRA credentials in scope');
		});
	});

	describe('updateIssue', () => {
		it('calls editIssue with summary', async () => {
			mockIssues.editIssue.mockResolvedValue(undefined);

			await withJiraCredentials(creds, () =>
				jiraClient.updateIssue('TEST-1', { summary: 'New Title' }),
			);

			expect(mockIssues.editIssue).toHaveBeenCalledWith(
				expect.objectContaining({
					issueIdOrKey: 'TEST-1',
					fields: expect.objectContaining({ summary: 'New Title' }),
				}),
			);
		});

		it('calls editIssue with description', async () => {
			mockIssues.editIssue.mockResolvedValue(undefined);
			const desc = { type: 'doc', version: 1, content: [] };

			await withJiraCredentials(creds, () =>
				jiraClient.updateIssue('TEST-1', { description: desc }),
			);

			expect(mockIssues.editIssue).toHaveBeenCalledWith(
				expect.objectContaining({
					fields: expect.objectContaining({ description: desc }),
				}),
			);
		});
	});

	describe('addComment', () => {
		it('returns comment id', async () => {
			mockIssueComments.addComment.mockResolvedValue({ id: 'comment-123' });

			const id = await withJiraCredentials(creds, () =>
				jiraClient.addComment('TEST-1', { type: 'doc' }),
			);

			expect(id).toBe('comment-123');
			expect(mockIssueComments.addComment).toHaveBeenCalledWith(
				expect.objectContaining({ issueIdOrKey: 'TEST-1' }),
			);
		});

		it('returns empty string when id is missing', async () => {
			mockIssueComments.addComment.mockResolvedValue({});

			const id = await withJiraCredentials(creds, () =>
				jiraClient.addComment('TEST-1', { type: 'doc' }),
			);

			expect(id).toBe('');
		});
	});

	describe('getIssueTypesForProject', () => {
		it('returns project-scoped issue types', async () => {
			mockProjects.getProject.mockResolvedValue({
				issueTypes: [
					{ name: 'Task', subtask: false },
					{ name: 'Subtask', subtask: true },
					{ name: 'Bug', subtask: false },
				],
			});

			const result = await withJiraCredentials(creds, () =>
				jiraClient.getIssueTypesForProject('BTS'),
			);

			expect(result).toEqual([
				{ name: 'Task', subtask: false },
				{ name: 'Subtask', subtask: true },
				{ name: 'Bug', subtask: false },
			]);
			expect(mockProjects.getProject).toHaveBeenCalledWith({ projectIdOrKey: 'BTS' });
		});

		it('handles missing fields gracefully', async () => {
			mockProjects.getProject.mockResolvedValue({
				issueTypes: [{}, { name: 'Story' }],
			});

			const result = await withJiraCredentials(creds, () =>
				jiraClient.getIssueTypesForProject('TEST'),
			);

			expect(result).toEqual([
				{ name: '', subtask: false },
				{ name: 'Story', subtask: false },
			]);
		});

		it('returns empty array when project has no issue types', async () => {
			mockProjects.getProject.mockResolvedValue({});

			const result = await withJiraCredentials(creds, () =>
				jiraClient.getIssueTypesForProject('TEST'),
			);

			expect(result).toEqual([]);
		});
	});

	describe('createIssue', () => {
		it('calls createIssue with the provided fields', async () => {
			const newIssue = { id: '10001', key: 'TEST-2' };
			mockIssues.createIssue.mockResolvedValue(newIssue);

			const result = await withJiraCredentials(creds, () =>
				jiraClient.createIssue({
					project: { key: 'TEST' },
					summary: 'New Issue',
					issuetype: { name: 'Task' },
				}),
			);

			expect(result).toEqual(newIssue);
			expect(mockIssues.createIssue).toHaveBeenCalledWith(
				expect.objectContaining({
					fields: expect.objectContaining({ project: { key: 'TEST' } }),
				}),
			);
		});

		it('throws enriched error with JIRA response detail on failure', async () => {
			const apiError = Object.assign(new Error('Request failed with status code 400'), {
				response: {
					data: {
						errorMessages: [],
						errors: { issuetype: 'Valid issue type is required' },
					},
				},
			});
			mockIssues.createIssue.mockRejectedValue(apiError);

			const { logger } = await import('../../../src/utils/logging.js');

			await expect(
				withJiraCredentials(creds, () =>
					jiraClient.createIssue({
						project: { key: 'BTS' },
						summary: 'Subtask',
						issuetype: { name: 'Sub-task' },
					}),
				),
			).rejects.toThrow(
				/JIRA createIssue failed \(project=BTS, type=Sub-task\):.*Request failed.*Valid issue type is required/,
			);

			expect(logger.error).toHaveBeenCalledWith(
				'JIRA createIssue failed',
				expect.objectContaining({
					project: 'BTS',
					issueType: 'Sub-task',
					detail: expect.objectContaining({
						errors: { issuetype: 'Valid issue type is required' },
					}),
				}),
			);
		});

		it('throws enriched error without detail when error has no response', async () => {
			mockIssues.createIssue.mockRejectedValue(new Error('Network error'));

			const { logger } = await import('../../../src/utils/logging.js');

			await expect(
				withJiraCredentials(creds, () =>
					jiraClient.createIssue({
						project: { key: 'TEST' },
						summary: 'Issue',
						issuetype: { name: 'Task' },
					}),
				),
			).rejects.toThrow('JIRA createIssue failed (project=TEST, type=Task): Network error');

			expect(logger.error).toHaveBeenCalledWith(
				'JIRA createIssue failed',
				expect.objectContaining({
					project: 'TEST',
					issueType: 'Task',
					detail: undefined,
				}),
			);
		});
	});

	describe('deleteIssue', () => {
		it('calls deleteIssue with the issue key', async () => {
			mockIssues.deleteIssue.mockResolvedValue(undefined);

			await withJiraCredentials(creds, () => jiraClient.deleteIssue('TEST-5'));

			expect(mockIssues.deleteIssue).toHaveBeenCalledWith({ issueIdOrKey: 'TEST-5' });
		});

		it('throws when called outside scope', async () => {
			await expect(jiraClient.deleteIssue('TEST-5')).rejects.toThrow(
				'No JIRA credentials in scope',
			);
		});
	});

	describe('transitionIssue', () => {
		it('calls doTransition with issue key and transition id', async () => {
			mockIssues.doTransition.mockResolvedValue(undefined);

			await withJiraCredentials(creds, () => jiraClient.transitionIssue('TEST-1', 'transition-31'));

			expect(mockIssues.doTransition).toHaveBeenCalledWith({
				issueIdOrKey: 'TEST-1',
				transition: { id: 'transition-31' },
			});
		});
	});

	describe('getTransitions', () => {
		it('returns transitions array', async () => {
			const transitions = [
				{ id: '31', name: 'Done' },
				{ id: '11', name: 'In Progress' },
			];
			mockIssues.getTransitions.mockResolvedValue({ transitions });

			const result = await withJiraCredentials(creds, () => jiraClient.getTransitions('TEST-1'));

			expect(result).toEqual(transitions);
		});

		it('returns empty array when transitions is missing', async () => {
			mockIssues.getTransitions.mockResolvedValue({});

			const result = await withJiraCredentials(creds, () => jiraClient.getTransitions('TEST-1'));

			expect(result).toEqual([]);
		});
	});

	describe('updateLabels', () => {
		it('calls editIssue with labels array', async () => {
			mockIssues.editIssue.mockResolvedValue(undefined);

			await withJiraCredentials(creds, () => jiraClient.updateLabels('TEST-1', ['bug', 'urgent']));

			expect(mockIssues.editIssue).toHaveBeenCalledWith({
				issueIdOrKey: 'TEST-1',
				fields: { labels: ['bug', 'urgent'] },
			});
		});
	});

	describe('searchIssues', () => {
		it('returns issues from JQL search', async () => {
			const issues = [
				{ id: '1', key: 'TEST-1' },
				{ id: '2', key: 'TEST-2' },
			];
			mockIssueSearch.searchForIssuesUsingJql.mockResolvedValue({ issues });

			const result = await withJiraCredentials(creds, () =>
				jiraClient.searchIssues('project = TEST AND status = "In Progress"'),
			);

			expect(result).toEqual(issues);
			expect(mockIssueSearch.searchForIssuesUsingJql).toHaveBeenCalledWith(
				expect.objectContaining({
					jql: 'project = TEST AND status = "In Progress"',
				}),
			);
		});

		it('returns empty array when issues is missing', async () => {
			mockIssueSearch.searchForIssuesUsingJql.mockResolvedValue({});

			const result = await withJiraCredentials(creds, () =>
				jiraClient.searchIssues('project = TEST'),
			);

			expect(result).toEqual([]);
		});

		it('uses custom fields when provided', async () => {
			mockIssueSearch.searchForIssuesUsingJql.mockResolvedValue({ issues: [] });

			await withJiraCredentials(creds, () =>
				jiraClient.searchIssues('project = TEST', ['summary', 'status', 'priority']),
			);

			expect(mockIssueSearch.searchForIssuesUsingJql).toHaveBeenCalledWith(
				expect.objectContaining({
					fields: ['summary', 'status', 'priority'],
				}),
			);
		});
	});

	describe('addAttachmentFile', () => {
		it('calls addAttachment with buffer and filename', async () => {
			mockIssueAttachments.addAttachment.mockResolvedValue(undefined);
			const buf = Buffer.from('file content');

			await withJiraCredentials(creds, () =>
				jiraClient.addAttachmentFile('TEST-1', buf, 'session.zip'),
			);

			expect(mockIssueAttachments.addAttachment).toHaveBeenCalledWith(
				expect.objectContaining({
					issueIdOrKey: 'TEST-1',
					attachment: expect.objectContaining({
						filename: 'session.zip',
						file: buf,
					}),
				}),
			);
		});
	});

	describe('addRemoteLink', () => {
		it('calls createOrUpdateRemoteIssueLink with correct params', async () => {
			mockIssueRemoteLinks.createOrUpdateRemoteIssueLink.mockResolvedValue({ id: 'link-1' });

			await withJiraCredentials(creds, () =>
				jiraClient.addRemoteLink(
					'TEST-1',
					'https://github.com/owner/repo/pull/42',
					'Pull Request #42',
				),
			);

			expect(mockIssueRemoteLinks.createOrUpdateRemoteIssueLink).toHaveBeenCalledWith(
				expect.objectContaining({
					issueIdOrKey: 'TEST-1',
					globalId: 'https://github.com/owner/repo/pull/42',
					relationship: 'Pull Request',
					object: expect.objectContaining({
						url: 'https://github.com/owner/repo/pull/42',
						title: 'Pull Request #42',
					}),
				}),
			);
		});

		it('uses PR URL as globalId for idempotency', async () => {
			mockIssueRemoteLinks.createOrUpdateRemoteIssueLink.mockResolvedValue({ id: 'link-2' });
			const prUrl = 'https://github.com/owner/repo/pull/99';

			await withJiraCredentials(creds, () =>
				jiraClient.addRemoteLink('PROJ-5', prUrl, 'Pull Request #99'),
			);

			expect(mockIssueRemoteLinks.createOrUpdateRemoteIssueLink).toHaveBeenCalledWith(
				expect.objectContaining({
					globalId: prUrl,
				}),
			);
		});

		it('sets GitHub favicon icon on the remote link object', async () => {
			mockIssueRemoteLinks.createOrUpdateRemoteIssueLink.mockResolvedValue({});

			await withJiraCredentials(creds, () =>
				jiraClient.addRemoteLink('TEST-1', 'https://github.com/owner/repo/pull/1', 'PR #1'),
			);

			expect(mockIssueRemoteLinks.createOrUpdateRemoteIssueLink).toHaveBeenCalledWith(
				expect.objectContaining({
					object: expect.objectContaining({
						icon: expect.objectContaining({
							url16x16: 'https://github.com/favicon.ico',
						}),
					}),
				}),
			);
		});

		it('throws when called outside withJiraCredentials scope', async () => {
			await expect(
				jiraClient.addRemoteLink('TEST-1', 'https://github.com/pr/1', 'PR #1'),
			).rejects.toThrow('No JIRA credentials in scope');
		});
	});

	describe('getIssueComments', () => {
		it('returns comments array', async () => {
			const comments = [{ id: 'c1', body: 'First comment' }];
			mockIssueComments.getComments.mockResolvedValue({ comments });

			const result = await withJiraCredentials(creds, () => jiraClient.getIssueComments('TEST-1'));

			expect(result).toEqual(comments);
		});

		it('returns empty array when comments is missing', async () => {
			mockIssueComments.getComments.mockResolvedValue({});

			const result = await withJiraCredentials(creds, () => jiraClient.getIssueComments('TEST-1'));

			expect(result).toEqual([]);
		});
	});

	describe('searchProjects', () => {
		it('returns project keys and names', async () => {
			mockProjects.searchProjects.mockResolvedValue({
				values: [
					{ key: 'PROJ', name: 'My Project' },
					{ key: 'TEST', name: 'Test Project' },
				],
			});

			const result = await withJiraCredentials(creds, () => jiraClient.searchProjects());

			expect(result).toEqual([
				{ key: 'PROJ', name: 'My Project' },
				{ key: 'TEST', name: 'Test Project' },
			]);
			expect(mockProjects.searchProjects).toHaveBeenCalledWith({ maxResults: 100 });
		});

		it('handles missing fields gracefully', async () => {
			mockProjects.searchProjects.mockResolvedValue({
				values: [{}, { key: 'X' }],
			});

			const result = await withJiraCredentials(creds, () => jiraClient.searchProjects());

			expect(result).toEqual([
				{ key: '', name: '' },
				{ key: 'X', name: '' },
			]);
		});

		it('returns empty array when values is missing', async () => {
			mockProjects.searchProjects.mockResolvedValue({});

			const result = await withJiraCredentials(creds, () => jiraClient.searchProjects());

			expect(result).toEqual([]);
		});
	});

	describe('getProjectStatuses', () => {
		it('flattens and deduplicates statuses across issue types', async () => {
			mockProjects.getAllStatuses.mockResolvedValue([
				{
					statuses: [
						{ name: 'To Do', id: '1' },
						{ name: 'In Progress', id: '2' },
					],
				},
				{
					statuses: [
						{ name: 'In Progress', id: '2' },
						{ name: 'Done', id: '3' },
					],
				},
			]);

			const result = await withJiraCredentials(creds, () => jiraClient.getProjectStatuses('PROJ'));

			expect(result).toEqual([
				{ name: 'To Do', id: '1' },
				{ name: 'In Progress', id: '2' },
				{ name: 'Done', id: '3' },
			]);
			expect(mockProjects.getAllStatuses).toHaveBeenCalledWith({
				projectIdOrKey: 'PROJ',
			});
		});

		it('skips statuses with empty names', async () => {
			mockProjects.getAllStatuses.mockResolvedValue([
				{
					statuses: [
						{ name: '', id: '0' },
						{ name: 'Open', id: '1' },
					],
				},
			]);

			const result = await withJiraCredentials(creds, () => jiraClient.getProjectStatuses('PROJ'));

			expect(result).toEqual([{ name: 'Open', id: '1' }]);
		});

		it('handles missing statuses array in issue type', async () => {
			mockProjects.getAllStatuses.mockResolvedValue([
				{},
				{ statuses: [{ name: 'Open', id: '1' }] },
			]);

			const result = await withJiraCredentials(creds, () => jiraClient.getProjectStatuses('PROJ'));

			expect(result).toEqual([{ name: 'Open', id: '1' }]);
		});
	});

	describe('getFields', () => {
		it('returns all fields with custom flag', async () => {
			mockIssueFields.getFields.mockResolvedValue([
				{ id: 'summary', name: 'Summary', custom: false },
				{ id: 'customfield_10001', name: 'Story Points', custom: true },
			]);

			const result = await withJiraCredentials(creds, () => jiraClient.getFields());

			expect(result).toEqual([
				{ id: 'summary', name: 'Summary', custom: false },
				{ id: 'customfield_10001', name: 'Story Points', custom: true },
			]);
		});

		it('handles missing fields gracefully', async () => {
			mockIssueFields.getFields.mockResolvedValue([{}, { id: 'x' }]);

			const result = await withJiraCredentials(creds, () => jiraClient.getFields());

			expect(result).toEqual([
				{ id: '', name: '', custom: false },
				{ id: 'x', name: '', custom: false },
			]);
		});
	});

	describe('getJiraCredentials', () => {
		it('throws when called outside scope', () => {
			expect(() => getJiraCredentials()).toThrow('No JIRA credentials in scope');
		});

		it('returns credentials when inside withJiraCredentials scope', async () => {
			let captured: ReturnType<typeof getJiraCredentials> | undefined;
			await withJiraCredentials(creds, async () => {
				captured = getJiraCredentials();
			});
			expect(captured).toEqual(creds);
		});
	});
});
