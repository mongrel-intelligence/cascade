/**
 * Shared mock factory objects for backend and gadget tests.
 *
 * These mocks cover modules that appear repeatedly across backend and gadget test files:
 *   - src/utils/fileLogger.js
 *   - src/utils/cascadeEnv.js
 *   - src/utils/repo.js (partial — the parts used by backend tests)
 *   - src/gadgets/sessionState.js (sidecar env vars + record functions)
 *   - src/agents/utils/logging.js
 *
 * Usage:
 * 1. Import the desired mock module object(s) from this file in your test.
 * 2. Use `vi.mock('...path...', () => ({ ... }))` in the test file
 *    (vi.mock calls must stay in each test file because they are hoisted).
 * 3. Access the mock functions via the imported object for assertions and setup.
 *
 * Example:
 * ```ts
 * import { mockFileLoggerModule, mockCascadeEnvModule } from '../../helpers/backendMocks.js';
 *
 * vi.mock('../../../src/utils/fileLogger.js', () => mockFileLoggerModule);
 * vi.mock('../../../src/utils/cascadeEnv.js', () => mockCascadeEnvModule);
 *
 * // In test setup:
 * mockFileLoggerModule.createFileLogger.mockReturnValue(mockLoggerInstance);
 * ```
 *
 * Patterns follow sharedMocks.ts and factories.ts conventions.
 */

import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// src/utils/fileLogger.js — mocked in backend adapter and related tests
// ---------------------------------------------------------------------------

/**
 * Mock for `src/utils/fileLogger.js`.
 *
 * Use in vi.mock():
 * ```ts
 * vi.mock('../../../src/utils/fileLogger.js', () => mockFileLoggerModule);
 * ```
 *
 * Configure per-test:
 * ```ts
 * mockFileLoggerModule.createFileLogger.mockReturnValue(mockLoggerInstance);
 * ```
 */
export const mockFileLoggerModule = {
	createFileLogger: vi.fn(),
	cleanupLogFile: vi.fn(),
	cleanupLogDirectory: vi.fn(),
};

// ---------------------------------------------------------------------------
// src/utils/cascadeEnv.js — mocked in backend adapter and related tests
// ---------------------------------------------------------------------------

/**
 * Mock for `src/utils/cascadeEnv.js`.
 *
 * Use in vi.mock():
 * ```ts
 * vi.mock('../../../src/utils/cascadeEnv.js', () => mockCascadeEnvModule);
 * ```
 *
 * Configure per-test:
 * ```ts
 * mockCascadeEnvModule.loadCascadeEnv.mockReturnValue({ MY_VAR: 'value' });
 * ```
 */
export const mockCascadeEnvModule = {
	loadCascadeEnv: vi.fn(),
	unloadCascadeEnv: vi.fn(),
};

// ---------------------------------------------------------------------------
// src/utils/repo.js (partial) — mocked in backend adapter and related tests
// ---------------------------------------------------------------------------

/**
 * Mock for the backend-relevant parts of `src/utils/repo.js`.
 *
 * Use in vi.mock():
 * ```ts
 * vi.mock('../../../src/utils/repo.js', () => mockRepoModule);
 * ```
 *
 * Note: `getWorkspaceDir` returns '/tmp/cascade-test' by default and
 * `parseRepoFullName` has a real implementation splitting on '/'.
 * Override per-test as needed.
 */
export const mockRepoModule = {
	cleanupTempDir: vi.fn(),
	getWorkspaceDir: vi.fn(() => '/tmp/cascade-test'),
	parseRepoFullName: vi.fn((fullName: string) => {
		const [owner, repo] = fullName.split('/');
		return { owner, repo };
	}),
};

// ---------------------------------------------------------------------------
// src/gadgets/sessionState.js — mocked in adapter and agent tests
// ---------------------------------------------------------------------------

/**
 * Mock for `src/gadgets/sessionState.js`.
 * Includes the sidecar env var constants (re-exported as strings) and all
 * record/clear functions used by the adapter.
 *
 * Use in vi.mock():
 * ```ts
 * vi.mock('../../../src/gadgets/sessionState.js', () => mockSessionStateModule);
 * ```
 *
 * Assert on calls:
 * ```ts
 * expect(mockSessionStateModule.recordPRCreation).toHaveBeenCalledWith('https://...');
 * ```
 */
export const mockSessionStateModule = {
	// Sidecar env var constants (re-exported as literal strings)
	PR_SIDECAR_ENV_VAR: 'CASCADE_PR_SIDECAR_PATH',
	PUSHED_CHANGES_SIDECAR_ENV_VAR: 'CASCADE_PUSHED_CHANGES_SIDECAR_PATH',
	REVIEW_SIDECAR_ENV_VAR: 'CASCADE_REVIEW_SIDECAR_PATH',
	// Record functions
	recordInitialComment: vi.fn(),
	recordPRCreation: vi.fn(),
	recordReviewSubmission: vi.fn(),
	clearInitialComment: vi.fn(),
};

// ---------------------------------------------------------------------------
// src/agents/utils/logging.js — mocked in backend adapter and related tests
// ---------------------------------------------------------------------------

/**
 * Mock for `src/agents/utils/logging.js`.
 *
 * Use in vi.mock():
 * ```ts
 * vi.mock('../../../src/agents/utils/logging.js', () => mockAgentLoggerModule);
 * ```
 *
 * Configure per-test:
 * ```ts
 * mockAgentLoggerModule.createAgentLogger.mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
 * ```
 */
export const mockAgentLoggerModule = {
	createAgentLogger: vi.fn(),
};
