/**
 * GitHub Projects v2 types.
 */

export interface GitHubProjectsCredentials {
	token: string;
}

export interface GitHubProject {
	id: string;
	number: number;
	title: string;
	url: string;
	fields?: {
		nodes: GitHubProjectField[];
	};
}

export interface GitHubProjectField {
	id: string;
	name: string;
	options?: Array<{
		id: string;
		name: string;
		color?: string;
	}>;
}

export interface GitHubProjectItem {
	id: string;
	project: {
		id: string;
		number: number;
	};
	content?: GitHubProjectContent;
	fieldValues?: {
		nodes: Array<{
			id: string;
			name: string;
			/**
			 * The stable Status *option* ID (matches the IDs persisted in
			 * `GitHubProjectsConfig.statuses`). Distinct from `id`, which is the
			 * per-item field-value node ID and is NOT comparable to configured
			 * status IDs.
			 */
			optionId?: string;
			field: {
				id: string;
				name: string;
			};
		}>;
	};
}

/**
 * A project item's linked content — an Issue or a Pull Request. Both GraphQL
 * types expose the same fields we consume; `__typename` (populated from the
 * query) is normalized into the `type` discriminant by `getProjectItem`.
 */
export interface GitHubProjectContent {
	id: string;
	number: number;
	title: string;
	body: string;
	url: string;
	state: string;
	/** GraphQL `__typename`, used to derive the `type` discriminant. */
	__typename?: 'Issue' | 'PullRequest';
	type: 'issue' | 'pull_request';
}

/**
 * An Issue/PR resolved directly from its *content* node ID (the value used as
 * the work-item ID across the github-projects path), with its Status in a given
 * project resolved via the content node's `projectItems` connection. Returned by
 * `getContentNode`. Distinct from `getProjectItem`, which starts from a
 * `ProjectV2Item` node ID.
 */
export interface GitHubWorkItemContent {
	id: string;
	number: number;
	title: string;
	body: string;
	url: string;
	state: string;
	type: 'issue' | 'pull_request';
	/** Status option name/ID for the requested project, when resolvable. */
	statusName?: string;
	statusOptionId?: string;
}

/** One page of a project's items, as returned by `getProjectItems`. */
export interface GitHubProjectItemsPage {
	nodes: GitHubProjectItem[];
	pageInfo: {
		hasNextPage: boolean;
		endCursor: string | null;
	};
}

/** A comment on an Issue or Pull Request, as returned by `getIssueComments`. */
export interface GitHubIssueComment {
	id: string;
	body: string;
	createdAt: string;
	updatedAt?: string;
	author?: {
		login: string;
		/** Present only when the author is a User (not a Bot/Organization). */
		id?: string;
		name?: string;
	};
}

export interface GitHubProjectsConfig {
	projectId: string;
	owner: string;
	ownerType: 'user' | 'organization';
	statuses: Record<string, string>;
	labels?: {
		processing?: string;
		readyToProcess?: string;
	};
}
