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

vi.mock('../../../../src/gitlab/personas.js', () => ({
	isCascadeBot: vi.fn(),
}));

vi.mock('../../../../src/gitlab/client.js', () => ({
	gitlabClient: {},
	withGitLabToken: vi.fn(),
}));

import { lookupWorkItemForPR } from '../../../../src/db/repositories/prWorkItemsRepository.js';
import { isCascadeBot } from '../../../../src/gitlab/personas.js';
import { MRReviewerAddedTrigger } from '../../../../src/triggers/gitlab/mr-reviewer-added.js';
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
	return {
		object_kind: 'merge_request',
		event_type: 'merge_request',
		user: { username: 'external-user' },
		project: { path_with_namespace: 'group/repo', id: 1 },
		object_attributes: {
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
		},
		repository: { name: 'repo', url: 'https://gitlab.com/group/repo.git' },
		changes: {
			reviewers: {
				previous: [{ username: 'existing-reviewer' }],
				current: [{ username: 'existing-reviewer' }, { username: REVIEWER_USERNAME }],
			},
		},
		...overrides,
	};
}

const mockProject = createMockProject({ repo: 'group/repo' });

describe('MRReviewerAddedTrigger', () => {
	const trigger = new MRReviewerAddedTrigger();

	beforeEach(() => {
		vi.mocked(checkTriggerEnabled).mockResolvedValue(true);
		vi.mocked(lookupWorkItemForPR).mockResolvedValue('work-item-1');
		// Default: external-user is not a bot, REVIEWER_USERNAME is
		vi.mocked(isCascadeBot).mockImplementation((username: string) => {
			return username === IMPLEMENTER_USERNAME || username === REVIEWER_USERNAME;
		});
	});

	// ========================================================================
	// matches
	// ========================================================================

	describe('matches', () => {
		it('matches gitlab source with MR update action and reviewer changes', () => {
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

		it('does not match non-MR payload', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: {
					object_kind: 'pipeline',
					object_attributes: { id: 1, status: 'success', ref: 'main', sha: 'a', stages: [] },
					project: { path_with_namespace: 'a/b', id: 1 },
					user: { username: 'u' },
				},
			};
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match open action', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload({
					object_attributes: {
						...makeMRPayload().object_attributes,
						action: 'open',
					},
				}),
			};
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match when no reviewer changes', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload({
					changes: {
						title: { previous: 'Old', current: 'New' },
					},
				}),
			};
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match when reviewers were removed (current < previous)', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload({
					changes: {
						reviewers: {
							previous: [{ username: 'a' }, { username: 'b' }],
							current: [{ username: 'a' }],
						},
					},
				}),
			};
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match when reviewer count is unchanged', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload({
					changes: {
						reviewers: {
							previous: [{ username: 'a' }],
							current: [{ username: 'b' }],
						},
					},
				}),
			};
			expect(trigger.matches(ctx)).toBe(false);
		});
	});

	// ========================================================================
	// handle
	// ========================================================================

	describe('handle', () => {
		it('returns review trigger result when CASCADE persona is added as reviewer', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result!.agentType).toBe('review');
			expect(result!.prNumber).toBe(42);
			expect(result!.agentInput.triggerEvent).toBe('scm:review-requested');
			expect(result!.agentInput.triggerType).toBe('review-requested');
		});

		it('returns null when trigger is disabled', async () => {
			vi.mocked(checkTriggerEnabled).mockResolvedValue(false);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('returns null when no persona identities are available', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload(),
			};

			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('returns null when sender is a CASCADE persona (loop prevention)', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload({
					user: { username: IMPLEMENTER_USERNAME },
				}),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('returns null when newly added reviewer is not a CASCADE persona', async () => {
			vi.mocked(isCascadeBot).mockReturnValue(false);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload({
					changes: {
						reviewers: {
							previous: [{ username: 'existing-reviewer' }],
							current: [{ username: 'existing-reviewer' }, { username: 'another-human-reviewer' }],
						},
					},
				}),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});
	});
});
