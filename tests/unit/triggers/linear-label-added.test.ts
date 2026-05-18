import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockLogger, mockTriggerCheckModule } from '../../helpers/sharedMocks.js';

vi.mock('../../../src/utils/logging.js', () => ({ logger: mockLogger }));
vi.mock('../../../src/triggers/shared/trigger-check.js', () => mockTriggerCheckModule);

const { mockGetCustomWorkflowStatusDefinition } = vi.hoisted(() => ({
	mockGetCustomWorkflowStatusDefinition: vi.fn(),
}));

vi.mock('../../../src/db/repositories/workflowStatusDefinitionsRepository.js', () => ({
	getCustomWorkflowStatusDefinition: mockGetCustomWorkflowStatusDefinition,
	listCustomWorkflowStatusDefinitions: vi.fn().mockResolvedValue([]),
}));

const mockGetLinearConfig = vi.fn();
vi.mock('../../../src/pm/config.js', () => ({
	getLinearConfig: (...args: unknown[]) => mockGetLinearConfig(...args),
}));

// Mock resolveProjectPMConfig to avoid pmRegistry bootstrap side effects
const mockResolveProjectPMConfig = vi.fn();
vi.mock('../../../src/pm/lifecycle.js', () => ({
	resolveProjectPMConfig: (...args: unknown[]) => mockResolveProjectPMConfig(...args),
}));

import { LinearReadyToProcessLabelTrigger } from '../../../src/triggers/linear/label-added.js';
import { checkTriggerEnabled } from '../../../src/triggers/shared/trigger-check.js';
import type { TriggerContext } from '../../../src/types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseLinearConfig = {
	teamId: 'team-abc',
	statuses: {
		splitting: 'state-splitting',
		planning: 'state-planning',
		todo: 'state-todo',
		backlog: 'state-backlog',
		done: 'state-done',
	},
};

const baseProjectPMConfig = {
	labels: {
		processing: 'cascade-processing',
		processed: 'cascade-processed',
		error: 'cascade-error',
		readyToProcess: 'cascade-ready',
		auto: 'cascade-auto',
	},
	statuses: {
		backlog: 'state-backlog',
		inProgress: 'state-in-progress',
		done: 'state-done',
	},
};

const mockProject = {
	id: 'proj-linear',
	orgId: 'org-1',
	name: 'Linear Project',
	repo: 'owner/repo',
	baseBranch: 'main',
	branchPrefix: 'feature/',
	pm: { type: 'linear' as const },
} as TriggerContext['project'];

function buildCtx(
	overrides: {
		source?: TriggerContext['source'];
		action?: string;
		type?: string;
		labelName?: string;
		labelId?: string;
		issueStateId?: string;
		issueIdentifier?: string;
		issueId?: string;
		issueUrl?: string;
		readyToProcessLabel?: string;
		noLinearConfig?: boolean;
	} = {},
): TriggerContext {
	return {
		project: mockProject,
		source: overrides.source ?? 'linear',
		payload: {
			action: overrides.action ?? 'create',
			type: overrides.type ?? 'IssueLabel',
			organizationId: 'org-123',
			webhookTimestamp: Date.now(),
			data: {
				id: 'issuelabel-uuid',
				issueId: 'issue-uuid',
				labelId: overrides.labelId ?? 'label-cascade-ready',
				label: {
					id: overrides.labelId ?? 'label-cascade-ready',
					name: overrides.labelName ?? 'cascade-ready',
				},
				issue: {
					id: overrides.issueId ?? 'issue-uuid',
					identifier: overrides.issueIdentifier ?? 'TEAM-123',
					title: 'Fix the bug',
					teamId: 'team-abc',
					url: overrides.issueUrl ?? 'https://linear.app/org/issue/TEAM-123',
					stateId: overrides.issueStateId ?? 'state-todo',
				},
			},
			url: 'https://linear.app',
		},
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LinearReadyToProcessLabelTrigger', () => {
	let trigger: LinearReadyToProcessLabelTrigger;

	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(checkTriggerEnabled).mockResolvedValue(true);
		mockGetCustomWorkflowStatusDefinition.mockResolvedValue(null);
		mockGetLinearConfig.mockReturnValue(baseLinearConfig);
		mockResolveProjectPMConfig.mockReturnValue(baseProjectPMConfig);
		trigger = new LinearReadyToProcessLabelTrigger();
	});

	// =========================================================================
	// matches
	// =========================================================================
	describe('matches', () => {
		it('matches create/IssueLabel events with the ready-to-process label', () => {
			expect(trigger.matches(buildCtx())).toBe(true);
		});

		it('does not match non-linear source', () => {
			expect(trigger.matches(buildCtx({ source: 'jira' }))).toBe(false);
		});

		it('does not match non-create actions', () => {
			expect(trigger.matches(buildCtx({ action: 'update' }))).toBe(false);
		});

		it('does not match non-IssueLabel types', () => {
			expect(trigger.matches(buildCtx({ type: 'Issue' }))).toBe(false);
		});

		it('does not match when label name does not match readyToProcess', () => {
			expect(trigger.matches(buildCtx({ labelName: 'some-other-label' }))).toBe(false);
		});

		it('does not match when label name is absent (early return on falsy labelName)', () => {
			// The source code checks `if (!labelName) return false` before comparing labelId,
			// so missing label.name always causes non-match
			const ctx = buildCtx({ labelId: 'cascade-ready', labelName: 'cascade-ready' });
			const data = ctx.payload as Record<string, unknown>;
			(data.data as Record<string, unknown>).label = { id: 'cascade-ready', name: undefined };
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match when readyToProcess label is not configured', () => {
			mockResolveProjectPMConfig.mockReturnValue({
				labels: { processing: 'cascade-processing' }, // no readyToProcess
				statuses: {},
			});
			expect(trigger.matches(buildCtx())).toBe(false);
		});

		it('does not match when data.label is missing', () => {
			const ctx = buildCtx();
			const data = ctx.payload as Record<string, unknown>;
			(data.data as Record<string, unknown>).label = undefined;
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('matches with a custom readyToProcess label name', () => {
			mockResolveProjectPMConfig.mockReturnValue({
				labels: { readyToProcess: 'my-custom-ready-label' },
				statuses: {},
			});
			expect(trigger.matches(buildCtx({ labelName: 'my-custom-ready-label' }))).toBe(true);
		});
	});

	// =========================================================================
	// handle
	// =========================================================================
	describe('handle', () => {
		it('returns implementation agent when issue state maps to "todo"', async () => {
			const result = await trigger.handle(buildCtx({ issueStateId: 'state-todo' }));

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('implementation');
			expect(result?.workItemId).toBe('TEAM-123');
			expect(result?.workItemUrl).toBe('https://linear.app/org/issue/TEAM-123');
			expect(result?.agentInput.workItemId).toBe('TEAM-123');
			expect(result?.agentInput.triggerEvent).toBe('pm:label-added');
		});

		it('returns splitting agent when issue state maps to "splitting"', async () => {
			const result = await trigger.handle(buildCtx({ issueStateId: 'state-splitting' }));

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('splitting');
		});

		it('returns planning agent when issue state maps to "planning"', async () => {
			const result = await trigger.handle(buildCtx({ issueStateId: 'state-planning' }));

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('planning');
		});

		it('returns null when issue state does not map to any agent', async () => {
			const result = await trigger.handle(buildCtx({ issueStateId: 'state-done' }));
			expect(result).toBeNull();
		});

		it('returns custom agent when issue state maps to a custom workflow status', async () => {
			mockGetLinearConfig.mockReturnValue({
				...baseLinearConfig,
				statuses: { ...baseLinearConfig.statuses, story: 'state-story' },
			});
			mockGetCustomWorkflowStatusDefinition.mockResolvedValue({
				id: 2,
				key: 'story',
				label: 'Story',
				agentType: 'story',
				sortOrder: 1000,
				createdAt: null,
				updatedAt: null,
			});

			const result = await trigger.handle(buildCtx({ issueStateId: 'state-story' }));

			expect(result?.agentType).toBe('story');
			expect(checkTriggerEnabled).toHaveBeenCalledWith(
				'proj-linear',
				'story',
				'pm:label-added',
				'linear-ready-to-process-label-added',
			);
		});

		it('returns null when issue identifier is missing', async () => {
			const ctx = buildCtx();
			const data = ctx.payload as Record<string, unknown>;
			(data.data as Record<string, unknown>).issue = undefined;
			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('returns null when issue stateId is missing', async () => {
			const ctx = buildCtx();
			const data = ctx.payload as Record<string, unknown>;
			(data.data as Record<string, unknown>).issue = {
				id: 'issue-uuid',
				identifier: 'TEAM-123',
				// no stateId
			};
			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('returns null when linear config has no statuses', async () => {
			mockGetLinearConfig.mockReturnValue({ teamId: 'team-abc' }); // no statuses
			const result = await trigger.handle(buildCtx());
			expect(result).toBeNull();
		});

		it('returns null when linear config is missing', async () => {
			mockGetLinearConfig.mockReturnValue(undefined);
			const result = await trigger.handle(buildCtx());
			expect(result).toBeNull();
		});

		it('returns null when trigger is disabled for the resolved agent', async () => {
			vi.mocked(checkTriggerEnabled).mockResolvedValue(false);

			const result = await trigger.handle(buildCtx({ issueStateId: 'state-todo' }));

			expect(result).toBeNull();
			expect(checkTriggerEnabled).toHaveBeenCalledWith(
				'proj-linear',
				'implementation',
				'pm:label-added',
				'linear-ready-to-process-label-added',
			);
		});

		it('calls checkTriggerEnabled with correct args for splitting', async () => {
			vi.mocked(checkTriggerEnabled).mockResolvedValue(true);

			await trigger.handle(buildCtx({ issueStateId: 'state-splitting' }));

			expect(checkTriggerEnabled).toHaveBeenCalledWith(
				'proj-linear',
				'splitting',
				'pm:label-added',
				'linear-ready-to-process-label-added',
			);
		});

		it('includes linearIssueId in agentInput', async () => {
			const result = await trigger.handle(
				buildCtx({ issueStateId: 'state-todo', issueId: 'issue-uuid-xyz' }),
			);

			expect(result?.agentInput.linearIssueId).toBe('issue-uuid-xyz');
		});

		it('falls back to issue.id when identifier is missing', async () => {
			const ctx = buildCtx({ issueStateId: 'state-todo' });
			const data = ctx.payload as Record<string, unknown>;
			(data.data as Record<string, unknown>).issue = {
				id: 'fallback-id',
				// no identifier
				stateId: 'state-todo',
				url: 'https://linear.app/org/issue/fallback',
			};
			const result = await trigger.handle(ctx);
			expect(result?.workItemId).toBe('fallback-id');
		});

		it('workItemTitle is undefined (not included in IssueLabel payload)', async () => {
			const result = await trigger.handle(buildCtx({ issueStateId: 'state-todo' }));
			expect(result?.workItemTitle).toBeUndefined();
		});
	});
});
