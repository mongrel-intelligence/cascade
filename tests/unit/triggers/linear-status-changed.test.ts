import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockLogger, mockTriggerCheckModule } from '../../helpers/sharedMocks.js';

vi.mock('../../../src/utils/logging.js', () => ({ logger: mockLogger }));
vi.mock('../../../src/triggers/shared/trigger-check.js', () => mockTriggerCheckModule);

const mockGetLinearConfig = vi.fn();
vi.mock('../../../src/pm/config.js', () => ({
	getLinearConfig: (...args: unknown[]) => mockGetLinearConfig(...args),
}));

import { LinearStatusChangedTrigger } from '../../../src/triggers/linear/status-changed.js';
import { checkTriggerEnabledWithParams } from '../../../src/triggers/shared/trigger-check.js';
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

const mockProject = {
	id: 'proj-linear',
	orgId: 'org-1',
	name: 'Linear Project',
	repo: 'owner/repo',
	baseBranch: 'main',
	branchPrefix: 'feature/',
	pm: { type: 'linear' as const },
	linear: baseLinearConfig,
} as TriggerContext['project'];

function buildCtx(
	overrides: {
		source?: TriggerContext['source'];
		action?: string;
		type?: string;
		newStateId?: string;
		previousStateId?: string;
		issueIdentifier?: string;
		issueId?: string;
		issueTitle?: string;
		issueUrl?: string;
		noUpdatedFrom?: boolean;
		noLinearConfig?: boolean;
	} = {},
): TriggerContext {
	const project = overrides.noLinearConfig ? { ...mockProject, linear: undefined } : mockProject;

	return {
		project: project as TriggerContext['project'],
		source: overrides.source ?? 'linear',
		payload: {
			action: overrides.action ?? 'update',
			type: overrides.type ?? 'Issue',
			organizationId: 'org-123',
			webhookTimestamp: Date.now(),
			data: {
				id: overrides.issueId ?? 'issue-uuid',
				identifier: overrides.issueIdentifier ?? 'TEAM-123',
				title: overrides.issueTitle ?? 'Fix the bug',
				url: overrides.issueUrl ?? 'https://linear.app/org/issue/TEAM-123',
				stateId: overrides.newStateId ?? 'state-todo',
				teamId: 'team-abc',
			},
			...(overrides.noUpdatedFrom
				? {}
				: {
						updatedFrom: {
							stateId: overrides.previousStateId ?? 'state-backlog',
						},
					}),
			url: 'https://linear.app/org/issue/TEAM-123',
		},
	};
}

/** Configure what checkTriggerEnabledWithParams returns for the next call(s). */
function mockTriggerConfig(
	enabled: boolean,
	parameters: Record<string, unknown> = { onCreate: false, onMove: true },
) {
	vi.mocked(checkTriggerEnabledWithParams).mockResolvedValue({ enabled, parameters });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LinearStatusChangedTrigger', () => {
	let trigger: LinearStatusChangedTrigger;

	beforeEach(() => {
		vi.resetAllMocks();
		// Default: trigger enabled with YAML-default params (onCreate: false, onMove: true)
		mockTriggerConfig(true);
		mockGetLinearConfig.mockReturnValue(baseLinearConfig);
		trigger = new LinearStatusChangedTrigger();
	});

	// =========================================================================
	// matches
	// =========================================================================
	describe('matches', () => {
		it('matches update/Issue events with stateId change in updatedFrom', () => {
			expect(trigger.matches(buildCtx())).toBe(true);
		});

		it('does not match non-linear source', () => {
			expect(trigger.matches(buildCtx({ source: 'jira' }))).toBe(false);
		});

		it('does not match remove actions', () => {
			expect(trigger.matches(buildCtx({ action: 'remove' }))).toBe(false);
		});

		it('matches create/Issue events when data.stateId is present', () => {
			expect(trigger.matches(buildCtx({ action: 'create', noUpdatedFrom: true }))).toBe(true);
		});

		it('does not match create events without data.stateId', () => {
			const ctx = buildCtx({ action: 'create', noUpdatedFrom: true });
			(ctx.payload as Record<string, unknown>).data = {
				identifier: 'TEAM-1',
				title: 'No state',
				// no stateId
			};
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match non-Issue types', () => {
			expect(trigger.matches(buildCtx({ type: 'Comment' }))).toBe(false);
		});

		it('does not match update events when updatedFrom is missing', () => {
			expect(trigger.matches(buildCtx({ noUpdatedFrom: true }))).toBe(false);
		});

		it('does not match update events when updatedFrom.stateId is not a string', () => {
			const ctx = buildCtx();
			(ctx.payload as Record<string, unknown>).updatedFrom = { stateId: 123 };
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match IssueLabel type', () => {
			expect(trigger.matches(buildCtx({ type: 'IssueLabel' }))).toBe(false);
		});
	});

	// =========================================================================
	// handle — update path (default onMove: true)
	// =========================================================================
	describe('handle — move events', () => {
		it('returns implementation agent when moved to "todo"', async () => {
			const result = await trigger.handle(buildCtx({ newStateId: 'state-todo' }));

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('implementation');
			expect(result?.workItemId).toBe('TEAM-123');
			expect(result?.workItemTitle).toBe('Fix the bug');
			expect(result?.workItemUrl).toBe('https://linear.app/org/issue/TEAM-123');
			expect(result?.agentInput.workItemId).toBe('TEAM-123');
			expect(result?.agentInput.triggerEvent).toBe('pm:status-changed');
		});

		it('returns splitting agent when moved to "splitting"', async () => {
			const result = await trigger.handle(buildCtx({ newStateId: 'state-splitting' }));
			expect(result?.agentType).toBe('splitting');
		});

		it('returns planning agent when moved to "planning"', async () => {
			const result = await trigger.handle(buildCtx({ newStateId: 'state-planning' }));
			expect(result?.agentType).toBe('planning');
		});

		it('returns backlog-manager agent when moved to "backlog"', async () => {
			const result = await trigger.handle(buildCtx({ newStateId: 'state-backlog' }));
			expect(result?.agentType).toBe('backlog-manager');
		});

		it('returns coalesce-only result when moved to an unmapped state', async () => {
			const result = await trigger.handle(buildCtx({ newStateId: 'state-done' }));
			expect(result).not.toBeNull();
			expect(result?.agentType).toBeNull();
			expect(result?.coalesceKey).toBe('proj-linear:TEAM-123');
			expect(result?.coalesceRole).toBe('update');
		});

		it('returns null when data.stateId is missing', async () => {
			const ctx = buildCtx();
			(ctx.payload as Record<string, unknown>).data = {
				identifier: 'TEAM-1',
			};
			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('returns null when issueIdentifier is missing', async () => {
			const ctx = buildCtx();
			(ctx.payload as Record<string, unknown>).data = { stateId: 'state-todo' };
			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('returns coalesce-only result when linear config is missing statuses', async () => {
			mockGetLinearConfig.mockReturnValue({ teamId: 'team-abc' });
			const result = await trigger.handle(buildCtx());
			expect(result).not.toBeNull();
			expect(result?.agentType).toBeNull();
			expect(result?.coalesceKey).toBe('proj-linear:TEAM-123');
			expect(result?.coalesceRole).toBe('update');
		});

		it('returns coalesce-only result when linear config is missing entirely', async () => {
			mockGetLinearConfig.mockReturnValue(undefined);
			const result = await trigger.handle(buildCtx());
			expect(result).not.toBeNull();
			expect(result?.agentType).toBeNull();
			expect(result?.coalesceKey).toBe('proj-linear:TEAM-123');
			expect(result?.coalesceRole).toBe('update');
		});

		it('returns coalesce-only result when trigger is disabled for the resolved agent', async () => {
			mockTriggerConfig(false);

			const result = await trigger.handle(buildCtx({ newStateId: 'state-todo' }));

			expect(result).not.toBeNull();
			expect(result?.agentType).toBeNull();
			expect(result?.coalesceKey).toBe('proj-linear:TEAM-123');
			expect(result?.coalesceRole).toBe('update');
			expect(checkTriggerEnabledWithParams).toHaveBeenCalledWith(
				'proj-linear',
				'implementation',
				'pm:status-changed',
				'linear-status-changed',
			);
		});

		it('calls checkTriggerEnabledWithParams with correct args for splitting agent', async () => {
			await trigger.handle(buildCtx({ newStateId: 'state-splitting' }));

			expect(checkTriggerEnabledWithParams).toHaveBeenCalledWith(
				'proj-linear',
				'splitting',
				'pm:status-changed',
				'linear-status-changed',
			);
		});

		it('includes linearIssueId in agentInput', async () => {
			const result = await trigger.handle(
				buildCtx({ newStateId: 'state-todo', issueId: 'issue-uuid-123' }),
			);
			expect(result?.agentInput.linearIssueId).toBe('issue-uuid-123');
		});

		it('falls back to id when identifier is missing', async () => {
			const ctx = buildCtx({ newStateId: 'state-todo' });
			const data = ctx.payload as Record<string, unknown>;
			(data.data as Record<string, unknown>).identifier = undefined;
			(data.data as Record<string, unknown>).id = 'fallback-id';

			const result = await trigger.handle(ctx);
			expect(result?.workItemId).toBe('fallback-id');
		});
	});

	// =========================================================================
	// handle — create path + onCreate/onMove matrix
	// =========================================================================
	describe('handle — create events', () => {
		it('returns null when onCreate is false (default)', async () => {
			// Default mock already sets onCreate: false
			const result = await trigger.handle(
				buildCtx({ action: 'create', newStateId: 'state-todo', noUpdatedFrom: true }),
			);
			expect(result).toBeNull();
		});

		it('returns implementation agent when onCreate is true and created in "todo"', async () => {
			mockTriggerConfig(true, { onCreate: true, onMove: true });

			const result = await trigger.handle(
				buildCtx({ action: 'create', newStateId: 'state-todo', noUpdatedFrom: true }),
			);

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('implementation');
			expect(result?.workItemId).toBe('TEAM-123');
			expect(result?.workItemTitle).toBe('Fix the bug');
			expect(result?.workItemUrl).toBe('https://linear.app/org/issue/TEAM-123');
			expect(result?.agentInput.triggerEvent).toBe('pm:status-changed');
		});

		it('returns planning agent when onCreate is true and created in "planning"', async () => {
			mockTriggerConfig(true, { onCreate: true, onMove: true });

			const result = await trigger.handle(
				buildCtx({ action: 'create', newStateId: 'state-planning', noUpdatedFrom: true }),
			);
			expect(result?.agentType).toBe('planning');
		});

		it('returns null when onCreate is true but state is unmapped', async () => {
			mockTriggerConfig(true, { onCreate: true, onMove: true });

			const result = await trigger.handle(
				buildCtx({ action: 'create', newStateId: 'state-done', noUpdatedFrom: true }),
			);
			expect(result).toBeNull();
		});
	});

	// =========================================================================
	// handle — onMove gating
	// =========================================================================
	describe('handle — onMove gating', () => {
		it('returns coalesce-only result when onMove is false and event is a move', async () => {
			mockTriggerConfig(true, { onCreate: false, onMove: false });

			const result = await trigger.handle(buildCtx({ newStateId: 'state-todo' }));
			expect(result).not.toBeNull();
			expect(result?.agentType).toBeNull();
			expect(result?.coalesceKey).toBe('proj-linear:TEAM-123');
			expect(result?.coalesceRole).toBe('update');
		});

		it('fires for move when onMove is true and onCreate is false (default)', async () => {
			// Default already has onMove: true, onCreate: false
			const result = await trigger.handle(buildCtx({ newStateId: 'state-todo' }));
			expect(result?.agentType).toBe('implementation');
		});

		it('does not fire for create when onMove is true but onCreate is false', async () => {
			mockTriggerConfig(true, { onCreate: false, onMove: true });

			const result = await trigger.handle(
				buildCtx({ action: 'create', newStateId: 'state-todo', noUpdatedFrom: true }),
			);
			expect(result).toBeNull();
		});

		it('fires only for create when onMove is false and onCreate is true', async () => {
			mockTriggerConfig(true, { onCreate: true, onMove: false });

			const createResult = await trigger.handle(
				buildCtx({ action: 'create', newStateId: 'state-todo', noUpdatedFrom: true }),
			);
			expect(createResult?.agentType).toBe('implementation');

			// Reset mock since it's mockResolvedValueOnce-like behavior vs mockResolvedValue
			mockTriggerConfig(true, { onCreate: true, onMove: false });

			const moveResult = await trigger.handle(buildCtx({ newStateId: 'state-todo' }));
			expect(moveResult).not.toBeNull();
			expect(moveResult?.agentType).toBeNull();
			expect(moveResult?.coalesceRole).toBe('update');
		});
	});

	describe('coalesce metadata', () => {
		it('tags move results with coalesceRole: "update" and a project-scoped key', async () => {
			const result = await trigger.handle(buildCtx({ newStateId: 'state-todo' }));
			expect(result?.coalesceKey).toBe('proj-linear:TEAM-123');
			expect(result?.coalesceRole).toBe('update');
		});

		it('tags create results with coalesceRole: "create" and a project-scoped key', async () => {
			mockTriggerConfig(true, { onCreate: true, onMove: true });
			const result = await trigger.handle(
				buildCtx({ action: 'create', newStateId: 'state-todo', noUpdatedFrom: true }),
			);
			expect(result?.coalesceKey).toBe('proj-linear:TEAM-123');
			expect(result?.coalesceRole).toBe('create');
		});
	});
});
