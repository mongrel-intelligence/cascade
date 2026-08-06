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

vi.mock('../../../../src/triggers/shared/lifecycle-check.js', () => ({
	isLifecycleTriggerEnabled: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../../src/pm/lifecycle.js', () => ({
	resolveProjectPMConfig: vi.fn(() => ({
		statuses: { merged: 'merged-status', done: 'done-status' },
		labels: { auto: 'auto-label' },
	})),
	hasAutoLabel: vi.fn(() => false),
}));

const mockProvider = {
	getWorkItem: vi.fn(),
	moveWorkItem: vi.fn(),
	addComment: vi.fn(),
};
vi.mock('../../../../src/pm/context.js', () => ({
	getPMProvider: () => mockProvider,
}));

vi.mock('../../../../src/db/repositories/prWorkItemsRepository.js', () => ({
	lookupWorkItemForPR: vi.fn(),
}));

vi.mock('../../../../src/gitlab/client.js', () => ({
	gitlabClient: {},
	withGitLabToken: vi.fn(),
}));

import { lookupWorkItemForPR } from '../../../../src/db/repositories/prWorkItemsRepository.js';
import { hasAutoLabel } from '../../../../src/pm/lifecycle.js';
import { MRReadyToMergeTrigger } from '../../../../src/triggers/gitlab/mr-ready-to-merge.js';
import { isLifecycleTriggerEnabled } from '../../../../src/triggers/shared/lifecycle-check.js';
import type { TriggerContext } from '../../../../src/types/index.js';
import { createMockProject } from '../../../helpers/factories.js';

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
		action: 'approved',
		work_in_progress: false,
		url: 'https://gitlab.com/group/repo/-/merge_requests/42',
		last_commit: { id: 'abc123' },
		author_id: 1,
		...(overrides.object_attributes as Record<string, unknown> | undefined),
	};
	return {
		object_kind: 'merge_request',
		event_type: 'merge_request',
		user: { username: 'cascade-reviewer' },
		project: { path_with_namespace: 'group/repo', id: 1 },
		repository: { name: 'repo', url: 'https://gitlab.com/group/repo' },
		...overrides,
		object_attributes: objectAttributes,
	};
}

const mockProject = createMockProject({ repo: 'group/repo' });

describe('MRReadyToMergeTrigger', () => {
	const trigger = new MRReadyToMergeTrigger();

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(isLifecycleTriggerEnabled).mockResolvedValue(true);
		vi.mocked(hasAutoLabel).mockReturnValue(false);
		vi.mocked(lookupWorkItemForPR).mockResolvedValue('work-item-1');
		mockProvider.getWorkItem.mockResolvedValue({
			id: 'work-item-1',
			status: 'in-review',
			labels: [],
		});
		mockProvider.moveWorkItem.mockResolvedValue(undefined);
		mockProvider.addComment.mockResolvedValue(undefined);
	});

	// ========================================================================
	// matches
	// ========================================================================

	describe('matches', () => {
		it('matches an approved action', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload(),
			};
			expect(trigger.matches(ctx)).toBe(true);
		});

		it('does not match non-approved actions', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload({ object_attributes: { action: 'unapproved' } }),
			};
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match non-gitlab source', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeMRPayload(),
			};
			expect(trigger.matches(ctx)).toBe(false);
		});
	});

	// ========================================================================
	// handle
	// ========================================================================

	describe('handle', () => {
		it('moves the work item to DONE on approval (standard path)', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload(),
			};

			const result = await trigger.handle(ctx);

			expect(mockProvider.moveWorkItem).toHaveBeenCalledWith('work-item-1', 'done-status');
			expect(result).not.toBeNull();
			expect(result!.agentType).toBeNull();
			expect(result!.workItemId).toBe('work-item-1');
			expect(result!.prNumber).toBe(42);
		});

		it('moves the work item to MERGED when the auto label is present', async () => {
			vi.mocked(hasAutoLabel).mockReturnValue(true);
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload(),
			};

			const result = await trigger.handle(ctx);

			expect(mockProvider.moveWorkItem).toHaveBeenCalledWith('work-item-1', 'merged-status');
			expect(result!.agentType).toBeNull();
		});

		it('is idempotent — skips the move when already in DONE status', async () => {
			mockProvider.getWorkItem.mockResolvedValue({
				id: 'work-item-1',
				status: 'done-status',
				labels: [],
			});
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload(),
			};

			await trigger.handle(ctx);
			expect(mockProvider.moveWorkItem).not.toHaveBeenCalled();
		});

		it('returns null when no work item is linked to the MR', async () => {
			vi.mocked(lookupWorkItemForPR).mockResolvedValue(null as never);
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload(),
			};
			expect(await trigger.handle(ctx)).toBeNull();
		});

		it('returns null when the lifecycle trigger is disabled', async () => {
			vi.mocked(isLifecycleTriggerEnabled).mockResolvedValue(false);
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload(),
			};
			expect(await trigger.handle(ctx)).toBeNull();
		});
	});
});
