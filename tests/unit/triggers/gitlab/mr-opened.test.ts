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
import { MROpenedTrigger } from '../../../../src/triggers/gitlab/mr-opened.js';
import { checkTriggerEnabledWithParams } from '../../../../src/triggers/shared/trigger-check.js';
import type { TriggerContext } from '../../../../src/types/index.js';
import { createMockProject } from '../../../helpers/factories.js';
import { mockPersonaIdentities } from '../../../helpers/mockPersonas.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMRPayload(overrides: Record<string, unknown> = {}) {
	return {
		object_kind: 'merge_request',
		event_type: 'merge_request',
		user: { username: 'cascade-impl' },
		project: { path_with_namespace: 'group/repo', id: 1 },
		object_attributes: {
			iid: 42,
			title: 'Test MR',
			description: null,
			source_branch: 'feature/test',
			target_branch: 'main',
			state: 'opened',
			action: 'open',
			work_in_progress: false,
			url: 'https://gitlab.com/group/repo/-/merge_requests/42',
			last_commit: { id: 'abc123' },
			author_id: 1,
		},
		repository: { name: 'repo', url: 'https://gitlab.com/group/repo.git' },
		...overrides,
	};
}

const mockProject = createMockProject({ repo: 'group/repo' });

describe('MROpenedTrigger', () => {
	const trigger = new MROpenedTrigger();

	beforeEach(() => {
		vi.mocked(checkTriggerEnabledWithParams).mockResolvedValue({
			enabled: true,
			parameters: { authorMode: 'own' },
		});
		vi.mocked(lookupWorkItemForPR).mockResolvedValue('work-item-1');
	});

	// ========================================================================
	// matches
	// ========================================================================

	describe('matches', () => {
		it('matches gitlab source with MR open action', () => {
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

		it('does not match close action', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload({
					object_attributes: {
						...makeMRPayload().object_attributes,
						action: 'close',
					},
				}),
			};
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match update action', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload({
					object_attributes: {
						...makeMRPayload().object_attributes,
						action: 'update',
					},
				}),
			};
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match WIP/draft MR', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload({
					object_attributes: {
						...makeMRPayload().object_attributes,
						work_in_progress: true,
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
		it('returns review trigger result for opened MR', async () => {
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
			expect(result!.agentInput.prBranch).toBe('feature/test');
			expect(result!.agentInput.headSha).toBe('abc123');
			expect(result!.agentInput.triggerEvent).toBe('scm:pr-opened');
			expect(result!.agentInput.triggerType).toBe('pr-opened');
			expect(result!.workItemId).toBe('work-item-1');
		});

		it('returns null when trigger is disabled', async () => {
			vi.mocked(checkTriggerEnabledWithParams).mockResolvedValue({
				enabled: false,
				parameters: {},
			});

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

		it('returns null when author does not match authorMode', async () => {
			vi.mocked(checkTriggerEnabledWithParams).mockResolvedValue({
				enabled: true,
				parameters: { authorMode: 'own' },
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload({
					user: { username: 'external-user' },
				}),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('fires for external MR when authorMode is "all"', async () => {
			vi.mocked(checkTriggerEnabledWithParams).mockResolvedValue({
				enabled: true,
				parameters: { authorMode: 'all' },
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makeMRPayload({
					user: { username: 'external-user' },
				}),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);
			expect(result).not.toBeNull();
			expect(result!.agentType).toBe('review');
		});
	});
});
