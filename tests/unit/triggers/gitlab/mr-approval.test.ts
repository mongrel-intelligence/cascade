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
import { MRApprovalTrigger } from '../../../../src/triggers/gitlab/mr-approval.js';
import { checkTriggerEnabled } from '../../../../src/triggers/shared/trigger-check.js';
import type { TriggerContext } from '../../../../src/types/index.js';
import { createMockProject } from '../../../helpers/factories.js';
import {
	IMPLEMENTER_USERNAME,
	mockPersonaIdentities,
	REVIEWER_USERNAME,
} from '../../../helpers/mockPersonas.js';

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
		action: 'unapproved',
		work_in_progress: false,
		url: 'https://gitlab.com/group/repo/-/merge_requests/42',
		last_commit: { id: 'abc123' },
		author_id: 1,
		...(overrides.object_attributes as Record<string, unknown> | undefined),
	};
	return {
		object_kind: 'merge_request',
		event_type: 'merge_request',
		user: { username: REVIEWER_USERNAME },
		project: { path_with_namespace: 'group/repo', id: 1 },
		repository: { name: 'repo', url: 'https://gitlab.com/group/repo' },
		...overrides,
		object_attributes: objectAttributes,
	};
}

const mockProject = createMockProject({ repo: 'group/repo' });

describe('MRApprovalTrigger', () => {
	const trigger = new MRApprovalTrigger();

	beforeEach(() => {
		vi.mocked(checkTriggerEnabled).mockResolvedValue(true);
		vi.mocked(lookupWorkItemForPR).mockResolvedValue('work-item-1');
	});

	// ========================================================================
	// matches
	// ========================================================================

	describe('matches', () => {
		it('matches gitlab MR with unapproved action', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload(),
			};
			expect(trigger.matches(ctx)).toBe(true);
		});

		it('does not match non-gitlab source', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeMRPayload(),
			};
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match approved action (handled by ready-to-merge)', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload({ object_attributes: { action: 'approved' } }),
			};
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match non-merge-request payload', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: { object_kind: 'note', object_attributes: {}, project: { id: 1 } },
			};
			expect(trigger.matches(ctx)).toBe(false);
		});
	});

	// ========================================================================
	// handle
	// ========================================================================

	describe('handle', () => {
		it('returns respond-to-review when unapproved by the reviewer persona', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result!.agentType).toBe('respond-to-review');
			expect(result!.prNumber).toBe(42);
			expect(result!.workItemId).toBe('work-item-1');
			expect(result!.agentInput.triggerEvent).toBe('scm:pr-review-submitted');
			// workItemId must also be carried inside agentInput (run-tracking contract)
			expect(result!.agentInput.workItemId).toBe('work-item-1');
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

		it('returns null when the unapproval is not from the reviewer persona', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				// implementer (or any non-reviewer) unapproving should not re-trigger review
				payload: makeMRPayload({ user: { username: IMPLEMENTER_USERNAME } }),
				personaIdentities: mockPersonaIdentities,
			};

			expect(await trigger.handle(ctx)).toBeNull();
		});
	});
});
