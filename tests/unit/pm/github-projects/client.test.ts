import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import {
	addCommentToIssue,
	addContentToProject,
	addLabelsToContent,
	createRepositoryIssue,
	deleteComment,
	downloadImage,
	getContentNode,
	getGitHubProjectsCredentials,
	getIssueComments,
	getOrganizationProjects,
	getProject,
	getProjectFields,
	getProjectItem,
	getRepositoryId,
	getStatusField,
	getUserProjects,
	getViewer,
	getViewerOrganizations,
	listAllProjectItems,
	moveProjectItemToStatus,
	removeLabelsFromContent,
	resolveContentRepoLabelId,
	resolveProjectItemId,
	resolveStatusOptionName,
	updateComment,
	updateProjectItemField,
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

	describe('getGitHubProjectsCredentials', () => {
		it('throws when called outside withGitHubProjectsCredentials scope', () => {
			expect(() => getGitHubProjectsCredentials()).toThrow(
				/No GitHub Projects credentials in scope\. Wrap the call with withGitHubProjectsCredentials\(\)\./,
			);
		});
	});

	describe('githubGraphQL — error branches', () => {
		it('throws with the response body on a non-ok HTTP status', async () => {
			fetchMock.mockResolvedValue({
				ok: false,
				status: 500,
				text: async () => 'internal server error',
			} as unknown as Response);

			await expect(
				withGitHubProjectsCredentials({ token: 't' }, () => getViewer()),
			).rejects.toThrow(/GitHub GraphQL HTTP error 500: internal server error/);
		});

		it('falls back to "<no body>" when reading the error body itself fails', async () => {
			fetchMock.mockResolvedValue({
				ok: false,
				status: 502,
				text: async () => {
					throw new Error('stream closed');
				},
			} as unknown as Response);

			await expect(
				withGitHubProjectsCredentials({ token: 't' }, () => getViewer()),
			).rejects.toThrow(/GitHub GraphQL HTTP error 502: <no body>/);
		});

		it('throws with joined messages when the GraphQL errors array is present', async () => {
			fetchMock.mockResolvedValue({
				ok: true,
				json: async () => ({
					errors: [{ message: 'field not found' }, { message: 'not authorized' }],
				}),
				text: async () => '',
			} as unknown as Response);

			await expect(
				withGitHubProjectsCredentials({ token: 't' }, () => getViewer()),
			).rejects.toThrow(/GitHub GraphQL error: field not found; not authorized/);
		});

		it('throws when the response has neither errors nor data', async () => {
			fetchMock.mockResolvedValue({
				ok: true,
				json: async () => ({}),
				text: async () => '',
			} as unknown as Response);

			await expect(
				withGitHubProjectsCredentials({ token: 't' }, () => getViewer()),
			).rejects.toThrow(/GitHub GraphQL returned no data/);
		});
	});

	describe('getProject / getProjectFields', () => {
		it('getProject returns the node with its fields', async () => {
			fetchMock.mockResolvedValue(
				graphqlResponse({
					node: {
						id: 'PVT_project',
						number: 3,
						title: 'Roadmap',
						url: 'https://github.com/orgs/o/projects/3',
						fields: {
							nodes: [
								{ id: 'F_1', name: 'Title' },
								{
									id: 'F_2',
									name: 'Status',
									options: [{ id: 'opt-1', name: 'Todo', color: 'GREEN' }],
								},
							],
						},
					},
				}),
			);

			const project = await withGitHubProjectsCredentials({ token: 't' }, () =>
				getProject('PVT_project'),
			);

			expect(project.title).toBe('Roadmap');
			expect(project.fields?.nodes).toHaveLength(2);
			const [, init] = fetchMock.mock.calls[0];
			expect(JSON.parse((init as { body: string }).body).variables).toEqual({
				projectId: 'PVT_project',
			});
		});

		it('getProjectFields returns the fields.nodes array', async () => {
			fetchMock.mockResolvedValue(
				graphqlResponse({
					node: {
						id: 'PVT_project',
						number: 3,
						title: 'Roadmap',
						url: 'u',
						fields: { nodes: [{ id: 'F_1', name: 'Status', options: [] }] },
					},
				}),
			);

			const fields = await withGitHubProjectsCredentials({ token: 't' }, () =>
				getProjectFields('PVT_project'),
			);

			expect(fields).toEqual([{ id: 'F_1', name: 'Status', options: [] }]);
		});

		it('getProjectFields falls back to [] when the project has no fields connection', async () => {
			fetchMock.mockResolvedValue(
				graphqlResponse({ node: { id: 'PVT_project', number: 3, title: 't', url: 'u' } }),
			);

			const fields = await withGitHubProjectsCredentials({ token: 't' }, () =>
				getProjectFields('PVT_project'),
			);

			expect(fields).toEqual([]);
		});
	});

	describe('listAllProjectItems — additional edge cases', () => {
		it('returns [] without calling fetch when maxItems is 0', async () => {
			const items = await withGitHubProjectsCredentials({ token: 't' }, () =>
				listAllProjectItems('PVT_project', { maxItems: 0 }),
			);

			expect(items).toEqual([]);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('stops paginating when hasNextPage is true but endCursor is null', async () => {
			fetchMock.mockResolvedValue(
				graphqlResponse({
					node: {
						items: {
							nodes: [
								{
									id: 'PVTI_1',
									content: {
										__typename: 'Issue',
										id: 'content-1',
										number: 1,
										title: 't',
										body: '',
										url: 'u',
										state: 'OPEN',
									},
									fieldValues: { nodes: [] },
								},
							],
							pageInfo: { hasNextPage: true, endCursor: null },
						},
					},
				}),
			);

			const items = await withGitHubProjectsCredentials({ token: 't' }, () =>
				listAllProjectItems('PVT_project'),
			);

			expect(items).toHaveLength(1);
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});
	});

	describe('updateProjectItemField', () => {
		it('posts updateProjectV2ItemFieldValue with the singleSelectOptionId value', async () => {
			fetchMock.mockResolvedValue(
				graphqlResponse({ updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_1' } } }),
			);

			await withGitHubProjectsCredentials({ token: 't' }, () =>
				updateProjectItemField('PVT_project', 'PVTI_1', 'F_status', 'opt-done'),
			);

			const [, init] = fetchMock.mock.calls[0];
			const parsed = JSON.parse((init as { body: string }).body);
			expect(parsed.query).toContain('updateProjectV2ItemFieldValue');
			expect(parsed.variables).toEqual({
				projectId: 'PVT_project',
				itemId: 'PVTI_1',
				fieldId: 'F_status',
				optionId: 'opt-done',
			});
		});
	});

	describe('comment mutations', () => {
		it('addCommentToIssue returns the new comment node id', async () => {
			fetchMock.mockResolvedValue(
				graphqlResponse({ addComment: { commentEdge: { node: { id: 'IC_new' } } } }),
			);

			const id = await withGitHubProjectsCredentials({ token: 't' }, () =>
				addCommentToIssue('I_1', 'hello'),
			);

			expect(id).toBe('IC_new');
			const [, init] = fetchMock.mock.calls[0];
			const parsed = JSON.parse((init as { body: string }).body);
			expect(parsed.query).toContain('addComment');
			expect(parsed.variables).toEqual({ subjectId: 'I_1', body: 'hello' });
		});

		it('updateComment posts updateIssueComment with the new body', async () => {
			fetchMock.mockResolvedValue(
				graphqlResponse({ updateIssueComment: { issueComment: { id: 'IC_1' } } }),
			);

			await withGitHubProjectsCredentials({ token: 't' }, () => updateComment('IC_1', 'edited'));

			const [, init] = fetchMock.mock.calls[0];
			const parsed = JSON.parse((init as { body: string }).body);
			expect(parsed.query).toContain('updateIssueComment');
			expect(parsed.variables).toEqual({ commentId: 'IC_1', body: 'edited' });
		});

		it('deleteComment posts deleteIssueComment with the comment id', async () => {
			fetchMock.mockResolvedValue(graphqlResponse({ deleteIssueComment: {} }));

			await withGitHubProjectsCredentials({ token: 't' }, () => deleteComment('IC_1'));

			const [, init] = fetchMock.mock.calls[0];
			const parsed = JSON.parse((init as { body: string }).body);
			expect(parsed.query).toContain('deleteIssueComment');
			expect(parsed.variables).toEqual({ commentId: 'IC_1' });
		});
	});

	describe('discovery queries', () => {
		it('getUserProjects returns the user projectsV2 nodes', async () => {
			fetchMock.mockResolvedValue(
				graphqlResponse({
					user: {
						projectsV2: {
							nodes: [{ id: 'PVT_1', number: 1, title: 'Personal', url: 'u' }],
						},
					},
				}),
			);

			const projects = await withGitHubProjectsCredentials({ token: 't' }, () =>
				getUserProjects('octocat'),
			);

			expect(projects).toEqual([{ id: 'PVT_1', number: 1, title: 'Personal', url: 'u' }]);
			const [, init] = fetchMock.mock.calls[0];
			expect(JSON.parse((init as { body: string }).body).variables).toEqual({ login: 'octocat' });
		});

		it('getOrganizationProjects returns the organization projectsV2 nodes', async () => {
			fetchMock.mockResolvedValue(
				graphqlResponse({
					organization: {
						projectsV2: {
							nodes: [{ id: 'PVT_2', number: 2, title: 'Org Board', url: 'u' }],
						},
					},
				}),
			);

			const projects = await withGitHubProjectsCredentials({ token: 't' }, () =>
				getOrganizationProjects('acme'),
			);

			expect(projects).toEqual([{ id: 'PVT_2', number: 2, title: 'Org Board', url: 'u' }]);
			const [, init] = fetchMock.mock.calls[0];
			expect(JSON.parse((init as { body: string }).body).variables).toEqual({ org: 'acme' });
		});

		it('getViewer returns the viewer identity', async () => {
			fetchMock.mockResolvedValue(
				graphqlResponse({ viewer: { id: 'U_1', login: 'octocat', name: 'The Octocat' } }),
			);

			const viewer = await withGitHubProjectsCredentials({ token: 't' }, () => getViewer());

			expect(viewer).toEqual({ id: 'U_1', login: 'octocat', name: 'The Octocat' });
		});

		it('getViewerOrganizations returns the viewer org logins (filtering blanks)', async () => {
			fetchMock.mockResolvedValue(
				graphqlResponse({
					viewer: {
						organizations: { nodes: [{ login: 'acme' }, { login: '' }, { login: 'globex' }] },
					},
				}),
			);

			const orgs = await withGitHubProjectsCredentials({ token: 't' }, () =>
				getViewerOrganizations(),
			);

			expect(orgs).toEqual([{ login: 'acme' }, { login: 'globex' }]);
		});

		it('getViewerOrganizations returns [] and warns when the query fails (e.g. missing read:org scope)', async () => {
			fetchMock.mockResolvedValue({
				ok: true,
				json: async () => ({ errors: [{ message: 'insufficient scope: read:org' }] }),
				text: async () => '',
			} as unknown as Response);

			const orgs = await withGitHubProjectsCredentials({ token: 't' }, () =>
				getViewerOrganizations(),
			);

			// Error-tolerant: never throws, so the user-owner discovery path keeps working.
			expect(orgs).toEqual([]);
			expect(logger.warn).toHaveBeenCalledWith(
				expect.stringContaining('Could not list viewer organizations'),
				expect.objectContaining({ error: expect.stringContaining('read:org') }),
			);
		});
	});

	describe('status field helpers', () => {
		function projectWithFields(fields: Array<{ id: string; name: string; options?: unknown }>) {
			return graphqlResponse({
				node: { id: 'PVT_project', number: 1, title: 't', url: 'u', fields: { nodes: fields } },
			});
		}

		it('getStatusField returns the Status field id + options when present', async () => {
			fetchMock.mockResolvedValue(
				projectWithFields([
					{ id: 'F_1', name: 'Title' },
					{
						id: 'F_status',
						name: 'Status',
						options: [
							{ id: 'opt-todo', name: 'Todo' },
							{ id: 'opt-done', name: 'Done' },
						],
					},
				]),
			);

			const statusField = await withGitHubProjectsCredentials({ token: 't' }, () =>
				getStatusField('PVT_project'),
			);

			expect(statusField).toEqual({
				id: 'F_status',
				options: [
					{ id: 'opt-todo', name: 'Todo' },
					{ id: 'opt-done', name: 'Done' },
				],
			});
		});

		it('getStatusField returns null when there is no Status field', async () => {
			fetchMock.mockResolvedValue(projectWithFields([{ id: 'F_1', name: 'Title' }]));

			const statusField = await withGitHubProjectsCredentials({ token: 't' }, () =>
				getStatusField('PVT_project'),
			);

			expect(statusField).toBeNull();
		});

		it('getStatusField returns null when the Status field has no options', async () => {
			fetchMock.mockResolvedValue(projectWithFields([{ id: 'F_status', name: 'Status' }]));

			const statusField = await withGitHubProjectsCredentials({ token: 't' }, () =>
				getStatusField('PVT_project'),
			);

			expect(statusField).toBeNull();
		});

		it('resolveStatusOptionName returns the matching option name', async () => {
			fetchMock.mockResolvedValue(
				projectWithFields([
					{ id: 'F_status', name: 'Status', options: [{ id: 'opt-done', name: 'Done' }] },
				]),
			);

			const name = await withGitHubProjectsCredentials({ token: 't' }, () =>
				resolveStatusOptionName('PVT_project', 'opt-done'),
			);

			expect(name).toBe('Done');
		});

		it('resolveStatusOptionName returns null when the option id is not found', async () => {
			fetchMock.mockResolvedValue(
				projectWithFields([
					{ id: 'F_status', name: 'Status', options: [{ id: 'opt-done', name: 'Done' }] },
				]),
			);

			const name = await withGitHubProjectsCredentials({ token: 't' }, () =>
				resolveStatusOptionName('PVT_project', 'opt-missing'),
			);

			expect(name).toBeNull();
		});

		it('resolveStatusOptionName returns null when there is no Status field at all', async () => {
			fetchMock.mockResolvedValue(projectWithFields([{ id: 'F_1', name: 'Title' }]));

			const name = await withGitHubProjectsCredentials({ token: 't' }, () =>
				resolveStatusOptionName('PVT_project', 'opt-done'),
			);

			expect(name).toBeNull();
		});

		it('moveProjectItemToStatus throws when the project has no Status field', async () => {
			fetchMock.mockResolvedValue(projectWithFields([{ id: 'F_1', name: 'Title' }]));

			await expect(
				withGitHubProjectsCredentials({ token: 't' }, () =>
					moveProjectItemToStatus('PVT_project', 'PVTI_1', 'opt-done'),
				),
			).rejects.toThrow(/Project PVT_project does not have a Status field/);
		});

		it('moveProjectItemToStatus resolves the Status field then writes the option and logs', async () => {
			fetchMock
				.mockResolvedValueOnce(
					projectWithFields([
						{
							id: 'F_status',
							name: 'Status',
							options: [{ id: 'opt-done', name: 'Done' }],
						},
					]),
				)
				.mockResolvedValueOnce(
					graphqlResponse({ updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_1' } } }),
				);

			await withGitHubProjectsCredentials({ token: 't' }, () =>
				moveProjectItemToStatus('PVT_project', 'PVTI_1', 'opt-done'),
			);

			expect(fetchMock).toHaveBeenCalledTimes(2);
			const [, secondInit] = fetchMock.mock.calls[1];
			const parsed = JSON.parse((secondInit as { body: string }).body);
			expect(parsed.variables).toEqual({
				projectId: 'PVT_project',
				itemId: 'PVTI_1',
				fieldId: 'F_status',
				optionId: 'opt-done',
			});
			expect(logger.debug).toHaveBeenCalledWith(
				'[GitHubProjects] Moved item to status',
				expect.objectContaining({
					projectId: 'PVT_project',
					itemId: 'PVTI_1',
					statusOptionId: 'opt-done',
				}),
			);
		});
	});
});
