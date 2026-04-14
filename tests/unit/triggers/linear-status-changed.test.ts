import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockLogger, mockTriggerCheckModule } from '../../helpers/sharedMocks.js';

vi.mock('../../../src/utils/logging.js', () => ({ logger: mockLogger }));
vi.mock('../../../src/triggers/shared/trigger-check.js', () => mockTriggerCheckModule);

const mockGetLinearConfig = vi.fn();
vi.mock('../../../src/pm/config.js', () => ({
	getLinearConfig: (...args: unknown[]) => mockGetLinearConfig(...args),
}));

import { LinearStatusChangedTrigger } from '../../../src/triggers/linear/status-changed.js';
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LinearStatusChangedTrigger', () => {
	let trigger: LinearStatusChangedTrigger;

	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(checkTriggerEnabled).mockResolvedValue(true);
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

		it('does not match non-update actions', () => {
			expect(trigger.matches(buildCtx({ action: 'create' }))).toBe(false);
		});

		it('does not match non-Issue types', () => {
			expect(trigger.matches(buildCtx({ type: 'Comment' }))).toBe(false);
		});

		it('does not match when updatedFrom is missing', () => {
			expect(trigger.matches(buildCtx({ noUpdatedFrom: true }))).toBe(false);
		});

		it('does not match when updatedFrom.stateId is not a string', () => {
			const ctx = buildCtx();
			(ctx.payload as Record<string, unknown>).updatedFrom = { stateId: 123 };
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match IssueLabel type', () => {
			expect(trigger.matches(buildCtx({ type: 'IssueLabel' }))).toBe(false);
		});
	});

	// =========================================================================
	// handle
	// =========================================================================
	describe('handle', () => {
		it('returns implementation agent when new state maps to "todo"', async () => {
			const result = await trigger.handle(buildCtx({ newStateId: 'state-todo' }));

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('implementation');
			expect(result?.workItemId).toBe('TEAM-123');
			expect(result?.workItemTitle).toBe('Fix the bug');
			expect(result?.workItemUrl).toBe('https://linear.app/org/issue/TEAM-123');
			expect(result?.agentInput.workItemId).toBe('TEAM-123');
			expect(result?.agentInput.triggerEvent).toBe('pm:status-changed');
		});

		it('returns splitting agent when new state maps to "splitting"', async () => {
			const result = await trigger.handle(buildCtx({ newStateId: 'state-splitting' }));

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('splitting');
		});

		it('returns planning agent when new state maps to "planning"', async () => {
			const result = await trigger.handle(buildCtx({ newStateId: 'state-planning' }));

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('planning');
		});

		it('returns backlog-manager agent when new state maps to "backlog"', async () => {
			const result = await trigger.handle(buildCtx({ newStateId: 'state-backlog' }));

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('backlog-manager');
		});

		it('returns null when new state does not map to any agent', async () => {
			const result = await trigger.handle(buildCtx({ newStateId: 'state-done' }));
			expect(result).toBeNull();
		});

		it('returns null when newStateId is missing from data', async () => {
			const ctx = buildCtx();
			(ctx.payload as Record<string, unknown>).data = {
				identifier: 'TEAM-1',
				// no stateId
			};
			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('returns null when issueIdentifier is missing', async () => {
			const ctx = buildCtx();
			(ctx.payload as Record<string, unknown>).data = {
				stateId: 'state-todo',
				// no identifier or id
			};
			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('returns null when linear config is missing statuses', async () => {
			mockGetLinearConfig.mockReturnValue({ teamId: 'team-abc' }); // no statuses
			const result = await trigger.handle(buildCtx());
			expect(result).toBeNull();
		});

		it('returns null when linear config is missing entirely', async () => {
			mockGetLinearConfig.mockReturnValue(undefined);
			const result = await trigger.handle(buildCtx());
			expect(result).toBeNull();
		});

		it('returns null when trigger is disabled for the resolved agent', async () => {
			vi.mocked(checkTriggerEnabled).mockResolvedValue(false);

			const result = await trigger.handle(buildCtx({ newStateId: 'state-todo' }));

			expect(result).toBeNull();
			expect(checkTriggerEnabled).toHaveBeenCalledWith(
				'proj-linear',
				'implementation',
				'pm:status-changed',
				'linear-status-changed',
			);
		});

		it('calls checkTriggerEnabled with correct args for splitting agent', async () => {
			vi.mocked(checkTriggerEnabled).mockResolvedValue(true);

			await trigger.handle(buildCtx({ newStateId: 'state-splitting' }));

			expect(checkTriggerEnabled).toHaveBeenCalledWith(
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
});
