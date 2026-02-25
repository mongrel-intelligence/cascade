import type { TRPCContext, TRPCUser } from '../../src/api/trpc.js';
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
