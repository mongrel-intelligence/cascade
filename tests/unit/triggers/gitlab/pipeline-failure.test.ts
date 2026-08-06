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
import {
	PipelineFailureTrigger,
	resetFixAttempts,
} from '../../../../src/triggers/gitlab/pipeline-failure.js';
import { checkTriggerEnabled } from '../../../../src/triggers/shared/trigger-check.js';
import type { TriggerContext } from '../../../../src/types/index.js';
import { createMockProject } from '../../../helpers/factories.js';
import { IMPLEMENTER_USERNAME, mockPersonaIdentities } from '../../../helpers/mockPersonas.js';

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
			status: 'failed',
			stages: ['build', 'test'],
		},
		user: { username: IMPLEMENTER_USERNAME },
		project: { path_with_namespace: 'group/repo', id: 1 },
		merge_request: {
			iid: 42,
			title: 'Test MR',
			url: 'https://gitlab.com/group/repo/-/merge_requests/42',
			source_branch: 'feature/test',
			target_branch: 'main',
			state: 'opened',
		},
		builds: [
			{ id: 1, name: 'build-job', stage: 'build', status: 'success' },
			{
				id: 2,
				name: 'test-job',
				stage: 'test',
				status: 'failed',
				failure_reason: 'script_failure',
			},
		],
		...overrides,
	};
}

const mockProject = createMockProject({ repo: 'group/repo' });

describe('PipelineFailureTrigger', () => {
	const trigger = new PipelineFailureTrigger();

	beforeEach(() => {
		vi.mocked(checkTriggerEnabled).mockResolvedValue(true);
		vi.mocked(lookupWorkItemForPR).mockResolvedValue('work-item-1');
		// Reset the fix attempt counter between tests
		resetFixAttempts(42);
	});

	// ========================================================================
	// matches
	// ========================================================================

	describe('matches', () => {
		it('matches gitlab source with failed pipeline payload', () => {
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

		it('does not match successful pipeline status', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makePipelinePayload({
					object_attributes: {
						id: 100,
						ref: 'feature/test',
						sha: 'abc123',
						status: 'success',
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
	});

	// ========================================================================
	// handle
	// ========================================================================

	describe('handle', () => {
		it('returns respond-to-ci trigger result for failed pipeline on implementer MR', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'gitlab',
				payload: makePipelinePayload(),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result!.agentType).toBe('respond-to-ci');
			expect(result!.prNumber).toBe(42);
			expect(result!.agentInput.triggerEvent).toBe('scm:check-suite-failure');
			expect(result!.agentInput.triggerType).toBe('check-failure');
		});

		it('returns null when trigger is disabled', async () => {
			vi.mocked(checkTriggerEnabled).mockResolvedValue(false);

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
			const { gitlabClient } = await import('../../../../src/gitlab/client.js');
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

		it('returns null when MR author is not the implementer persona', async () => {
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
						target_branch: 'develop',
						state: 'opened',
					},
				}),
				personaIdentities: mockPersonaIdentities,
			};

			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('enforces max 3 fix attempts per MR', async () => {
			const makeCtx = (): TriggerContext => ({
				project: mockProject,
				source: 'gitlab',
				payload: makePipelinePayload(),
				personaIdentities: mockPersonaIdentities,
			});

			// First 3 attempts should succeed
			const r1 = await trigger.handle(makeCtx());
			expect(r1).not.toBeNull();

			const r2 = await trigger.handle(makeCtx());
			expect(r2).not.toBeNull();

			const r3 = await trigger.handle(makeCtx());
			expect(r3).not.toBeNull();

			// 4th attempt should be blocked
			const r4 = await trigger.handle(makeCtx());
			expect(r4).toBeNull();
		});

		it('resets attempt counter via resetFixAttempts', async () => {
			const makeCtx = (): TriggerContext => ({
				project: mockProject,
				source: 'gitlab',
				payload: makePipelinePayload(),
				personaIdentities: mockPersonaIdentities,
			});

			// Use up all 3 attempts
			await trigger.handle(makeCtx());
			await trigger.handle(makeCtx());
			await trigger.handle(makeCtx());
			expect(await trigger.handle(makeCtx())).toBeNull();

			// Reset and verify we can trigger again
			resetFixAttempts(42);
			const result = await trigger.handle(makeCtx());
			expect(result).not.toBeNull();
		});
	});
});
