/**
 * GitHub Projects GraphQL API client.
 *
 * Uses GitHub GraphQL API v4. Auth: Authorization: Bearer <token>.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { githubAuthHeader } from '../integrations/pm/_shared/auth-headers.js';
import { logger } from '../utils/logging.js';
import type {
	GitHubIssueComment,
	GitHubProject,
	GitHubProjectField,
	GitHubProjectItem,
	GitHubProjectItemsPage,
	GitHubProjectsCredentials,
	GitHubWorkItemContent,
} from './types.js';

const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';

const githubCredentialStore = new AsyncLocalStorage<GitHubProjectsCredentials>();

export function withGitHubProjectsCredentials<T>(
	creds: GitHubProjectsCredentials,
	fn: () => Promise<T>,
): Promise<T> {
	return githubCredentialStore.run(creds, fn);
}

export function getGitHubProjectsCredentials(): GitHubProjectsCredentials {
	const scoped = githubCredentialStore.getStore();
	if (!scoped) {
		throw new Error(
			'No GitHub Projects credentials in scope. Wrap the call with withGitHubProjectsCredentials().',
		);
	}
	return scoped;
}

/**
 * Download an image referenced in an issue/PR body. GitHub-hosted attachments
 * (e.g. private-user-images.githubusercontent.com, user-attachments/assets)
 * may require the bearer token for private repositories. The response
 * `Content-Type` is the authoritative MIME per the spec-016 image contract.
 *
 * Returns null (never throws) so the shared download loop can record a failure
 * without aborting the other images.
 */
export async function downloadImage(
	url: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
	const { token } = getGitHubProjectsCredentials();

	const response = await fetch(url, {
		headers: {
			...githubAuthHeader(token),
		},
	});

	if (!response.ok) {
		logger.warn('[GitHubProjects] Image download failed', { status: response.status });
		return null;
	}

	const arrayBuffer = await response.arrayBuffer();
	const mimeType = response.headers.get('content-type') ?? 'application/octet-stream';
	return { buffer: Buffer.from(arrayBuffer), mimeType };
}

interface GraphQLResponse<T> {
	data?: T;
	errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

export async function githubGraphQL<T>(
	query: string,
	variables?: Record<string, unknown>,
): Promise<T> {
	const { token } = getGitHubProjectsCredentials();

	const response = await fetch(GITHUB_GRAPHQL_URL, {
		method: 'POST',
		headers: {
			...githubAuthHeader(token),
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ query, variables }),
	});

	if (!response.ok) {
		const body = await response.text().catch(() => '<no body>');
		throw new Error(`GitHub GraphQL HTTP error ${response.status}: ${body}`);
	}

	const json = (await response.json()) as GraphQLResponse<T>;

	if (json.errors && json.errors.length > 0) {
		const messages = json.errors.map((e) => e.message).join('; ');
		throw new Error(`GitHub GraphQL error: ${messages}`);
	}

	if (json.data === undefined) {
		throw new Error('GitHub GraphQL returned no data');
	}

	return json.data;
}

// ============================================================================
// Project queries
// ============================================================================

export async function getProject(projectId: string): Promise<GitHubProject> {
	const query = `
		query GetProject($projectId: ID!) {
			node(id: $projectId) {
				... on ProjectV2 {
					id
					number
					title
					url
					fields(first: 100) {
						nodes {
							... on ProjectV2Field {
								id
								name
							}
							... on ProjectV2SingleSelectField {
								id
								name
								options {
									id
									name
									color
								}
							}
						}
					}
				}
			}
		}
	`;

	const data = await githubGraphQL<{ node: GitHubProject }>(query, { projectId });
	return data.node;
}

export async function getProjectFields(projectId: string): Promise<GitHubProjectField[]> {
	const project = await getProject(projectId);
	return project.fields?.nodes ?? [];
}

export async function getProjectItem(itemId: string): Promise<GitHubProjectItem> {
	const query = `
		query GetProjectItem($itemId: ID!) {
			node(id: $itemId) {
				... on ProjectV2Item {
					id
					project {
						id
						number
					}
					content {
						__typename
						... on Issue {
							id
							number
							title
							body
							url
							state
						}
						... on PullRequest {
							id
							number
							title
							body
							url
							state
						}
					}
					fieldValues(first: 100) {
						nodes {
							... on ProjectV2ItemFieldSingleSelectValue {
								id
								name
								optionId
								field {
									... on ProjectV2SingleSelectField {
										id
										name
									}
								}
							}
						}
					}
				}
			}
		}
	`;

	const data = await githubGraphQL<{ node: GitHubProjectItem }>(query, { itemId });
	return normalizeProjectItemContent(data.node);
}

/**
 * GraphQL exposes the content kind via `__typename` ('Issue' | 'PullRequest');
 * normalize it onto the discriminant `type` field the adapter branches on.
 * Without this, `content.type` is undefined and PR-backed items are treated as
 * issues (wrong mutation → GraphQL error).
 */
function normalizeProjectItemContent(node: GitHubProjectItem): GitHubProjectItem {
	if (node.content) {
		node.content.type = node.content.__typename === 'PullRequest' ? 'pull_request' : 'issue';
	}
	return node;
}

// The item shape shared by `getProjectItem` and the `items` connection in
// `getProjectItems`, factored out so both queries stay in sync.
const PROJECT_ITEM_FIELDS = `
	id
	content {
		__typename
		... on Issue {
			id
			number
			title
			body
			url
			state
		}
		... on PullRequest {
			id
			number
			title
			body
			url
			state
		}
	}
	fieldValues(first: 20) {
		nodes {
			... on ProjectV2ItemFieldSingleSelectValue {
				id
				name
				optionId
				field {
					... on ProjectV2SingleSelectField {
						id
						name
					}
				}
			}
		}
	}
`;

/**
 * Fetch one page of a project's items. GitHub Projects v2 exposes no
 * server-side field filter, so callers filter by Status client-side.
 */
export async function getProjectItems(
	projectId: string,
	opts?: { first?: number; after?: string },
): Promise<GitHubProjectItemsPage> {
	const query = `
		query GetProjectItems($projectId: ID!, $first: Int!, $after: String) {
			node(id: $projectId) {
				... on ProjectV2 {
					items(first: $first, after: $after) {
						nodes {
							${PROJECT_ITEM_FIELDS}
						}
						pageInfo {
							hasNextPage
							endCursor
						}
					}
				}
			}
		}
	`;

	const data = await githubGraphQL<{ node: { items: GitHubProjectItemsPage } | null }>(query, {
		projectId,
		first: opts?.first ?? 100,
		after: opts?.after ?? null,
	});

	const items = data.node?.items;
	if (!items) return { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };

	items.nodes = items.nodes.map(normalizeProjectItemContent);
	return items;
}

/**
 * Fetch all of a project's items, paginating up to `maxItems`. Emits a warn
 * (never silently truncates) if the cap is hit while more pages remain.
 */
export async function listAllProjectItems(
	projectId: string,
	opts?: { pageSize?: number; maxItems?: number },
): Promise<GitHubProjectItem[]> {
	const pageSize = opts?.pageSize ?? 100;
	const maxItems = opts?.maxItems ?? 1000;

	const all: GitHubProjectItem[] = [];
	let after: string | undefined;

	while (all.length < maxItems) {
		const page = await getProjectItems(projectId, { first: pageSize, after });
		all.push(...page.nodes);
		if (!page.pageInfo.hasNextPage) return all;
		if (all.length >= maxItems) {
			logger.warn('[GitHubProjects] listAllProjectItems hit item cap; results truncated', {
				projectId,
				maxItems,
				fetched: all.length,
			});
			return all.slice(0, maxItems);
		}
		after = page.pageInfo.endCursor ?? undefined;
		if (!after) return all;
	}
	return all;
}

interface RawContentNode {
	__typename?: string;
	id: string;
	number: number;
	title: string;
	body: string;
	url: string;
	state: string;
	projectItems?: {
		nodes: Array<{
			project?: { id: string };
			fieldValues?: {
				nodes: Array<{
					optionId?: string;
					name?: string;
					field?: { id: string; name: string };
				}>;
			};
		}>;
	};
}

/**
 * Resolve an Issue/PR directly from its *content* node ID (the work-item ID used
 * throughout the github-projects path), and — when `projectId` is given — its
 * Status option in that project via the content node's `projectItems` connection.
 *
 * This is distinct from `getProjectItem`, which starts from a `ProjectV2Item`
 * node ID. Callers holding a content node ID (`getWorkItem`, `updateWorkItem`)
 * must use this: `node(<contentId>)` resolves to an Issue/PullRequest, so a
 * `... on ProjectV2Item` query would never match and would drop `content`.
 */
export async function getContentNode(
	contentId: string,
	projectId?: string,
): Promise<GitHubWorkItemContent> {
	const contentFields = `
		id
		number
		title
		body
		url
		state
		projectItems(first: 20) {
			nodes {
				project { id }
				fieldValues(first: 20) {
					nodes {
						... on ProjectV2ItemFieldSingleSelectValue {
							optionId
							name
							field {
								... on ProjectV2SingleSelectField {
									id
									name
								}
							}
						}
					}
				}
			}
		}
	`;
	const query = `
		query GetContentNode($id: ID!) {
			node(id: $id) {
				__typename
				... on Issue { ${contentFields} }
				... on PullRequest { ${contentFields} }
			}
		}
	`;

	const data = await githubGraphQL<{ node: RawContentNode | null }>(query, { id: contentId });
	const node = data.node;
	if (!node || (node.__typename !== 'Issue' && node.__typename !== 'PullRequest')) {
		throw new Error(
			`GitHub Projects content node ${contentId} did not resolve to an Issue or PullRequest`,
		);
	}

	let statusName: string | undefined;
	let statusOptionId: string | undefined;
	if (projectId) {
		const projectItem = node.projectItems?.nodes.find((n) => n.project?.id === projectId);
		const statusValue = projectItem?.fieldValues?.nodes.find((v) => v.field?.name === 'Status');
		statusName = statusValue?.name;
		statusOptionId = statusValue?.optionId;
	}

	return {
		id: node.id,
		number: node.number,
		title: node.title,
		body: node.body,
		url: node.url,
		state: node.state,
		type: node.__typename === 'PullRequest' ? 'pull_request' : 'issue',
		statusName,
		statusOptionId,
	};
}

/**
 * Fetch comments on the Issue or Pull Request backing a project item. `id` is
 * the content node ID (the same value used as the work-item ID throughout the
 * github-projects path).
 */
export async function getIssueComments(id: string, first = 100): Promise<GitHubIssueComment[]> {
	const query = `
		query GetIssueComments($id: ID!, $first: Int!) {
			node(id: $id) {
				... on Issue {
					comments(first: $first) {
						nodes {
							id
							body
							createdAt
							updatedAt
							author {
								login
								... on User {
									id
									name
								}
							}
						}
					}
				}
				... on PullRequest {
					comments(first: $first) {
						nodes {
							id
							body
							createdAt
							updatedAt
							author {
								login
								... on User {
									id
									name
								}
							}
						}
					}
				}
			}
		}
	`;

	const data = await githubGraphQL<{
		node: { comments?: { nodes: GitHubIssueComment[] } } | null;
	}>(query, { id, first });

	return data.node?.comments?.nodes ?? [];
}

// ============================================================================
// Labels
// ============================================================================

/**
 * Resolve a label *name* to its node ID within the repository that owns the
 * content node (`contentId` is the Issue/PR node ID). GitHub labels are
 * repo-scoped, so the same name has a different node ID per repository — hence
 * we resolve against the content's own repo at call time. Returns `null` when
 * the repository has no label with that name.
 */
export async function resolveContentRepoLabelId(
	contentId: string,
	labelName: string,
): Promise<string | null> {
	const query = `
		query ResolveRepoLabel($id: ID!, $name: String!) {
			node(id: $id) {
				... on Issue {
					repository { label(name: $name) { id } }
				}
				... on PullRequest {
					repository { label(name: $name) { id } }
				}
			}
		}
	`;

	const data = await githubGraphQL<{
		node: { repository?: { label?: { id: string } | null } } | null;
	}>(query, { id: contentId, name: labelName });

	return data.node?.repository?.label?.id ?? null;
}

/**
 * Add labels to an Issue/PR (both implement `Labelable`). `labelableId` is the
 * content node ID; `labelIds` are repo-scoped label node IDs.
 */
export async function addLabelsToContent(labelableId: string, labelIds: string[]): Promise<void> {
	const mutation = `
		mutation AddLabels($labelableId: ID!, $labelIds: [ID!]!) {
			addLabelsToLabelable(input: { labelableId: $labelableId, labelIds: $labelIds }) {
				clientMutationId
			}
		}
	`;
	await githubGraphQL(mutation, { labelableId, labelIds });
}

/**
 * Remove labels from an Issue/PR. `labelableId` is the content node ID;
 * `labelIds` are repo-scoped label node IDs.
 */
export async function removeLabelsFromContent(
	labelableId: string,
	labelIds: string[],
): Promise<void> {
	const mutation = `
		mutation RemoveLabels($labelableId: ID!, $labelIds: [ID!]!) {
			removeLabelsFromLabelable(input: { labelableId: $labelableId, labelIds: $labelIds }) {
				clientMutationId
			}
		}
	`;
	await githubGraphQL(mutation, { labelableId, labelIds });
}

// ============================================================================
// Work-item creation
// ============================================================================

/**
 * Resolve a repository's node ID from its `owner`/`name`. Needed by
 * `createRepositoryIssue`, whose `createIssue` mutation takes a `repositoryId`.
 * Throws when the repo is not found or not visible to the configured token.
 */
export async function getRepositoryId(owner: string, name: string): Promise<string> {
	const query = `
		query GetRepositoryId($owner: String!, $name: String!) {
			repository(owner: $owner, name: $name) { id }
		}
	`;
	const data = await githubGraphQL<{ repository: { id: string } | null }>(query, { owner, name });
	if (!data.repository?.id) {
		throw new Error(
			`GitHub repository ${owner}/${name} not found or not accessible with the configured token`,
		);
	}
	return data.repository.id;
}

/**
 * Create a real GitHub Issue in a repository and return its content node ID,
 * number, and URL. GitHub Projects has no first-class "create item" that yields
 * a commentable/labelable work item; we create an Issue (which does) and then add
 * it to the project via `addContentToProject`.
 */
export async function createRepositoryIssue(
	repositoryId: string,
	title: string,
	body: string,
): Promise<{ id: string; number: number; url: string }> {
	const mutation = `
		mutation CreateIssue($repositoryId: ID!, $title: String!, $body: String) {
			createIssue(input: { repositoryId: $repositoryId, title: $title, body: $body }) {
				issue { id number url }
			}
		}
	`;
	const data = await githubGraphQL<{
		createIssue: { issue: { id: string; number: number; url: string } };
	}>(mutation, { repositoryId, title, body });
	return data.createIssue.issue;
}

/**
 * Add an existing Issue/PR (by content node ID) to a project and return the new
 * ProjectV2Item node ID.
 */
export async function addContentToProject(projectId: string, contentId: string): Promise<string> {
	const mutation = `
		mutation AddProjectItem($projectId: ID!, $contentId: ID!) {
			addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
				item { id }
			}
		}
	`;
	const data = await githubGraphQL<{ addProjectV2ItemById: { item: { id: string } } }>(mutation, {
		projectId,
		contentId,
	});
	return data.addProjectV2ItemById.item.id;
}

/**
 * Resolve the ProjectV2Item node ID for a content (Issue/PR) node within a given
 * project. `updateProjectV2ItemFieldValue` (status writes) requires the
 * ProjectV2Item ID, but the work-item ID carried across the github-projects path
 * is the *content* node ID — so a status move must resolve the item ID first.
 * Returns `null` when the content is not part of the project.
 */
export async function resolveProjectItemId(
	contentId: string,
	projectId: string,
): Promise<string | null> {
	const projectItems = `projectItems(first: 20) { nodes { id project { id } } }`;
	const query = `
		query ResolveProjectItem($id: ID!) {
			node(id: $id) {
				... on Issue { ${projectItems} }
				... on PullRequest { ${projectItems} }
			}
		}
	`;
	const data = await githubGraphQL<{
		node: { projectItems?: { nodes: Array<{ id: string; project?: { id: string } }> } } | null;
	}>(query, { id: contentId });
	const items = data.node?.projectItems?.nodes ?? [];
	return items.find((n) => n.project?.id === projectId)?.id ?? null;
}

// ============================================================================
// Mutations
// ============================================================================

export async function updateProjectItemField(
	projectId: string,
	itemId: string,
	fieldId: string,
	optionId: string,
): Promise<void> {
	const mutation = `
		mutation UpdateProjectV2ItemFieldValue(
			$projectId: ID!
			$itemId: ID!
			$fieldId: ID!
			$optionId: String!
		) {
			updateProjectV2ItemFieldValue(input: {
				projectId: $projectId
				itemId: $itemId
				fieldId: $fieldId
				value: { singleSelectOptionId: $optionId }
			}) {
				projectV2Item {
					id
				}
			}
		}
	`;

	await githubGraphQL(mutation, { projectId, itemId, fieldId, optionId });
}

export async function addCommentToIssue(issueId: string, body: string): Promise<string> {
	const mutation = `
		mutation AddComment($subjectId: ID!, $body: String!) {
			addComment(input: { subjectId: $subjectId, body: $body }) {
				commentEdge {
					node {
						id
					}
				}
			}
		}
	`;

	const data = await githubGraphQL<{ addComment: { commentEdge: { node: { id: string } } } }>(
		mutation,
		{ subjectId: issueId, body },
	);
	return data.addComment.commentEdge.node.id;
}

export async function updateComment(commentId: string, body: string): Promise<void> {
	const mutation = `
		mutation UpdateComment($commentId: ID!, $body: String!) {
			updateIssueComment(input: { id: $commentId, body: $body }) {
				issueComment {
					id
				}
			}
		}
	`;
	await githubGraphQL(mutation, { commentId, body });
}

export async function deleteComment(commentId: string): Promise<void> {
	const mutation = `
		mutation DeleteComment($commentId: ID!) {
			deleteIssueComment(input: { id: $commentId }) {
				clientMutationId
			}
		}
	`;
	await githubGraphQL(mutation, { commentId });
}

// ============================================================================
// Discovery queries
// ============================================================================

export async function getUserProjects(login: string): Promise<GitHubProject[]> {
	const query = `
		query GetUserProjects($login: String!) {
			user(login: $login) {
				projectsV2(first: 100) {
					nodes {
						id
						number
						title
						url
					}
				}
			}
		}
	`;

	const data = await githubGraphQL<{ user: { projectsV2: { nodes: GitHubProject[] } } }>(query, {
		login,
	});
	return data.user.projectsV2.nodes;
}

export async function getOrganizationProjects(org: string): Promise<GitHubProject[]> {
	const query = `
		query GetOrgProjects($org: String!) {
			organization(login: $org) {
				projectsV2(first: 100) {
					nodes {
						id
						number
						title
						url
					}
				}
			}
		}
	`;

	const data = await githubGraphQL<{ organization: { projectsV2: { nodes: GitHubProject[] } } }>(
		query,
		{ org },
	);
	return data.organization.projectsV2.nodes;
}

export async function getViewer(): Promise<{ id: string; login: string; name?: string }> {
	const query = `
		query GetViewer {
			viewer {
				id
				login
				name
			}
		}
	`;

	const data = await githubGraphQL<{ viewer: { id: string; login: string; name?: string } }>(query);
	return data.viewer;
}

/**
 * List the organizations the authenticated viewer belongs to (login only).
 *
 * Used by the wizard's owner picker so operators can configure an
 * organization-owned project (whose `projects_v2_item` webhook can be created
 * programmatically). Listing org memberships needs the `read:org` scope, which
 * a token scoped only for personal Projects may lack — so this is deliberately
 * error-tolerant: on any failure it logs a warn and returns `[]` rather than
 * throwing, keeping the critical `getViewer`/login resolution (and thus the
 * user-owner path) working even without org visibility.
 */
export async function getViewerOrganizations(): Promise<Array<{ login: string }>> {
	const query = `
		query GetViewerOrganizations {
			viewer {
				organizations(first: 100) {
					nodes {
						login
					}
				}
			}
		}
	`;

	try {
		const data = await githubGraphQL<{
			viewer: { organizations: { nodes: Array<{ login: string }> } };
		}>(query);
		return data.viewer.organizations.nodes.filter((o) => Boolean(o?.login));
	} catch (err) {
		logger.warn('[GitHubProjects] Could not list viewer organizations (read:org scope?)', {
			error: err instanceof Error ? err.message : String(err),
		});
		return [];
	}
}

// ============================================================================
// Status field helpers
// ============================================================================

/**
 * Find the ProjectV2SingleSelectField named "Status" and return its id + options.
 */
export async function getStatusField(
	projectId: string,
): Promise<{ id: string; options: Array<{ id: string; name: string; color?: string }> } | null> {
	const fields = await getProjectFields(projectId);
	const statusField = fields.find((f) => f.name === 'Status');
	if (!statusField?.options) return null;
	return { id: statusField.id, options: statusField.options };
}

/**
 * Resolve the option name for a given option ID within the Status field.
 */
export async function resolveStatusOptionName(
	projectId: string,
	optionId: string,
): Promise<string | null> {
	const statusField = await getStatusField(projectId);
	if (!statusField) return null;
	return statusField.options.find((o) => o.id === optionId)?.name ?? null;
}

/**
 * Update the Status field of a project item. Throws if the Status field is missing
 * or the destination cannot be resolved.
 */
export async function moveProjectItemToStatus(
	projectId: string,
	itemId: string,
	statusOptionId: string,
): Promise<void> {
	const statusField = await getStatusField(projectId);
	if (!statusField) {
		throw new Error(`Project ${projectId} does not have a Status field`);
	}
	await updateProjectItemField(projectId, itemId, statusField.id, statusOptionId);
	logger.debug('[GitHubProjects] Moved item to status', { projectId, itemId, statusOptionId });
}
