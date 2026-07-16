import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import {
	addContentToProject,
	addLabelsToContent,
	createRepositoryIssue,
	downloadImage,
	getContentNode,
	getIssueComments,
	getProjectItem,
	getRepositoryId,
	listAllProjectItems,
	removeLabelsFromContent,
	resolveContentRepoLabelId,
	resolveProjectItemId,
	withGitHubProjectsCredentials,
} from '../../../../src/github-projects/client.js';
import { logger } from '../../../../src/utils/logging.js';

/** Build a fetch Response-like stub for a GraphQL query result. */
function graphqlResponse(data: unknown) {
	return {
		ok: true,
		json: async () => ({ data }),
		text: async () => '',
	} as unknown as Response;
}

describe('github-projects client', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	describe('getProjectItem — __typename normalization (Fix 3)', () => {
		it('sets content.type to "pull_request" when __typename is PullRequest', async () => {
			fetchMock.mockResolvedValue(
				graphqlResponse({
					node: {
						id: 'PVTI_item',
						content: {
							__typename: 'PullRequest',
							id: 'PR_1',
							number: 7,
							title: 't',
							body: '',
							url: 'u',
							state: 'OPEN',
						},
						fieldValues: { nodes: [] },
					},
				}),
			);

			const item = await withGitHubProjectsCredentials({ token: 't' }, () =>
				getProjectItem('PVTI_item'),
			);

			expect(item.content?.type).toBe('pull_request');
		});

		it('sets content.type to "issue" when __typename is Issue', async () => {
			fetchMock.mockResolvedValue(
				graphqlResponse({
					node: {
						id: 'PVTI_item',
						content: {
							__typename: 'Issue',
							id: 'I_1',
							number: 7,
							title: 't',
							body: '',
							url: 'u',
							state: 'OPEN',
						},
						fieldValues: { nodes: [] },
					},
				}),
			);

			const item = await withGitHubProjectsCredentials({ token: 't' }, () =>
				getProjectItem('PVTI_item'),
			);

			expect(item.content?.type).toBe('issue');
		});
	});

	describe('listAllProjectItems — pagination', () => {
		function itemsPage(nodeIds: string[], hasNextPage: boolean, endCursor: string | null) {
			return graphqlResponse({
				node: {
					items: {
						nodes: nodeIds.map((id) => ({
							id,
							content: {
								__typename: 'Issue',
								id: `content-${id}`,
								number: 1,
								title: 't',
								body: '',
								url: 'u',
								state: 'OPEN',
							},
							fieldValues: { nodes: [] },
						})),
						pageInfo: { hasNextPage, endCursor },
					},
				},
			});
		}

		it('follows endCursor across pages and concatenates every item', async () => {
			fetchMock
				.mockResolvedValueOnce(itemsPage(['PVTI_1', 'PVTI_2'], true, 'cursor-1'))
				.mockResolvedValueOnce(itemsPage(['PVTI_3'], false, null));

			const items = await withGitHubProjectsCredentials({ token: 't' }, () =>
				listAllProjectItems('PVT_project', { pageSize: 2 }),
			);

			expect(items).toHaveLength(3);
			expect(items.map((i) => i.id)).toEqual(['PVTI_1', 'PVTI_2', 'PVTI_3']);
			// Second call must forward the cursor.
			const [, secondInit] = fetchMock.mock.calls[1];
			expect(JSON.parse((secondInit as { body: string }).body).variables.after).toBe('cursor-1');
		});

		it('warns and truncates instead of paginating forever when the cap is hit', async () => {
			fetchMock.mockResolvedValue(itemsPage(['PVTI_1', 'PVTI_2'], true, 'cursor-x'));

			const items = await withGitHubProjectsCredentials({ token: 't' }, () =>
				listAllProjectItems('PVT_project', { pageSize: 2, maxItems: 2 }),
			);

			expect(items).toHaveLength(2);
			expect(logger.warn).toHaveBeenCalledWith(
				expect.stringContaining('hit item cap'),
				expect.objectContaining({ maxItems: 2 }),
			);
		});
	});

	describe('getContentNode', () => {
		function contentNode(typename: 'Issue' | 'PullRequest', projectItems: unknown[]) {
			return graphqlResponse({
				node: {
					__typename: typename,
					id: typename === 'PullRequest' ? 'PR_1' : 'I_1',
					number: 42,
					title: 't',
					body: 'b',
					url: 'u',
					state: 'OPEN',
					projectItems: { nodes: projectItems },
				},
			});
		}

		it('resolves the Status option for the requested project from the content node', async () => {
			fetchMock.mockResolvedValue(
				contentNode('Issue', [
					{
						project: { id: 'PVT_other' },
						fieldValues: {
							nodes: [{ optionId: 'opt-x', name: 'Other', field: { id: 'f', name: 'Status' } }],
						},
					},
					{
						project: { id: 'PVT_project' },
						fieldValues: {
							nodes: [{ optionId: 'opt-todo', name: 'Todo', field: { id: 'f', name: 'Status' } }],
						},
					},
				]),
			);

			const content = await withGitHubProjectsCredentials({ token: 't' }, () =>
				getContentNode('I_1', 'PVT_project'),
			);

			expect(content.type).toBe('issue');
			// Picks the Status from PVT_project, not the first project item.
			expect(content.statusOptionId).toBe('opt-todo');
			expect(content.statusName).toBe('Todo');
		});

		it('normalizes __typename PullRequest to type "pull_request"', async () => {
			fetchMock.mockResolvedValue(contentNode('PullRequest', []));
			const content = await withGitHubProjectsCredentials({ token: 't' }, () =>
				getContentNode('PR_1'),
			);
			expect(content.type).toBe('pull_request');
			expect(content.statusOptionId).toBeUndefined();
		});

		it('throws when the node is neither an Issue nor a PullRequest', async () => {
			fetchMock.mockResolvedValue(graphqlResponse({ node: { __typename: 'ProjectV2Item' } }));
			await expect(
				withGitHubProjectsCredentials({ token: 't' }, () => getContentNode('PVTI_x')),
			).rejects.toThrow(/did not resolve to an Issue or PullRequest/);
		});
	});

	describe('getIssueComments', () => {
		it('returns the comment nodes of whichever content fragment matched', async () => {
			fetchMock.mockResolvedValue(
				graphqlResponse({
					node: {
						comments: {
							nodes: [
								{
									id: 'IC_1',
									body: 'hi',
									createdAt: '2026-07-01T00:00:00Z',
									author: { login: 'octocat', id: 'U_1', name: 'The Octocat' },
								},
							],
						},
					},
				}),
			);

			const comments = await withGitHubProjectsCredentials({ token: 't' }, () =>
				getIssueComments('I_1'),
			);

			expect(comments).toHaveLength(1);
			expect(comments[0].id).toBe('IC_1');
			expect(comments[0].author?.login).toBe('octocat');
		});

		it('returns [] when the node exposes no comments connection', async () => {
			fetchMock.mockResolvedValue(graphqlResponse({ node: {} }));
			const comments = await withGitHubProjectsCredentials({ token: 't' }, () =>
				getIssueComments('I_1'),
			);
			expect(comments).toEqual([]);
		});
	});

	describe('labels', () => {
		it('resolveContentRepoLabelId returns the repo-scoped label node ID for a name', async () => {
			fetchMock.mockResolvedValue(
				graphqlResponse({ node: { repository: { label: { id: 'LA_repo_processing' } } } }),
			);

			const labelId = await withGitHubProjectsCredentials({ token: 't' }, () =>
				resolveContentRepoLabelId('I_1', 'processing'),
			);

			expect(labelId).toBe('LA_repo_processing');
			const [, init] = fetchMock.mock.calls[0];
			expect(JSON.parse((init as { body: string }).body).variables).toEqual({
				id: 'I_1',
				name: 'processing',
			});
		});

		it('resolveContentRepoLabelId returns null when the repo has no such label', async () => {
			fetchMock.mockResolvedValue(graphqlResponse({ node: { repository: { label: null } } }));
			const labelId = await withGitHubProjectsCredentials({ token: 't' }, () =>
				resolveContentRepoLabelId('I_1', 'missing'),
			);
			expect(labelId).toBeNull();
		});

		it('addLabelsToContent posts addLabelsToLabelable with the content node as labelableId', async () => {
			fetchMock.mockResolvedValue(graphqlResponse({ addLabelsToLabelable: {} }));

			await withGitHubProjectsCredentials({ token: 't' }, () =>
				addLabelsToContent('I_1', ['LA_x']),
			);

			const [, init] = fetchMock.mock.calls[0];
			const parsed = JSON.parse((init as { body: string }).body);
			expect(parsed.query).toContain('addLabelsToLabelable');
			expect(parsed.variables).toEqual({ labelableId: 'I_1', labelIds: ['LA_x'] });
		});

		it('removeLabelsFromContent posts removeLabelsFromLabelable', async () => {
			fetchMock.mockResolvedValue(graphqlResponse({ removeLabelsFromLabelable: {} }));

			await withGitHubProjectsCredentials({ token: 't' }, () =>
				removeLabelsFromContent('I_1', ['LA_x']),
			);

			const [, init] = fetchMock.mock.calls[0];
			const parsed = JSON.parse((init as { body: string }).body);
			expect(parsed.query).toContain('removeLabelsFromLabelable');
			expect(parsed.variables).toEqual({ labelableId: 'I_1', labelIds: ['LA_x'] });
		});
	});

	describe('work-item creation', () => {
		it('getRepositoryId returns the repo node ID', async () => {
			fetchMock.mockResolvedValue(graphqlResponse({ repository: { id: 'R_kgDO' } }));
			const id = await withGitHubProjectsCredentials({ token: 't' }, () =>
				getRepositoryId('octocat', 'repo'),
			);
			expect(id).toBe('R_kgDO');
			const [, init] = fetchMock.mock.calls[0];
			expect(JSON.parse((init as { body: string }).body).variables).toEqual({
				owner: 'octocat',
				name: 'repo',
			});
		});

		it('getRepositoryId throws when the repo is not found/accessible', async () => {
			fetchMock.mockResolvedValue(graphqlResponse({ repository: null }));
			await expect(
				withGitHubProjectsCredentials({ token: 't' }, () => getRepositoryId('octocat', 'nope')),
			).rejects.toThrow(/not found or not accessible/);
		});

		it('createRepositoryIssue returns the new issue node id/number/url', async () => {
			fetchMock.mockResolvedValue(
				graphqlResponse({
					createIssue: { issue: { id: 'I_new', number: 7, url: 'https://gh/issues/7' } },
				}),
			);
			const issue = await withGitHubProjectsCredentials({ token: 't' }, () =>
				createRepositoryIssue('R_kgDO', 'Title', 'Body'),
			);
			expect(issue).toEqual({ id: 'I_new', number: 7, url: 'https://gh/issues/7' });
			const [, init] = fetchMock.mock.calls[0];
			const parsed = JSON.parse((init as { body: string }).body);
			expect(parsed.query).toContain('createIssue');
			expect(parsed.variables).toEqual({ repositoryId: 'R_kgDO', title: 'Title', body: 'Body' });
		});

		it('addContentToProject returns the created ProjectV2Item id', async () => {
			fetchMock.mockResolvedValue(
				graphqlResponse({ addProjectV2ItemById: { item: { id: 'PVTI_new' } } }),
			);
			const itemId = await withGitHubProjectsCredentials({ token: 't' }, () =>
				addContentToProject('PVT_project', 'I_new'),
			);
			expect(itemId).toBe('PVTI_new');
			const [, init] = fetchMock.mock.calls[0];
			expect(JSON.parse((init as { body: string }).body).variables).toEqual({
				projectId: 'PVT_project',
				contentId: 'I_new',
			});
		});

		it('resolveProjectItemId picks the item for the requested project', async () => {
			fetchMock.mockResolvedValue(
				graphqlResponse({
					node: {
						projectItems: {
							nodes: [
								{ id: 'PVTI_other', project: { id: 'PVT_other' } },
								{ id: 'PVTI_match', project: { id: 'PVT_project' } },
							],
						},
					},
				}),
			);
			const itemId = await withGitHubProjectsCredentials({ token: 't' }, () =>
				resolveProjectItemId('I_1', 'PVT_project'),
			);
			expect(itemId).toBe('PVTI_match');
		});

		it('resolveProjectItemId returns null when the content is not in the project', async () => {
			fetchMock.mockResolvedValue(
				graphqlResponse({
					node: { projectItems: { nodes: [{ id: 'PVTI_x', project: { id: 'PVT_other' } }] } },
				}),
			);
			const itemId = await withGitHubProjectsCredentials({ token: 't' }, () =>
				resolveProjectItemId('I_1', 'PVT_project'),
			);
			expect(itemId).toBeNull();
		});
	});

	describe('downloadImage (Fix 5)', () => {
		it('returns the buffer and the response Content-Type as the MIME', async () => {
			fetchMock.mockResolvedValue({
				ok: true,
				arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
				headers: new Headers({ 'content-type': 'image/png' }),
			} as unknown as Response);

			const result = await withGitHubProjectsCredentials({ token: 't' }, () =>
				downloadImage('https://user-images.githubusercontent.com/a.png'),
			);

			expect(result).not.toBeNull();
			expect(result?.mimeType).toBe('image/png');
			expect(result?.buffer).toEqual(Buffer.from([1, 2, 3]));
		});

		it('sends the bearer token as the Authorization header', async () => {
			fetchMock.mockResolvedValue({
				ok: true,
				arrayBuffer: async () => new ArrayBuffer(0),
				headers: new Headers({ 'content-type': 'image/png' }),
			} as unknown as Response);

			await withGitHubProjectsCredentials({ token: 'ghp_secret' }, () =>
				downloadImage('https://example.com/a.png'),
			);

			const [, init] = fetchMock.mock.calls[0];
			const headers = init.headers as Record<string, string>;
			expect(JSON.stringify(headers)).toContain('ghp_secret');
		});

		it('returns null on a non-ok response instead of throwing', async () => {
			fetchMock.mockResolvedValue({ ok: false, status: 404 } as unknown as Response);

			const result = await withGitHubProjectsCredentials({ token: 't' }, () =>
				downloadImage('https://example.com/missing.png'),
			);

			expect(result).toBeNull();
		});
	});
});
