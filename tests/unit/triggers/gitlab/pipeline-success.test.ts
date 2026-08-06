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
	gitlabClient: {
		getOpenMRByBranch: vi.fn(),
		getMR: vi.fn(),
	},
	withGitLabToken: vi.fn(),
}));

import { lookupWorkItemForPR } from '../../../../src/db/repositories/prWorkItemsRepository.js';
import { gitlabClient } from '../../../../src/gitlab/client.js';
import { PipelineSuccessTrigger } from '../../../../src/triggers/gitlab/pipeline-success.js';
import { checkTriggerEnabledWithParams } from '../../../../src/triggers/shared/trigger-check.js';
import type { TriggerContext } from '../../../../src/types/index.js';
import { createMockProject } from '../../../helpers/factories.js';
import { mockPersonaIdentities } from '../../../helpers/mockPersonas.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePipelinePayload(overrides: Record<string, unknown> = {}) {
	return {
		object_kind: 'pipeline',
		object_attributes: {
			id: 100,
			ref: 'feature/test',
			sha: 'abc123',
			status: 'success',
			stages: ['build', 'test'],
		},
		user: { username: 'cascade-impl' },
		project: { path_with_namespace: 'group/repo', id: 1 },
		merge_request: {
			iid: 42,
			title: 'Test MR',
			url: 'https://gitlab.com/group/repo/-/merge_requests/42',
			source_branch: 'feature/test',
			target_branch: 'main',
			state: 'opened',
		},
		...overrides,
	};
}

const mockProject = createMockProject({ repo: 'group/repo' });

describe('PipelineSuccessTrigger', () => {
	const trigger = new PipelineSuccessTrigger();

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
		it('matches gitlab source with successful pipeline payload', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makePipelinePayload(),
			};
			expect(trigger.matches(ctx)).toBe(true);
		});

		it('does not match non-gitlab source', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makePipelinePayload(),
			};
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match non-pipeline payload', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: {
					object_kind: 'merge_request',
					object_attributes: { action: 'open' },
					project: { path_with_namespace: 'a/b', id: 1 },
				},
			};
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match failed pipeline status', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makePipelinePayload({
					object_attributes: {
						id: 100,
						ref: 'feature/test',
						sha: 'abc123',
						status: 'failed',
						stages: ['build', 'test'],
					},
				}),
			};
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match running pipeline status', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makePipelinePayload({
					object_attributes: {
						id: 100,
						ref: 'feature/test',
						sha: 'abc123',
						status: 'running',
						stages: ['build', 'test'],
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
		it('returns review trigger result for successful pipeline on MR', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makePipelinePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result!.agentType).toBe('review');
			expect(result!.prNumber).toBe(42);
			expect(result!.agentInput.prBranch).toBe('feature/test');
			expect(result!.agentInput.triggerEvent).toBe('scm:check-suite-success');
		});

		it('returns null when trigger is disabled', async () => {
			vi.mocked(checkTriggerEnabledWithParams).mockResolvedValue({
				enabled: false,
				parameters: {},
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makePipelinePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('returns null when no MR is associated with the pipeline', async () => {
			vi.mocked(gitlabClient.getOpenMRByBranch).mockResolvedValue(null as never);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makePipelinePayload({ merge_request: undefined }),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('returns null when no persona identities are available', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makePipelinePayload(),
				// no personaIdentities
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
				payload: makePipelinePayload({
					user: { username: 'external-user' },
				}),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('returns null when MR targets non-base branch', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makePipelinePayload({
					merge_request: {
						iid: 42,
						title: 'Test MR',
						url: 'https://gitlab.com/group/repo/-/merge_requests/42',
						source_branch: 'feature/test',
						target_branch: 'develop', // not main
						state: 'opened',
					},
				}),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('resolves MR from API when payload merge_request is null', async () => {
			vi.mocked(gitlabClient.getOpenMRByBranch).mockResolvedValue({
				iid: 42,
			} as never);
			vi.mocked(gitlabClient.getMR).mockResolvedValue({
				iid: 42,
				title: 'API-resolved MR',
				webUrl: 'https://gitlab.com/group/repo/-/merge_requests/42',
				sourceBranch: 'feature/test',
				targetBranch: 'main',
				state: 'opened',
			} as never);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makePipelinePayload({ merge_request: undefined }),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result!.agentType).toBe('review');
			expect(result!.prNumber).toBe(42);
			expect(gitlabClient.getOpenMRByBranch).toHaveBeenCalledWith('group/repo', 'feature/test');
		});
	});
});
