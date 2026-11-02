/**
 * Contract test: synthetic PR conflict events through the REAL trigger code.
 *
 * Fixtures are handwritten from the documented GitHub Pull Request Event schema:
 * https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request
 *
 * This test verifies that buildSyntheticPRConflictPayload produces payloads
 * that correctly trigger PRConflictDetectedTrigger via the registry's
 * first-match dispatch loop, with no earlier trigger claiming the event.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the edges BEFORE importing the trigger code
vi.mock('../../../src/github/client.js', () => ({
	githubClient: {
		getPR: vi.fn(),
		createPRComment: vi.fn().mockResolvedValue(undefined),
	},
}));

vi.mock('../../../src/triggers/shared/trigger-check.js', () => ({
	checkTriggerEnabledWithParams: vi.fn(),
}));

vi.mock('../../../src/triggers/github/utils.js', () => ({
	resolveWorkItemId: vi.fn().mockResolvedValue('WI-123'),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

// Import after mocks
import { githubClient } from '../../../src/github/client.js';
import type { PersonaIdentities } from '../../../src/github/personas.js';
import type { GitHubPullRequest } from '../../../src/polling/providers/github/types.js';
import { buildSyntheticPRConflictPayload } from '../../../src/polling/providers/github/types.js';
import {
	PRConflictDetectedTrigger,
	resetConflictAttempts,
} from '../../../src/triggers/github/pr-conflict-detected.js';
import { registerGitHubTriggers } from '../../../src/triggers/github/register.js';
import { createTriggerRegistry } from '../../../src/triggers/registry.js';
import { checkTriggerEnabledWithParams } from '../../../src/triggers/shared/trigger-check.js';
import type { ProjectConfig, TriggerContext } from '../../../src/types/index.js';

// Cast mocks for type-safe access
const mockGetPR = githubClient.getPR as ReturnType<typeof vi.fn>;
const mockCheckTriggerEnabled = checkTriggerEnabledWithParams as ReturnType<typeof vi.fn>;

/**
 * Fixture: minimal GitHubPullRequest for buildSyntheticPRConflictPayload.
 * Based on GitHub Pulls API: https://docs.github.com/en/rest/pulls/pulls
 */
function createPRFixture(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
	return {
		number: overrides.number ?? 42,
		title: overrides.title ?? 'Test PR',
		body: overrides.body ?? null,
		state: overrides.state ?? 'open',
		draft: overrides.draft ?? false,
		html_url: overrides.html_url ?? 'https://github.com/owner/repo/pull/42',
		head: overrides.head ?? { ref: 'feature/test', sha: 'abc123' },
		base: overrides.base ?? { ref: 'main' },
		user: overrides.user ?? { login: 'cascade-implementer' },
		merged: overrides.merged ?? false,
		merged_at: overrides.merged_at ?? null,
		updated_at: overrides.updated_at ?? new Date().toISOString(),
	};
}

/**
 * Fixture: minimal ProjectConfig for TriggerContext.
 */
function createProjectFixture(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
	return {
		id: overrides.id ?? 'project-1',
		name: overrides.name ?? 'Test Project',
		repo: overrides.repo ?? 'owner/repo',
		baseBranch: overrides.baseBranch ?? 'main',
		jira: overrides.jira,
		agents: overrides.agents,
	} as ProjectConfig;
}

/**
 * Fixture: PersonaIdentities for bot detection.
 */
function createPersonaFixture(): PersonaIdentities {
	return {
		implementer: 'cascade-implementer',
		reviewer: 'cascade-reviewer',
	};
}

/**
 * Build TriggerContext from a synthetic payload.
 */
function buildContext(
	payload: ReturnType<typeof buildSyntheticPRConflictPayload>,
	project: ProjectConfig = createProjectFixture(),
	personaIdentities: PersonaIdentities = createPersonaFixture(),
): TriggerContext {
	return {
		source: 'github',
		project,
		payload,
		personaIdentities,
	};
}

describe('PR conflict contract: synthetic payload through real trigger', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset the in-memory attempt counter between tests
		resetConflictAttempts(42);
		resetConflictAttempts(99);

		// Default: trigger enabled with authorMode 'own'
		mockCheckTriggerEnabled.mockResolvedValue({
			enabled: true,
			parameters: { authorMode: 'own' },
		});

		// Default: PR is dirty (has conflicts)
		mockGetPR.mockResolvedValue({
			number: 42,
			title: 'Test PR',
			htmlUrl: 'https://github.com/owner/repo/pull/42',
			headRef: 'feature/test',
			headSha: 'abc123',
			baseRef: 'main',
			mergeable: false,
			mergeableState: 'dirty',
			merged: false,
			user: { login: 'cascade-implementer' },
		});
	});

	describe('registry dispatch order', () => {
		it('PRConflictDetectedTrigger handles synchronize events, not earlier triggers', async () => {
			const registry = createTriggerRegistry();
			registerGitHubTriggers(registry);

			const pr = createPRFixture();
			const payload = buildSyntheticPRConflictPayload(pr, 'owner/repo', 'base-sha-456');
			const ctx = buildContext(payload);

			// Dispatch through the full registry
			const result = await registry.dispatch(ctx);

			// Should get a result from PRConflictDetectedTrigger
			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('resolve-conflicts');
			expect(result?.prNumber).toBe(42);
		});

		it('payload action is synchronize (not opened), so PROpenedTrigger does not claim it', async () => {
			const pr = createPRFixture();
			const payload = buildSyntheticPRConflictPayload(pr, 'owner/repo', 'base-sha-456');

			// Verify the synthetic payload uses 'synchronize' action
			expect(payload.action).toBe('synchronize');
		});
	});

	describe('successful dispatch', () => {
		it('result carries correct PR number, head ref, base ref, and repo', async () => {
			const trigger = new PRConflictDetectedTrigger();
			const pr = createPRFixture({
				number: 99,
				head: { ref: 'feature/xyz', sha: 'head-sha-123' },
				base: { ref: 'develop' },
			});
			const payload = buildSyntheticPRConflictPayload(pr, 'acme/widgets', 'base-sha-789');
			const project = createProjectFixture({ baseBranch: 'develop' });
			const ctx = buildContext(payload, project);

			mockGetPR.mockResolvedValue({
				number: 99,
				title: 'Feature XYZ',
				htmlUrl: 'https://github.com/acme/widgets/pull/99',
				headRef: 'feature/xyz',
				headSha: 'head-sha-123',
				baseRef: 'develop',
				mergeable: false,
				mergeableState: 'dirty',
				merged: false,
				user: { login: 'cascade-implementer' },
			});

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.prNumber).toBe(99);
			expect(result?.agentInput).toMatchObject({
				prBranch: 'feature/xyz',
				repoFullName: 'acme/widgets',
				headSha: 'head-sha-123',
			});
		});
	});

	describe('gate: author mode (own)', () => {
		it('returns null when PR author is not a cascade persona', async () => {
			const trigger = new PRConflictDetectedTrigger();
			const pr = createPRFixture({ user: { login: 'external-contributor' } });
			const payload = buildSyntheticPRConflictPayload(pr, 'owner/repo', 'base-sha-456');
			const ctx = buildContext(payload);

			mockGetPR.mockResolvedValue({
				number: 42,
				title: 'Test PR',
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				headRef: 'feature/test',
				mergeable: false,
				mergeableState: 'dirty',
				user: { login: 'external-contributor' },
			});

			const result = await trigger.handle(ctx);

			// Gate returns a skip result (agentType: null with skipReason)
			expect(result).not.toBeNull();
			expect(result?.agentType).toBeNull();
			expect(result?.skipReason?.handler).toBe('pr-conflict-detected');
		});
	});

	describe('gate: base branch', () => {
		it('returns skip when PR targets a different branch than project base', async () => {
			const trigger = new PRConflictDetectedTrigger();
			const pr = createPRFixture({ base: { ref: 'release/v2' } });
			const payload = buildSyntheticPRConflictPayload(pr, 'owner/repo', 'base-sha-456');
			const project = createProjectFixture({ baseBranch: 'main' });
			const ctx = buildContext(payload, project);

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.agentType).toBeNull();
			expect(result?.skipReason?.handler).toBe('pr-conflict-detected');
			expect(result?.skipReason?.message).toContain('base branch');
		});
	});

	describe('gate: trigger disabled', () => {
		it('returns null when trigger is disabled in config', async () => {
			mockCheckTriggerEnabled.mockResolvedValue({ enabled: false, parameters: {} });

			const trigger = new PRConflictDetectedTrigger();
			const pr = createPRFixture();
			const payload = buildSyntheticPRConflictPayload(pr, 'owner/repo', 'base-sha-456');
			const ctx = buildContext(payload);

			const result = await trigger.handle(ctx);

			// Disabled returns null (not a skip), so registry continues to next trigger
			expect(result).toBeNull();
		});
	});

	describe('gate: fork PR', () => {
		it('returns skip when PR head is from a fork', async () => {
			const trigger = new PRConflictDetectedTrigger();
			const pr = createPRFixture();
			const payload = buildSyntheticPRConflictPayload(pr, 'owner/repo', 'base-sha-456');
			const ctx = buildContext(payload);

			mockGetPR.mockResolvedValue({
				number: 42,
				title: 'Test PR',
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				headRef: 'feature/test',
				mergeable: false,
				mergeableState: 'dirty',
				isFork: true,
				headRepoFullName: 'contributor/repo',
				user: { login: 'cascade-implementer' },
			});

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.agentType).toBeNull();
			expect(result?.skipReason?.handler).toBe('pr-conflict-detected');
			expect(result?.skipReason?.message).toContain('fork');
		});
	});

	describe('mergeable null (deferred)', () => {
		it('returns deferred result when mergeable is null after retries', async () => {
			const trigger = new PRConflictDetectedTrigger();
			const pr = createPRFixture();
			const payload = buildSyntheticPRConflictPayload(pr, 'owner/repo', 'base-sha-456');
			const ctx = buildContext(payload);

			// Always return mergeable: null
			mockGetPR.mockResolvedValue({
				number: 42,
				title: 'Test PR',
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				headRef: 'feature/test',
				mergeable: null,
				mergeableState: 'unknown',
				user: { login: 'cascade-implementer' },
			});

			const result = await trigger.handle(ctx);

			// Should return a deferred recheck result
			expect(result).not.toBeNull();
			expect(result?.agentType).toBeNull();
			expect(result?.deferredRecheck).toBeDefined();
			expect(result?.deferredRecheck?.delayMs).toBe(45_000);
		}, 15000); // Longer timeout for retry delays
	});

	describe('draft PR behavior', () => {
		it('FINDING: draft PRs are processed normally by PRConflictDetectedTrigger', async () => {
			// PRConflictDetectedTrigger does NOT skip draft PRs.
			// This differs from PROpenedTrigger which skips drafts.
			// The conflict trigger handles drafts because:
			// 1. A draft PR can still have merge conflicts
			// 2. Resolving conflicts early (even in draft) is useful
			const trigger = new PRConflictDetectedTrigger();
			const pr = createPRFixture({ draft: true });
			const payload = buildSyntheticPRConflictPayload(pr, 'owner/repo', 'base-sha-456');
			const ctx = buildContext(payload);

			const result = await trigger.handle(ctx);

			// Draft PR with conflicts should trigger resolve-conflicts
			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('resolve-conflicts');
		});
	});
});
