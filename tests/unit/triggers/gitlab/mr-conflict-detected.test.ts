import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConfigResolverModule, mockTriggerCheckModule } from '../../../helpers/sharedMocks.js';

vi.mock('../../../../src/triggers/config-resolver.js', () => mockConfigResolverModule);
vi.mock('../../../../src/triggers/shared/trigger-check.js', () => mockTriggerCheckModule);

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock('../../../../src/db/repositories/prWorkItemsRepository.js', () => ({
	lookupWorkItemForPR: vi.fn(),
}));

vi.mock('../../../../src/gitlab/client.js', () => ({
	gitlabClient: {},
	withGitLabToken: vi.fn(),
}));

import { lookupWorkItemForPR } from '../../../../src/db/repositories/prWorkItemsRepository.js';
import {
	MRConflictDetectedTrigger,
	resetConflictAttempts,
} from '../../../../src/triggers/gitlab/mr-conflict-detected.js';
import { checkTriggerEnabled } from '../../../../src/triggers/shared/trigger-check.js';
import type { TriggerContext } from '../../../../src/types/index.js';
import { createMockProject } from '../../../helpers/factories.js';
import { IMPLEMENTER_USERNAME, mockPersonaIdentities } from '../../../helpers/mockPersonas.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMRPayload(overrides: Record<string, unknown> = {}) {
	const objectAttributes = {
		iid: 42,
		title: 'Test MR',
		description: null,
		source_branch: 'feature/test',
		target_branch: 'main',
		state: 'opened',
		action: 'update',
		work_in_progress: false,
		url: 'https://gitlab.com/group/repo/-/merge_requests/42',
		last_commit: { id: 'abc123' },
		author_id: 1,
		has_conflicts: true,
		...(overrides.object_attributes as Record<string, unknown> | undefined),
	};
	return {
		object_kind: 'merge_request',
		event_type: 'merge_request',
		user: { username: IMPLEMENTER_USERNAME },
		project: { path_with_namespace: 'group/repo', id: 1 },
		repository: { name: 'repo', url: 'https://gitlab.com/group/repo' },
		...overrides,
		object_attributes: objectAttributes,
	};
}

const mockProject = createMockProject({ repo: 'group/repo' });

describe('MRConflictDetectedTrigger', () => {
	const trigger = new MRConflictDetectedTrigger();

	beforeEach(() => {
		vi.mocked(checkTriggerEnabled).mockResolvedValue(true);
		vi.mocked(lookupWorkItemForPR).mockResolvedValue('work-item-1');
		resetConflictAttempts(42);
	});

	// ========================================================================
	// matches
	// ========================================================================

	describe('matches', () => {
		it('matches an update action with has_conflicts', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload(),
			};
			expect(trigger.matches(ctx)).toBe(true);
		});

		it('does not match when has_conflicts is false', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload({ object_attributes: { has_conflicts: false } }),
			};
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match non-update actions', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload({ object_attributes: { action: 'open' } }),
			};
			expect(trigger.matches(ctx)).toBe(false);
		});
	});

	// ========================================================================
	// handle
	// ========================================================================

	describe('handle', () => {
		it('returns resolve-conflicts for an implementer MR with conflicts', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result!.agentType).toBe('resolve-conflicts');
			expect(result!.prNumber).toBe(42);
			expect(result!.workItemId).toBe('work-item-1');
			expect(result!.agentInput.triggerEvent).toBe('scm:pr-conflict-detected');
			expect(result!.agentInput.workItemId).toBe('work-item-1');
			expect(result!.agentInput.headSha).toBe('abc123');
		});

		it('returns null when trigger is disabled', async () => {
			vi.mocked(checkTriggerEnabled).mockResolvedValue(false);
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload(),
				personaIdentities: mockPersonaIdentities,
			};
			expect(await trigger.handle(ctx)).toBeNull();
		});

		it('returns null when no persona identities are available', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload(),
			};
			expect(await trigger.handle(ctx)).toBeNull();
		});

		it('returns null when MR is not authored by the implementer persona', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload({ user: { username: 'someone-else' } }),
				personaIdentities: mockPersonaIdentities,
			};
			expect(await trigger.handle(ctx)).toBeNull();
		});

		it('returns null when MR targets a non-base branch', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload({ object_attributes: { target_branch: 'develop' } }),
				personaIdentities: mockPersonaIdentities,
			};
			expect(await trigger.handle(ctx)).toBeNull();
		});

		it('enforces MAX_ATTEMPTS = 2 resolution attempts per MR', async () => {
			const makeCtx = (): TriggerContext => ({
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload(),
				personaIdentities: mockPersonaIdentities,
			});

			// First 2 attempts fire
			expect(await trigger.handle(makeCtx())).not.toBeNull();
			expect(await trigger.handle(makeCtx())).not.toBeNull();

			// 3rd attempt is blocked by the attempt limit
			expect(await trigger.handle(makeCtx())).toBeNull();
		});

		it('resets the attempt counter via resetConflictAttempts', async () => {
			const makeCtx = (): TriggerContext => ({
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload(),
				personaIdentities: mockPersonaIdentities,
			});

			await trigger.handle(makeCtx());
			await trigger.handle(makeCtx());
			expect(await trigger.handle(makeCtx())).toBeNull();

			resetConflictAttempts(42);
			expect(await trigger.handle(makeCtx())).not.toBeNull();
		});
	});
});
