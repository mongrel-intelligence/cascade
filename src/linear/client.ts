/**
 * Linear GraphQL API client.
 *
 * Same AsyncLocalStorage pattern as the Trello and JIRA clients — credentials
 * are scoped per-request via withLinearCredentials().
 *
 * API endpoint: https://api.linear.app/graphql
 * Auth: Authorization: <api_key>  (personal API keys are sent bare; `Bearer`
 * is OAuth-only and triggers HTTP 400 with personal keys.)
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { logger } from '../utils/logging.js';
import type {
	LinearAttachment,
	LinearComment,
	LinearCreateIssueInput,
	LinearCredentials,
	LinearIssue,
	LinearLabel,
	LinearProject,
	LinearReaction,
	LinearTeam,
	LinearUpdateIssueInput,
	LinearUser,
	LinearWorkflowState,
} from './types.js';

const LINEAR_API_URL = 'https://api.linear.app/graphql';

const linearCredentialStore = new AsyncLocalStorage<LinearCredentials>();

export function withLinearCredentials<T>(
	creds: LinearCredentials,
	fn: () => Promise<T>,
): Promise<T> {
	return linearCredentialStore.run(creds, fn);
}

export function getLinearCredentials(): LinearCredentials {
	const scoped = linearCredentialStore.getStore();
	if (!scoped) {
		throw new Error(
			'No Linear credentials in scope. Wrap the call with withLinearCredentials() or ensure per-project LINEAR_API_KEY is set in the database.',
		);
	}
	return scoped;
}

// ============================================================================
// Core GraphQL fetch helper
// ============================================================================

interface GraphQLResponse<T> {
	data?: T;
	errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

async function linearGraphQL<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
	const { apiKey } = getLinearCredentials();

	const response = await fetch(LINEAR_API_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: apiKey,
		},
		body: JSON.stringify({ query, variables }),
	});

	if (!response.ok) {
		const body = await response.text().catch(() => '<no body>');
		throw new Error(`Linear API HTTP error ${response.status}: ${body}`);
	}

	const json = (await response.json()) as GraphQLResponse<T>;

	if (json.errors && json.errors.length > 0) {
		const messages = json.errors.map((e) => e.message).join('; ');
		throw new Error(`Linear API error: ${messages}`);
	}

	if (json.data === undefined) {
		throw new Error('Linear API returned no data');
	}

	return json.data;
}

// ============================================================================
// Response mappers
// ============================================================================

function mapUser(
	u:
		| {
				id?: string;
				name?: string;
				email?: string;
				displayName?: string;
				avatarUrl?: string | null;
				active?: boolean;
		  }
		| null
		| undefined,
): LinearUser | null {
	if (!u) return null;
	return {
		id: u.id ?? '',
		name: u.name ?? '',
		email: u.email ?? '',
		displayName: u.displayName ?? u.name ?? '',
		avatarUrl: u.avatarUrl ?? null,
		active: u.active ?? true,
	};
}

function mapLabel(l: {
	id?: string;
	name?: string;
	color?: string;
	description?: string | null;
}): LinearLabel {
	return {
		id: l.id ?? '',
		name: l.name ?? '',
		color: l.color ?? '',
		description: l.description ?? null,
	};
}

interface RawIssue {
	id?: string;
	identifier?: string;
	title?: string;
	description?: string | null;
	priority?: number;
	priorityLabel?: string;
	state?: { id?: string; name?: string; type?: string; color?: string } | null;
	team?: { id?: string; name?: string; key?: string; description?: string | null } | null;
	assignee?: {
		id?: string;
		name?: string;
		email?: string;
		displayName?: string;
		avatarUrl?: string | null;
		active?: boolean;
	} | null;
	labels?: {
		nodes?: Array<{ id?: string; name?: string; color?: string; description?: string | null }>;
	};
	url?: string;
	createdAt?: string;
	updatedAt?: string;
}

function mapState(state: RawIssue['state']) {
	return {
		id: state?.id ?? '',
		name: state?.name ?? '',
		type: state?.type ?? '',
		color: state?.color ?? '',
	};
}

function mapTeam(team: RawIssue['team']) {
	return {
		id: team?.id ?? '',
		name: team?.name ?? '',
		key: team?.key ?? '',
		description: team?.description ?? null,
	};
}

function mapIssue(issue: RawIssue): LinearIssue {
	return {
		id: issue.id ?? '',
		identifier: issue.identifier ?? '',
		title: issue.title ?? '',
		description: issue.description ?? null,
		priority: issue.priority ?? 0,
		priorityLabel: issue.priorityLabel ?? 'No priority',
		state: mapState(issue.state),
		team: mapTeam(issue.team),
		assignee: mapUser(issue.assignee),
		labels: (issue.labels?.nodes ?? []).map(mapLabel),
		url: issue.url ?? '',
		createdAt: issue.createdAt ?? '',
		updatedAt: issue.updatedAt ?? '',
	};
}

interface RawComment {
	id?: string;
	body?: string;
	user?: {
		id?: string;
		name?: string;
		email?: string;
		displayName?: string;
		avatarUrl?: string | null;
		active?: boolean;
	} | null;
	createdAt?: string;
	updatedAt?: string;
	issue?: { id?: string };
}

function mapComment(c: RawComment): LinearComment {
	return {
		id: c.id ?? '',
		body: c.body ?? '',
		user: mapUser(c.user),
		createdAt: c.createdAt ?? '',
		updatedAt: c.updatedAt ?? '',
		issueId: c.issue?.id ?? '',
	};
}

// ============================================================================
// GraphQL fragments
// ============================================================================

const USER_FIELDS = `
	id
	name
	email
	displayName
	avatarUrl
	active
`;

const LABEL_FIELDS = `
	id
	name
	color
	description
`;

const STATE_FIELDS = `
	id
	name
	type
	color
`;

const TEAM_FIELDS = `
	id
	name
	key
	description
`;

const PROJECT_FIELDS = `
	id
	name
	icon
	color
`;

const ISSUE_FIELDS = `
	id
	identifier
	title
	description
	priority
	priorityLabel
	url
	createdAt
	updatedAt
	state { ${STATE_FIELDS} }
	team { ${TEAM_FIELDS} }
	assignee { ${USER_FIELDS} }
	labels { nodes { ${LABEL_FIELDS} } }
`;

const COMMENT_FIELDS = `
	id
	body
	createdAt
	updatedAt
	user { ${USER_FIELDS} }
	issue { id }
`;

// ============================================================================
// Linear client
// ============================================================================

export const linearClient = {
	// ===== Issues =====

	async getIssue(issueId: string): Promise<LinearIssue> {
		logger.debug('Fetching Linear issue', { issueId });
		const data = await linearGraphQL<{ issue: unknown }>(
			`query GetIssue($id: String!) {
				issue(id: $id) {
					${ISSUE_FIELDS}
				}
			}`,
			{ id: issueId },
		);
		return mapIssue(data.issue as RawIssue);
	},

	async getIssueProjectId(issueId: string): Promise<string | null> {
		logger.debug('Fetching Linear issue project', { issueId });
		const data = await linearGraphQL<{ issue: { project?: { id?: string } | null } | null }>(
			`query GetIssueProject($id: String!) {
				issue(id: $id) {
					project {
						id
					}
				}
			}`,
			{ id: issueId },
		);
		return data.issue?.project?.id ?? null;
	},

	async listIssues(filter?: {
		teamId?: string;
		projectId?: string;
		assigneeId?: string;
		stateId?: string;
		first?: number;
	}): Promise<LinearIssue[]> {
		logger.debug('Listing Linear issues', { filter });

		const filterObj: Record<string, unknown> = {};
		if (filter?.teamId) filterObj.team = { id: { eq: filter.teamId } };
		if (filter?.projectId) filterObj.project = { id: { eq: filter.projectId } };
		if (filter?.assigneeId) filterObj.assignee = { id: { eq: filter.assigneeId } };
		if (filter?.stateId) filterObj.state = { id: { eq: filter.stateId } };

		const data = await linearGraphQL<{ issues: { nodes: unknown[] } }>(
			`query ListIssues($filter: IssueFilter, $first: Int) {
				issues(filter: $filter, first: $first) {
					nodes {
						${ISSUE_FIELDS}
					}
				}
			}`,
			{
				filter: Object.keys(filterObj).length > 0 ? filterObj : undefined,
				first: filter?.first ?? 50,
			},
		);
		return (data.issues.nodes as RawIssue[]).map(mapIssue);
	},

	async createIssue(input: LinearCreateIssueInput): Promise<LinearIssue> {
		logger.debug('Creating Linear issue', { title: input.title, teamId: input.teamId });
		const data = await linearGraphQL<{ issueCreate: { issue: unknown } }>(
			`mutation CreateIssue($input: IssueCreateInput!) {
				issueCreate(input: $input) {
					issue {
						${ISSUE_FIELDS}
					}
				}
			}`,
			{ input },
		);
		return mapIssue(data.issueCreate.issue as RawIssue);
	},

	async updateIssue(issueId: string, input: LinearUpdateIssueInput): Promise<LinearIssue> {
		logger.debug('Updating Linear issue', { issueId });
		const data = await linearGraphQL<{ issueUpdate: { issue: unknown } }>(
			`mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
				issueUpdate(id: $id, input: $input) {
					issue {
						${ISSUE_FIELDS}
					}
				}
			}`,
			{ id: issueId, input },
		);
		return mapIssue(data.issueUpdate.issue as RawIssue);
	},

	async updateIssueState(issueId: string, stateId: string): Promise<LinearIssue> {
		logger.debug('Updating Linear issue state', { issueId, stateId });
		return linearClient.updateIssue(issueId, { stateId });
	},

	// ===== Comments =====

	async getIssueComments(issueId: string): Promise<LinearComment[]> {
		logger.debug('Fetching Linear issue comments', { issueId });
		const data = await linearGraphQL<{ issue: { comments: { nodes: unknown[] } } }>(
			`query GetIssueComments($id: String!) {
				issue(id: $id) {
					comments {
						nodes {
							${COMMENT_FIELDS}
						}
					}
				}
			}`,
			{ id: issueId },
		);
		return (data.issue.comments.nodes as RawComment[]).map(mapComment);
	},

	async createComment(issueId: string, body: string): Promise<LinearComment> {
		logger.debug('Creating Linear comment', { issueId, bodyLength: body.length });
		const data = await linearGraphQL<{ commentCreate: { comment: unknown } }>(
			`mutation CreateComment($input: CommentCreateInput!) {
				commentCreate(input: $input) {
					comment {
						${COMMENT_FIELDS}
					}
				}
			}`,
			{ input: { issueId, body } },
		);
		return mapComment(data.commentCreate.comment as RawComment);
	},

	async updateComment(commentId: string, body: string): Promise<LinearComment> {
		logger.debug('Updating Linear comment', { commentId, bodyLength: body.length });
		const data = await linearGraphQL<{ commentUpdate: { comment: unknown } }>(
			`mutation UpdateComment($id: String!, $input: CommentUpdateInput!) {
				commentUpdate(id: $id, input: $input) {
					comment {
						${COMMENT_FIELDS}
					}
				}
			}`,
			{ id: commentId, input: { body } },
		);
		return mapComment(data.commentUpdate.comment as RawComment);
	},

	async deleteComment(commentId: string): Promise<void> {
		logger.debug('Deleting Linear comment', { commentId });
		const data = await linearGraphQL<{ commentDelete: { success: boolean } }>(
			`mutation DeleteComment($id: String!) {
				commentDelete(id: $id) {
					success
				}
			}`,
			{ id: commentId },
		);
		if (!data.commentDelete.success) {
			throw new Error(`Linear API: failed to delete comment ${commentId}`);
		}
	},

	// ===== Labels =====

	async addLabel(issueId: string, labelId: string): Promise<LinearIssue> {
		logger.debug('Adding label to Linear issue', { issueId, labelId });
		// NOTE: Linear's API has no atomic add-label endpoint, so we use a
		// read-then-update pattern. This is subject to a TOCTOU race: two
		// concurrent addLabel/removeLabel calls on the same issue can overwrite
		// each other's changes. This is a known API limitation.
		const issue = await linearClient.getIssue(issueId);
		const currentLabelIds = issue.labels.map((l) => l.id);
		if (currentLabelIds.includes(labelId)) {
			return issue;
		}
		return linearClient.updateIssue(issueId, { labelIds: [...currentLabelIds, labelId] });
	},

	async removeLabel(issueId: string, labelId: string): Promise<LinearIssue> {
		logger.debug('Removing label from Linear issue', { issueId, labelId });
		// NOTE: Linear's API has no atomic remove-label endpoint, so we use a
		// read-then-update pattern. This is subject to a TOCTOU race: two
		// concurrent addLabel/removeLabel calls on the same issue can overwrite
		// each other's changes. This is a known API limitation.
		const issue = await linearClient.getIssue(issueId);
		const updatedLabelIds = issue.labels.map((l) => l.id).filter((id) => id !== labelId);
		return linearClient.updateIssue(issueId, { labelIds: updatedLabelIds });
	},

	async createLabel(
		teamId: string,
		name: string,
		color?: string,
	): Promise<{ id: string; name: string; color: string }> {
		logger.debug('Creating Linear issue label', { teamId, name, color });
		const input: { teamId: string; name: string; color?: string } = { teamId, name };
		if (color) input.color = color;

		let data:
			| {
					issueLabelCreate: {
						success: boolean;
						issueLabel: { id: string; name: string; color: string } | null;
					};
			  }
			| undefined;

		try {
			data = await linearGraphQL<{
				issueLabelCreate: {
					success: boolean;
					issueLabel: { id: string; name: string; color: string } | null;
				};
			}>(
				`mutation CreateIssueLabel($input: IssueLabelCreateInput!) {
					issueLabelCreate(input: $input) {
						success
						issueLabel {
							id
							name
							color
						}
					}
				}`,
				{ input },
			);
		} catch (err) {
			// Linear rejects the mutation when a label with the same name already
			// exists in the team. Treat this as an idempotent create: fetch the
			// team's labels and return the existing one by name.
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes('duplicate label name')) {
				const existing = await linearClient.getTeamLabels(teamId);
				const found = existing.find((l) => l.name.toLowerCase() === name.toLowerCase());
				if (!found) {
					throw new Error(
						`Linear duplicate label name but label "${name}" not found in team ${teamId}`,
					);
				}
				return { id: found.id, name: found.name, color: found.color ?? '' };
			}
			throw err;
		}

		if (!data.issueLabelCreate.success || !data.issueLabelCreate.issueLabel) {
			throw new Error('Linear issueLabelCreate returned success=false');
		}
		const label = data.issueLabelCreate.issueLabel;
		return { id: label.id, name: label.name, color: label.color };
	},

	// ===== Attachments =====

	async getAttachments(issueId: string): Promise<LinearAttachment[]> {
		logger.debug('Fetching Linear attachments', { issueId });
		const data = await linearGraphQL<{
			issue: {
				attachments: {
					nodes: Array<{
						id?: string;
						title?: string;
						url?: string;
						subtitle?: string | null;
						metadata?: Record<string, unknown>;
						createdAt?: string;
						updatedAt?: string;
					}>;
				};
			};
		}>(
			`query GetAttachments($id: String!) {
				issue(id: $id) {
					attachments {
						nodes {
							id
							title
							url
							subtitle
							metadata
							createdAt
							updatedAt
						}
					}
				}
			}`,
			{ id: issueId },
		);
		return data.issue.attachments.nodes.map((a) => ({
			id: a.id ?? '',
			title: a.title ?? '',
			url: a.url ?? '',
			subtitle: a.subtitle ?? null,
			metadata: a.metadata ?? {},
			createdAt: a.createdAt ?? '',
			updatedAt: a.updatedAt ?? '',
		}));
	},

	async createAttachment(
		issueId: string,
		input: { title: string; url: string; subtitle?: string; metadata?: Record<string, unknown> },
	): Promise<LinearAttachment> {
		logger.debug('Creating Linear attachment', { issueId, title: input.title });
		const data = await linearGraphQL<{
			attachmentCreate: {
				attachment: {
					id?: string;
					title?: string;
					url?: string;
					subtitle?: string | null;
					metadata?: Record<string, unknown>;
					createdAt?: string;
					updatedAt?: string;
				};
			};
		}>(
			`mutation CreateAttachment($input: AttachmentCreateInput!) {
				attachmentCreate(input: $input) {
					attachment {
						id
						title
						url
						subtitle
						metadata
						createdAt
						updatedAt
					}
				}
			}`,
			{ input: { issueId, ...input } },
		);
		const a = data.attachmentCreate.attachment;
		return {
			id: a.id ?? '',
			title: a.title ?? '',
			url: a.url ?? '',
			subtitle: a.subtitle ?? null,
			metadata: a.metadata ?? {},
			createdAt: a.createdAt ?? '',
			updatedAt: a.updatedAt ?? '',
		};
	},

	/**
	 * Downloads a Linear-hosted image (e.g. `uploads.linear.app/…`) and
	 * returns its raw bytes and MIME type.
	 *
	 * Linear personal API keys are sent **bare** in the `Authorization` header
	 * (no `Bearer` prefix). `Content-Type` is intentionally omitted here
	 * because this is a GET download request, not a JSON API call.
	 *
	 * @param url - The attachment/inline image URL to download.
	 * @returns `{ buffer, mimeType }` on success, `null` on any failure.
	 */
	async downloadAttachment(url: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
		const { apiKey } = getLinearCredentials();
		const { downloadMedia } = await import('../pm/media.js');
		return downloadMedia(url, { Authorization: apiKey });
	},

	// ===== Reactions =====

	async createReaction(commentId: string, emoji: string): Promise<LinearReaction> {
		logger.debug('Creating Linear reaction', { commentId, emoji });
		const data = await linearGraphQL<{
			reactionCreate: {
				reaction: {
					id?: string;
					emoji?: string;
					user?: {
						id?: string;
						name?: string;
						email?: string;
						displayName?: string;
						avatarUrl?: string | null;
						active?: boolean;
					} | null;
					createdAt?: string;
				};
			};
		}>(
			`mutation CreateReaction($input: ReactionCreateInput!) {
				reactionCreate(input: $input) {
					reaction {
						id
						emoji
						createdAt
						user { ${USER_FIELDS} }
					}
				}
			}`,
			{ input: { commentId, emoji } },
		);
		const r = data.reactionCreate.reaction;
		return {
			id: r.id ?? '',
			emoji: r.emoji ?? '',
			user: mapUser(r.user),
			createdAt: r.createdAt ?? '',
		};
	},

	// ===== Discovery =====

	async getTeams(): Promise<LinearTeam[]> {
		logger.debug('Fetching Linear teams');
		const data = await linearGraphQL<{ teams: { nodes: unknown[] } }>(
			`query GetTeams {
				teams {
					nodes {
						${TEAM_FIELDS}
					}
				}
			}`,
		);
		return (data.teams.nodes as RawIssue['team'][]).map(mapTeam);
	},

	async getTeamWorkflowStates(teamId: string): Promise<LinearWorkflowState[]> {
		logger.debug('Fetching Linear team workflow states', { teamId });
		const data = await linearGraphQL<{
			team: { states: { nodes: unknown[] } };
		}>(
			`query GetTeamWorkflowStates($id: String!) {
				team(id: $id) {
					states {
						nodes {
							${STATE_FIELDS}
						}
					}
				}
			}`,
			{ id: teamId },
		);
		return (
			data.team.states.nodes as Array<{
				id?: string;
				name?: string;
				type?: string;
				color?: string;
			}>
		).map(mapState);
	},

	async getTeamLabels(teamId: string): Promise<LinearLabel[]> {
		logger.debug('Fetching Linear team labels', { teamId });
		const data = await linearGraphQL<{
			team: { labels: { nodes: unknown[] } };
		}>(
			`query GetTeamLabels($id: String!) {
				team(id: $id) {
					labels {
						nodes {
							${LABEL_FIELDS}
						}
					}
				}
			}`,
			{ id: teamId },
		);
		return (
			data.team.labels.nodes as Array<{
				id?: string;
				name?: string;
				color?: string;
				description?: string | null;
			}>
		).map(mapLabel);
	},

	async getTeamProjects(teamId: string, first = 250): Promise<LinearProject[]> {
		logger.debug('Fetching Linear team projects', { teamId, first });
		const data = await linearGraphQL<{
			team: { projects: { nodes: unknown[] } } | null;
		}>(
			`query GetTeamProjects($id: String!, $first: Int) {
				team(id: $id) {
					projects(first: $first) {
						nodes {
							${PROJECT_FIELDS}
						}
					}
				}
			}`,
			{ id: teamId, first },
		);
		const nodes = (data.team?.projects.nodes ?? []) as Array<{
			id?: string;
			name?: string;
			icon?: string | null;
			color?: string | null;
		}>;
		return nodes.map((n) => ({
			id: n.id ?? '',
			name: n.name ?? '',
			icon: n.icon ?? null,
			color: n.color ?? null,
		}));
	},

	// ===== User =====

	async getMe(): Promise<LinearUser> {
		logger.debug('Fetching authenticated Linear user');
		const data = await linearGraphQL<{ viewer: unknown }>(
			`query GetMe {
				viewer {
					${USER_FIELDS}
				}
			}`,
		);
		const user = mapUser(data.viewer as Parameters<typeof mapUser>[0]);
		if (!user) {
			throw new Error('Linear viewer returned null');
		}
		return user;
	},
};
