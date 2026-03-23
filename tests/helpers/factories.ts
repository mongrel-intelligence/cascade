import type { TRPCContext, TRPCUser } from '../../src/api/trpc.js';
import type { TrelloCard } from '../../src/trello/client.js';
import type { TrelloWebhookPayload } from '../../src/triggers/trello/types.js';
import type { ProjectConfig, TriggerContext } from '../../src/types/index.js';

// ---------------------------------------------------------------------------
// Project factories
// ---------------------------------------------------------------------------

/**
 * Creates a mock Trello project config. Sensible defaults for trigger tests;
 * pass overrides (shallow-merged) for test-specific customisation.
 */
export function createMockProject(overrides?: Partial<ProjectConfig>): ProjectConfig {
	return {
		id: 'test',
		orgId: 'org-1',
		name: 'Test',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		pm: { type: 'trello' },
		trello: {
			boardId: 'board123',
			lists: {
				splitting: 'splitting-list-id',
				planning: 'planning-list-id',
				todo: 'todo-list-id',
			},
			labels: {},
		},
		...overrides,
	} as ProjectConfig;
}

/**
 * Creates a mock JIRA project config.
 */
export function createMockJiraProject(overrides?: Partial<ProjectConfig>): ProjectConfig {
	return {
		id: 'jira-project',
		orgId: 'org-1',
		name: 'JIRA Project',
		repo: 'owner/jira-repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		pm: { type: 'jira' },
		jira: {
			projectKey: 'PROJ',
			baseUrl: 'https://test.atlassian.net',
			statuses: { splitting: 'Briefing' },
			labels: {
				processing: 'my-processing',
				processed: 'my-processed',
				error: 'my-error',
				readyToProcess: 'my-ready',
			},
		},
		...overrides,
	} as ProjectConfig;
}

// ---------------------------------------------------------------------------
// tRPC factories
// ---------------------------------------------------------------------------

/**
 * Creates a mock tRPC user. Defaults to an admin user.
 */
export function createMockUser(overrides?: Partial<TRPCUser>): TRPCUser {
	return {
		id: 'user-1',
		orgId: 'org-1',
		email: 'test@example.com',
		name: 'Test User',
		role: 'admin',
		...overrides,
	};
}

/**
 * Creates a mock superadmin tRPC user.
 */
export function createMockSuperAdmin(overrides?: Partial<TRPCUser>): TRPCUser {
	return {
		id: 'superadmin-1',
		orgId: 'org-1',
		email: 'admin@cascade.dev',
		name: 'Super Admin',
		role: 'superadmin',
		...overrides,
	};
}

/**
 * Creates a mock tRPC context with an authenticated user.
 */
export function createMockContext(userOverrides?: Partial<TRPCUser>): TRPCContext {
	const user = createMockUser(userOverrides);
	return {
		user,
		effectiveOrgId: user.orgId,
	};
}

// ---------------------------------------------------------------------------
// Trigger context factory
// ---------------------------------------------------------------------------

/**
 * Creates a mock trigger context for trigger handler tests.
 */
export function createTriggerContext(overrides?: Partial<TriggerContext>): TriggerContext {
	return {
		project: createMockProject(),
		source: 'trello',
		payload: {},
		...overrides,
	} as TriggerContext;
}

// ---------------------------------------------------------------------------
// Trello payload factories
// ---------------------------------------------------------------------------

/**
 * Creates a mock Trello webhook action payload.
 *
 * Builds the `{ model, action }` shape used across 27+ trigger test occurrences.
 * Pass overrides (shallow-merged) for test-specific customisation.
 *
 * @example
 * createTrelloActionPayload({ action: { data: { listAfter: { id: 'todo-list-id', name: 'Todo' } } } })
 */
export function createTrelloActionPayload(
	overrides?: Partial<TrelloWebhookPayload>,
): TrelloWebhookPayload {
	return {
		model: { id: 'board123', name: 'Board' },
		action: {
			id: 'action1',
			idMemberCreator: 'member1',
			type: 'updateCard',
			date: '2024-01-01',
			data: {
				card: { id: 'card1', name: 'Test Card', idShort: 1, shortLink: 'abc' },
				listBefore: { id: 'other-list', name: 'Other' },
				listAfter: { id: 'splitting-list-id', name: 'Splitting' },
			},
		},
		...overrides,
	};
}

/**
 * Creates a mock Trello card object for `trelloClient.getCard()` return values.
 *
 * Pass overrides (shallow-merged) for test-specific customisation.
 */
export function createTrelloCard(overrides?: Partial<TrelloCard>): TrelloCard {
	return {
		id: 'card1',
		name: 'Test Card',
		desc: 'Test card description',
		url: 'https://trello.com/c/abc/test-card',
		shortUrl: 'https://trello.com/c/abc',
		idList: 'todo-list-id',
		labels: [],
		...overrides,
	};
}

/**
 * Creates a mock Trello trigger context combining project + Trello payload.
 *
 * Pass overrides (shallow-merged) for test-specific customisation.
 */
export function createTrelloTriggerContext(overrides?: Partial<TriggerContext>): TriggerContext {
	return {
		project: createMockProject(),
		source: 'trello',
		payload: createTrelloActionPayload(),
		...overrides,
	} as TriggerContext;
}

// ---------------------------------------------------------------------------
// GitHub payload factories
// ---------------------------------------------------------------------------

/**
 * Shape of a GitHub pull request object as used in webhook payloads.
 */
export interface MockPR {
	number: number;
	title: string;
	body: string | null;
	html_url: string;
	state: string;
	draft: boolean;
	head: { ref: string; sha: string };
	base: { ref: string };
	user: { login: string };
}

/**
 * Creates a mock GitHub PR object used in webhook payloads.
 *
 * Matches the `pull_request` shape used 80+ times inline across trigger tests.
 * Pass overrides (shallow-merged) for test-specific customisation.
 */
export function createMockPR(overrides?: Partial<MockPR>): MockPR {
	return {
		number: 42,
		title: 'Test PR',
		body: 'https://trello.com/c/abc123/card-name',
		html_url: 'https://github.com/owner/repo/pull/42',
		state: 'open',
		draft: false,
		head: { ref: 'feature/test', sha: 'sha123' },
		base: { ref: 'main' },
		user: { login: 'author' },
		...overrides,
	};
}

/**
 * Shape of a GitHub check suite webhook payload.
 */
export interface CheckSuitePayload {
	action: string;
	check_suite: {
		id: number;
		status: string;
		conclusion: string;
		head_sha: string;
		pull_requests: Array<{ number: number; head: { ref: string; sha: string } }>;
	};
	repository: { full_name: string; html_url: string };
	sender: { login: string };
}

/**
 * Creates a mock GitHub check suite webhook payload.
 *
 * Based on the local `makeCheckSuitePayload` pattern from `check-suite-success.test.ts`.
 * Pass overrides (shallow-merged) for test-specific customisation.
 */
export function createCheckSuitePayload(overrides?: Partial<CheckSuitePayload>): CheckSuitePayload {
	return {
		action: 'completed',
		check_suite: {
			id: 1,
			status: 'completed',
			conclusion: 'success',
			head_sha: 'sha123',
			pull_requests: [{ number: 42, head: { ref: 'feature/test', sha: 'sha123' } }],
		},
		repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
		sender: { login: 'github-actions' },
		...overrides,
	};
}

/**
 * Shape of a GitHub pull request review webhook payload.
 */
export interface ReviewPayload {
	action: string;
	review: {
		id: number;
		state: string;
		body: string | null;
		html_url: string;
		user: { login: string };
	};
	pull_request: {
		number: number;
		title: string;
		body: string | null;
		html_url: string;
		head: { ref: string; sha: string };
		base: { ref: string };
	};
	repository: { full_name: string; html_url: string };
	sender: { login: string };
}

/**
 * Creates a mock GitHub PR review webhook payload.
 *
 * Builds the `{ action, review, pull_request, repository, sender }` shape.
 * Pass overrides (shallow-merged) for test-specific customisation.
 */
export function createReviewPayload(overrides?: Partial<ReviewPayload>): ReviewPayload {
	return {
		action: 'submitted',
		review: {
			id: 100,
			state: 'changes_requested',
			body: 'Please fix the bug',
			html_url: 'https://github.com/owner/repo/pull/42#pullrequestreview-100',
			user: { login: 'cascade-reviewer' },
		},
		pull_request: {
			number: 42,
			title: 'Test PR',
			body: 'https://trello.com/c/abc123/card-name',
			html_url: 'https://github.com/owner/repo/pull/42',
			head: { ref: 'feature/test', sha: 'sha123' },
			base: { ref: 'main' },
		},
		repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
		sender: { login: 'cascade-reviewer' },
		...overrides,
	};
}

/**
 * Creates a mock GitHub trigger context combining project + GitHub payload.
 *
 * Pass overrides (shallow-merged) for test-specific customisation.
 */
export function createGitHubTriggerContext(overrides?: Partial<TriggerContext>): TriggerContext {
	return {
		project: createMockProject(),
		source: 'github',
		payload: {
			action: 'opened',
			number: 42,
			pull_request: createMockPR(),
			repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
			sender: { login: 'author' },
		},
		...overrides,
	} as TriggerContext;
}
