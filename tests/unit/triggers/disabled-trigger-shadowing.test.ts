/**
 * Regression net for the disabled-trigger-shadowing bug class.
 *
 * Symptom (prod 2026-05-09 — `zbigniewsobiecki/ucho` PR #367): a `pull_request: opened`
 * webhook arrived with the project's review trigger DISABLED at config but the
 * resolve-conflicts trigger ENABLED. The PR was opened CONFLICTING against `dev`.
 * The router logged `decisionReason="Trigger pr-opened skipped: review trigger
 * is disabled for this project"` — `resolve-conflicts` never fired.
 *
 * Root cause: `TriggerRegistry.dispatch` is first-match-wins on non-null results.
 * Both `PROpenedTrigger` (review) and `PRConflictDetectedTrigger` (resolve-conflicts)
 * match `pull_request: opened`. The disabled-at-config branch in each handler was
 * returning a structured skip (non-null), which halted the registry before the
 * second matcher got a chance.
 *
 * Fix: disabled-at-config means "I don't claim this event" — the handler returns
 * `null` so the registry continues to the next matcher. Structured skips are
 * reserved for "I claim this event but my preconditions failed" (wrong base,
 * wrong author, attempt limit, etc.).
 *
 * Pin the end-to-end behavior so a regression in either layer (registry semantics
 * OR per-handler disabled-skip) fails this test loudly.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	mockConfigResolverModule,
	mockGitHubClientModule,
	mockTriggerCheckModule,
} from '../../helpers/sharedMocks.js';

vi.mock('../../../src/triggers/config-resolver.js', () => mockConfigResolverModule);
vi.mock('../../../src/triggers/shared/trigger-check.js', () => mockTriggerCheckModule);
vi.mock('../../../src/github/client.js', () => mockGitHubClientModule);
vi.mock('../../../src/db/repositories/prWorkItemsRepository.js', () => ({
	lookupWorkItemForPR: vi.fn().mockResolvedValue('abc123'),
}));

import { githubClient } from '../../../src/github/client.js';
import { PRConflictDetectedTrigger } from '../../../src/triggers/github/pr-conflict-detected.js';
import { PROpenedTrigger } from '../../../src/triggers/github/pr-opened.js';
import { createTriggerRegistry } from '../../../src/triggers/registry.js';
import {
	checkTriggerEnabled,
	checkTriggerEnabledWithParams,
} from '../../../src/triggers/shared/trigger-check.js';
import type { TriggerContext } from '../../../src/triggers/types.js';
import { createMockProject } from '../../helpers/factories.js';
import { mockPersonaIdentities } from '../../helpers/mockPersonas.js';

describe('disabled-trigger shadowing regression', () => {
	const project = createMockProject({ baseBranch: 'main' });

	const openedPayload = {
		action: 'opened',
		number: 367,
		pull_request: {
			number: 367,
			title: 'aaight: implementation of MNG-XXX',
			body: 'desc',
			html_url: 'https://github.com/owner/repo/pull/367',
			state: 'open' as const,
			draft: false,
			merged: false,
			mergeable: false,
			mergeable_state: 'dirty',
			head: { ref: 'feature/test', sha: 'sha-conflicting' },
			base: { ref: 'main' },
			user: { login: 'cascade-impl' },
		},
		repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
		sender: { login: 'cascade-impl' },
	};

	beforeEach(() => {
		// Reset the per-test trigger-config mocks so an `mockImplementation`
		// from one test doesn't leak into the next.
		vi.mocked(checkTriggerEnabled).mockReset();
		vi.mocked(checkTriggerEnabled).mockResolvedValue(true);
		vi.mocked(checkTriggerEnabledWithParams).mockReset();
		vi.mocked(checkTriggerEnabledWithParams).mockResolvedValue({ enabled: true, parameters: {} });
		vi.mocked(githubClient.getPR).mockResolvedValue({
			number: 367,
			title: openedPayload.pull_request.title,
			state: 'open',
			merged: false,
			mergeable: false,
			mergeable_state: 'dirty',
			head: { ref: 'feature/test', sha: 'sha-conflicting' },
			base: { ref: 'main' },
			user: { login: 'cascade-impl' },
			html_url: 'https://github.com/owner/repo/pull/367',
		} as never);
		vi.mocked(githubClient.createPRComment).mockResolvedValue(undefined);
	});

	it('PROpenedTrigger disabled does NOT shadow PRConflictDetectedTrigger on `pull_request: opened`', async () => {
		// Review trigger DISABLED, resolve-conflicts trigger ENABLED.
		// PROpenedTrigger reads `checkTriggerEnabledWithParams`;
		// PRConflictDetectedTrigger reads `checkTriggerEnabled`. Mock both
		// so each handler sees its own trigger's correct state.
		vi.mocked(checkTriggerEnabledWithParams).mockImplementation(
			async (
				_projectId: string,
				agentType: string,
				_triggerEvent: string,
				_handlerName: string,
			) => ({ enabled: agentType !== 'review', parameters: {} }),
		);
		vi.mocked(checkTriggerEnabled).mockImplementation(
			async (_projectId: string, agentType: string, _triggerEvent: string, _handlerName: string) =>
				agentType !== 'review',
		);

		const registry = createTriggerRegistry();
		registry.register(new PROpenedTrigger());
		registry.register(new PRConflictDetectedTrigger());

		const ctx: TriggerContext = {
			project,
			source: 'github',
			payload: openedPayload,
			personaIdentities: mockPersonaIdentities,
		};

		const result = await registry.dispatch(ctx);

		// Before the fix, this assertion failed with `agentType === null`
		// (PROpenedTrigger's structured skip halted the registry).
		expect(result).not.toBeNull();
		expect(result?.agentType).toBe('resolve-conflicts');
		expect(result?.prNumber).toBe(367);
	});

	it('PROpenedTrigger ENABLED still wins on `pull_request: opened` (no behavior change for the happy path)', async () => {
		// Sanity: when the first matcher is enabled, nothing changes — it
		// claims the event and the registry returns the review dispatch.
		vi.mocked(checkTriggerEnabled).mockResolvedValue(true);

		const registry = createTriggerRegistry();
		registry.register(new PROpenedTrigger());
		registry.register(new PRConflictDetectedTrigger());

		const ctx: TriggerContext = {
			project,
			source: 'github',
			payload: {
				...openedPayload,
				pull_request: { ...openedPayload.pull_request, base: { ref: 'main' } },
			},
			personaIdentities: mockPersonaIdentities,
		};

		const result = await registry.dispatch(ctx);

		expect(result?.agentType).toBe('review');
	});
});
