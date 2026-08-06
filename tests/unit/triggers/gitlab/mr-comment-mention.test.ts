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
import { MRCommentMentionTrigger } from '../../../../src/triggers/gitlab/mr-comment-mention.js';
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

function makeNotePayload(overrides: Record<string, unknown> = {}) {
	const objectAttributes = {
		id: 555,
		note: `Hey @${IMPLEMENTER_USERNAME} please take a look`,
		noteable_type: 'MergeRequest',
		author_id: 9,
		url: 'https://gitlab.com/group/repo/-/merge_requests/42#note_555',
		...(overrides.object_attributes as Record<string, unknown> | undefined),
	};
	const mergeRequest =
		overrides.merge_request === undefined
			? {
					iid: 42,
					title: 'Test MR',
					url: 'https://gitlab.com/group/repo/-/merge_requests/42',
					source_branch: 'feature/test',
					target_branch: 'main',
					state: 'opened',
					last_commit: { id: 'abc123' },
				}
			: overrides.merge_request;
	return {
		object_kind: 'note',
		event_type: 'note',
		user: { username: 'human-user' },
		project: { path_with_namespace: 'group/repo', id: 1 },
		repository: { name: 'repo', url: 'https://gitlab.com/group/repo' },
		...overrides,
		object_attributes: objectAttributes,
		merge_request: mergeRequest,
	};
}

const mockProject = createMockProject({ repo: 'group/repo' });

describe('MRCommentMentionTrigger', () => {
	const trigger = new MRCommentMentionTrigger();

	beforeEach(() => {
		vi.mocked(checkTriggerEnabled).mockResolvedValue(true);
		vi.mocked(lookupWorkItemForPR).mockResolvedValue('work-item-1');
	});

	// ========================================================================
	// matches
	// ========================================================================

	describe('matches', () => {
		it('matches a note on a merge request', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeNotePayload(),
			};
			expect(trigger.matches(ctx)).toBe(true);
		});

		it('does not match notes on non-MergeRequest noteables', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeNotePayload({ object_attributes: { noteable_type: 'Issue' } }),
			};
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match when no merge request is attached', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeNotePayload({ merge_request: null }),
			};
			expect(trigger.matches(ctx)).toBe(false);
		});
	});

	// ========================================================================
	// handle
	// ========================================================================

	describe('handle', () => {
		it('returns respond-to-pr-comment when the implementer is @mentioned by a human', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeNotePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result!.agentType).toBe('respond-to-pr-comment');
			expect(result!.prNumber).toBe(42);
			expect(result!.workItemId).toBe('work-item-1');
			expect(result!.agentInput.triggerEvent).toBe('scm:pr-comment-mention');
			expect(result!.agentInput.workItemId).toBe('work-item-1');
			expect(result!.agentInput.commentAuthor).toBe('human-user');
		});

		it('returns null when the note has no @mention of the implementer', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeNotePayload({ object_attributes: { note: 'no mention here' } }),
				personaIdentities: mockPersonaIdentities,
			};

			expect(await trigger.handle(ctx)).toBeNull();
		});

		it('returns null for @mentions authored by the implementer persona (loop prevention)', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeNotePayload({ user: { username: IMPLEMENTER_USERNAME } }),
				personaIdentities: mockPersonaIdentities,
			};

			expect(await trigger.handle(ctx)).toBeNull();
		});

		it('still fires when the reviewer persona @mentions the implementer (human using reviewer acct)', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeNotePayload({ user: { username: REVIEWER_USERNAME } }),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);
			expect(result).not.toBeNull();
			expect(result!.agentType).toBe('respond-to-pr-comment');
		});

		it('returns null when trigger is disabled', async () => {
			vi.mocked(checkTriggerEnabled).mockResolvedValue(false);
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeNotePayload(),
				personaIdentities: mockPersonaIdentities,
			};
			expect(await trigger.handle(ctx)).toBeNull();
		});

		it('returns null when no persona identities are available', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeNotePayload(),
			};
			expect(await trigger.handle(ctx)).toBeNull();
		});
	});
});
