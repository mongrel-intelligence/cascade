/**
 * Shared mock factory objects for commonly-mocked modules.
 *
 * Usage:
 * 1. Import the desired mock object(s) from this file in your test.
 * 2. Use `vi.mock('...path...', () => ({ ... mockObject ... }))` in the test file
 *    (vi.mock calls must stay in each test file because they are hoisted).
 * 3. Access the mock functions via the imported object for assertions and setup.
 *
 * Example:
 * ```ts
 * import { mockLogger } from '../../helpers/sharedMocks.js';
 * vi.mock('../../../src/utils/logging.js', () => ({ logger: mockLogger }));
 *
 * // In test:
 * expect(mockLogger.error).toHaveBeenCalledWith('something went wrong');
 * ```
 *
 * Patterns follow mockDb.ts and factories.ts conventions.
 */

import { vi } from 'vitest';

type GitHubClientContract = typeof import('../../src/github/client.js').githubClient;

// ---------------------------------------------------------------------------
// src/utils/logging.js — mocked in ~47 files
// ---------------------------------------------------------------------------

/**
 * Mock logger object for `src/utils/logging.js`.
 *
 * Use in vi.mock():
 * ```ts
 * vi.mock('../../src/utils/logging.js', () => ({ logger: mockLogger }));
 * ```
 */
export const mockLogger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
};

// ---------------------------------------------------------------------------
// src/config/provider.js — mocked in ~26 files
// ---------------------------------------------------------------------------

/**
 * Mock for `src/config/provider.js` covering the most common exports.
 *
 * Use in vi.mock():
 * ```ts
 * vi.mock('../../src/config/provider.js', () => mockConfigProvider);
 * ```
 *
 * Override specific functions per test:
 * ```ts
 * mockConfigProvider.getAllProjectCredentials.mockResolvedValue({ KEY: 'value' });
 * ```
 */
export const mockConfigProvider = {
	getAllProjectCredentials: vi.fn(),
	getIntegrationCredential: vi.fn(),
	getIntegrationCredentialOrNull: vi.fn(),
	getOrgCredential: vi.fn(),
	findProjectByRepo: vi.fn(),
	findProjectByBoardId: vi.fn(),
	findProjectByJiraProjectKey: vi.fn(),
	findProjectById: vi.fn(),
	loadProjectConfigByRepo: vi.fn(),
	loadProjectConfigByBoardId: vi.fn(),
	loadProjectConfigByJiraProjectKey: vi.fn(),
	loadProjectConfigById: vi.fn(),
	loadConfig: vi.fn(),
	invalidateConfigCache: vi.fn(),
};

// ---------------------------------------------------------------------------
// src/github/client.js — mocked in ~19 files
// ---------------------------------------------------------------------------

/**
 * Mock `withGitHubToken` that simply invokes the callback (no real Octokit).
 * This is the most common usage: the token is ignored and `fn()` is called directly.
 */
export const mockWithGitHubToken = vi.fn((_token: string, fn: () => Promise<unknown>) => fn());

/**
 * Mock GitHub client object (for tests that import `githubClient` directly).
 */
export const mockGithubClient = {
	getPR: vi.fn(),
	getPRReviewComments: vi.fn(),
	replyToReviewComment: vi.fn(),
	createPRComment: vi.fn(),
	updatePRComment: vi.fn(),
	deletePRComment: vi.fn(),
	getPRReviews: vi.fn(),
	getPRIssueComments: vi.fn(),
	getCheckSuiteStatus: vi.fn(),
	getPRDiff: vi.fn(),
	createPRReview: vi.fn(),
	getOpenPRByBranch: vi.fn(),
	createPR: vi.fn(),
	getFailedWorkflowRunJobs: vi.fn(),
	mergePR: vi.fn(),
} satisfies GitHubClientContract;

/**
 * Full mock for `src/github/client.js`.
 *
 * Use in vi.mock():
 * ```ts
 * vi.mock('../../src/github/client.js', () => mockGitHubClientModule);
 * ```
 */
export const mockGitHubClientModule = {
	withGitHubToken: mockWithGitHubToken,
	githubClient: mockGithubClient,
};

// ---------------------------------------------------------------------------
// src/triggers/shared/trigger-check.js — mocked in ~17 files
// ---------------------------------------------------------------------------

/**
 * Mock for `src/triggers/shared/trigger-check.js`.
 * Defaults to returning `true` (trigger enabled) for most test scenarios.
 *
 * Use in vi.mock():
 * ```ts
 * vi.mock('../../src/triggers/shared/trigger-check.js', () => mockTriggerCheckModule);
 * ```
 */
export const mockTriggerCheckModule = {
	checkTriggerEnabled: vi.fn().mockResolvedValue(true),
	checkTriggerEnabledWithParams: vi.fn().mockResolvedValue({ enabled: true, parameters: {} }),
};

// ---------------------------------------------------------------------------
// src/db/client.js — mocked in ~18 files
// ---------------------------------------------------------------------------

/**
 * Mock `getDb` function for `src/db/client.js`.
 * Returns a jest mock function. Configure the return value per-test:
 * ```ts
 * const { db } = createMockDb();
 * mockGetDb.mockReturnValue(db);
 * ```
 */
export const mockGetDb = vi.fn();

/**
 * Full mock for `src/db/client.js`.
 *
 * Use in vi.mock():
 * ```ts
 * vi.mock('../../src/db/client.js', () => mockDbClientModule);
 * ```
 *
 * Then configure per-test with createMockDb():
 * ```ts
 * const { db } = createMockDb();
 * mockGetDb.mockReturnValue(db);
 * ```
 */
export const mockDbClientModule = {
	getDb: mockGetDb,
	closeDb: vi.fn(),
	setDefaultDatabaseContext: vi.fn(),
	_setTestDb: vi.fn(),
};

// ---------------------------------------------------------------------------
// src/trello/client.js — mocked in 8+ trigger test files
// ---------------------------------------------------------------------------

/**
 * Full mock for `src/trello/client.js`.
 *
 * Use in vi.mock():
 * ```ts
 * vi.mock('../../src/trello/client.js', () => mockTrelloClientModule);
 * ```
 *
 * Override specific functions per test:
 * ```ts
 * vi.mocked(mockTrelloClientModule.trelloClient.getCard).mockResolvedValue({ ... });
 * ```
 */
export const mockTrelloClientModule = {
	withTrelloCredentials: vi.fn(),
	trelloClient: {
		getCard: vi.fn(),
	},
};

// ---------------------------------------------------------------------------
// src/jira/client.js — mocked in 6+ trigger test files
// ---------------------------------------------------------------------------

/**
 * Full mock for `src/jira/client.js`.
 *
 * Use in vi.mock():
 * ```ts
 * vi.mock('../../src/jira/client.js', () => mockJiraClientModule);
 * ```
 */
export const mockJiraClientModule = {
	withJiraCredentials: vi.fn(),
	jiraClient: {},
};

// ---------------------------------------------------------------------------
// src/triggers/config-resolver.js — mocked in 15+ trigger test files
// ---------------------------------------------------------------------------

/**
 * Mock for `src/triggers/config-resolver.js`.
 * Defaults to `isTriggerEnabled` returning `true` and `getTriggerParameters` returning `{}`.
 *
 * Use in vi.mock():
 * ```ts
 * vi.mock('../../src/triggers/config-resolver.js', () => mockConfigResolverModule);
 * ```
 *
 * Override per test:
 * ```ts
 * vi.mocked(mockConfigResolverModule.isTriggerEnabled).mockResolvedValue(false);
 * ```
 */
export const mockConfigResolverModule = {
	isTriggerEnabled: vi.fn().mockResolvedValue(true),
	getTriggerParameters: vi.fn().mockResolvedValue({}),
};

// ---------------------------------------------------------------------------
// src/router/acknowledgments.js — mocked in 6+ test files
// ---------------------------------------------------------------------------

/**
 * Full mock for `src/router/acknowledgments.js`.
 * Covers all Trello and JIRA acknowledgment functions.
 *
 * Use in vi.mock():
 * ```ts
 * vi.mock('../../src/router/acknowledgments.js', () => mockAcknowledgmentsModule);
 * ```
 */
export const mockAcknowledgmentsModule = {
	postTrelloAck: vi.fn(),
	deleteTrelloAck: vi.fn(),
	resolveTrelloBotMemberId: vi.fn(),
	postJiraAck: vi.fn(),
	deleteJiraAck: vi.fn(),
	resolveJiraBotAccountId: vi.fn(),
};

// ---------------------------------------------------------------------------
// src/router/reactions.js — mocked alongside acknowledgments
// ---------------------------------------------------------------------------

/**
 * Mock for `src/router/reactions.js`.
 *
 * Use in vi.mock():
 * ```ts
 * vi.mock('../../src/router/reactions.js', () => mockReactionsModule);
 * ```
 */
export const mockReactionsModule = {
	sendAcknowledgeReaction: vi.fn(),
};

// ---------------------------------------------------------------------------
// src/sentry.js — mocked in 5+ test files
// ---------------------------------------------------------------------------

/**
 * Mock for `src/sentry.js`.
 *
 * Use in vi.mock():
 * ```ts
 * vi.mock('../../src/sentry.js', () => mockSentryModule);
 * ```
 *
 * Assert on errors reported:
 * ```ts
 * expect(mockSentryModule.captureException).toHaveBeenCalledWith(expect.any(Error));
 * ```
 */
export const mockSentryModule = {
	captureException: vi.fn(),
};

// ---------------------------------------------------------------------------
// src/utils/lifecycle.js — mocked in backend tests
// ---------------------------------------------------------------------------

/**
 * Mock for `src/utils/lifecycle.js`.
 *
 * Use in vi.mock():
 * ```ts
 * vi.mock('../../src/utils/lifecycle.js', () => mockLifecycleModule);
 * ```
 */
export const mockLifecycleModule = {
	setWatchdogCleanup: vi.fn(),
	clearWatchdogCleanup: vi.fn(),
};
