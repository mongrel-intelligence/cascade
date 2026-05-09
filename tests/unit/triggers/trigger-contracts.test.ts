import { describe, expect, it, vi } from 'vitest';
import {
	type CheckSuiteDecision,
	decideCheckSuiteOutcome,
} from '../../../src/triggers/github/check-suite-decision.js';
import {
	buildRespondToCiResult,
	buildReviewResult,
} from '../../../src/triggers/github/result-builders.js';
import { TRIGGER_EVENTS } from '../../../src/triggers/shared/events.js';
import { buildPMLabelDispatchResult } from '../../../src/triggers/shared/pm-label.js';
import {
	buildPMStatusDispatchResult,
	shouldFirePMStatusEvent,
} from '../../../src/triggers/shared/pm-status.js';
import {
	buildDeferredRecheckResult,
	buildSkipResult,
} from '../../../src/triggers/shared/result-builders.js';
import {
	createCheckSuiteStatus,
	createMockProject,
	createPMLabelAddedFixture,
	createPMStatusFixture,
} from '../../helpers/factories.js';
import { mockPersonaIdentities } from '../../helpers/mockPersonas.js';

const prDetails = {
	headRef: 'feature/contract-coverage',
	htmlUrl: 'https://github.com/owner/repo/pull/42',
	title: 'feat: contract coverage',
};

describe('trigger conformance contracts', () => {
	describe('PM status-changed fixtures', () => {
		it('preserves canonical event/result shape for PM create events', () => {
			const fixture = createPMStatusFixture({ kind: 'create' });
			const result = buildPMStatusDispatchResult({
				projectId: fixture.projectId,
				agentType: fixture.agentType,
				workItemId: fixture.workItemId,
				workItemUrl: fixture.workItemUrl,
				workItemTitle: fixture.workItemTitle,
				agentInput: {
					providerStatusId: fixture.providerStatusId,
					providerStatusName: fixture.providerStatusName,
				},
			});

			expect(shouldFirePMStatusEvent(true, { onCreate: true })).toBe(true);
			expect(result).toMatchObject({
				agentType: 'implementation',
				workItemId: fixture.workItemId,
				workItemUrl: fixture.workItemUrl,
				workItemTitle: fixture.workItemTitle,
				coalesceKey: `${fixture.projectId}:${fixture.workItemId}`,
				agentInput: {
					workItemId: fixture.workItemId,
					workItemUrl: fixture.workItemUrl,
					workItemTitle: fixture.workItemTitle,
					triggerEvent: TRIGGER_EVENTS.PM.STATUS_CHANGED,
					providerStatusId: fixture.providerStatusId,
					providerStatusName: fixture.providerStatusName,
				},
			});
		});

		it('preserves canonical event/result shape for PM move events', () => {
			const fixture = createPMStatusFixture({ kind: 'move', agentType: 'planning' });
			const result = buildPMStatusDispatchResult({
				projectId: fixture.projectId,
				agentType: fixture.agentType,
				workItemId: fixture.workItemId,
				workItemUrl: fixture.workItemUrl,
				workItemTitle: fixture.workItemTitle,
				agentInput: {
					previousStatusId: fixture.previousStatusId,
					previousStatusName: fixture.previousStatusName,
					providerStatusId: fixture.providerStatusId,
					providerStatusName: fixture.providerStatusName,
				},
			});

			expect(shouldFirePMStatusEvent(false, {})).toBe(true);
			expect(result).toMatchObject({
				agentType: 'planning',
				workItemId: fixture.workItemId,
				coalesceKey: `${fixture.projectId}:${fixture.workItemId}`,
				agentInput: {
					workItemId: fixture.workItemId,
					triggerEvent: TRIGGER_EVENTS.PM.STATUS_CHANGED,
					previousStatusId: fixture.previousStatusId,
					previousStatusName: fixture.previousStatusName,
					providerStatusId: fixture.providerStatusId,
					providerStatusName: fixture.providerStatusName,
				},
			});
		});
	});

	it('preserves canonical event/result shape for PM label-added events', () => {
		const fixture = createPMLabelAddedFixture();
		const result = buildPMLabelDispatchResult({
			agentType: fixture.agentType,
			workItemId: fixture.workItemId,
			workItemUrl: fixture.workItemUrl,
			workItemTitle: fixture.workItemTitle,
			agentInput: {
				labelId: fixture.labelId,
				labelName: fixture.labelName,
				containerId: fixture.containerId,
			},
		});

		expect(result).toMatchObject({
			agentType: 'splitting',
			workItemId: fixture.workItemId,
			workItemUrl: fixture.workItemUrl,
			workItemTitle: fixture.workItemTitle,
			agentInput: {
				workItemId: fixture.workItemId,
				workItemUrl: fixture.workItemUrl,
				workItemTitle: fixture.workItemTitle,
				triggerEvent: TRIGGER_EVENTS.PM.LABEL_ADDED,
				labelId: fixture.labelId,
				labelName: fixture.labelName,
				containerId: fixture.containerId,
			},
		});
	});

	describe('GitHub check-suite aggregate outcomes', () => {
		const project = createMockProject();
		const baseDecisionOptions = {
			prNumber: 42,
			prAuthorLogin: 'cascade-impl',
			prBaseRef: 'main',
			project,
			personaIdentities: mockPersonaIdentities,
			handlerName: 'check-suite-success',
			mode: { kind: 'review', parameters: {} },
		} as const;

		it.each([
			{
				name: 'all passing',
				status: createCheckSuiteStatus([
					{ name: 'lint', status: 'completed', conclusion: 'success' },
					{ name: 'test', status: 'completed', conclusion: 'neutral' },
				]),
				expected: { action: 'review' } satisfies CheckSuiteDecision,
			},
			{
				name: 'mixed failure',
				status: createCheckSuiteStatus([
					{ name: 'lint', status: 'completed', conclusion: 'success' },
					{ name: 'test', status: 'completed', conclusion: 'failure' },
				]),
				expected: { action: 'respond-to-ci' } satisfies CheckSuiteDecision,
			},
			{
				name: 'incomplete checks',
				status: createCheckSuiteStatus([
					{ name: 'lint', status: 'completed', conclusion: 'success' },
					{ name: 'test', status: 'in_progress', conclusion: null },
				]),
				expected: {
					action: 'defer',
					incompleteChecks: ['test'],
					message: 'Not all checks complete yet (1/2 still running): test',
				} satisfies CheckSuiteDecision,
			},
		])('resolves $name aggregate state', ({ status, expected }) => {
			expect(decideCheckSuiteOutcome({ ...baseDecisionOptions, checkStatus: status })).toEqual(
				expected,
			);
		});

		it('builds canonical review and respond-to-ci dispatch results', () => {
			const review = buildReviewResult({
				prNumber: 42,
				prDetails,
				repoFullName: 'owner/repo',
				headSha: 'sha123',
				workItemId: 'card-123',
				workItemUrl: 'https://trello.com/c/card-123',
				workItemTitle: 'Implement feature',
				onBlocked: vi.fn(),
			});
			const respondToCi = buildRespondToCiResult({
				prNumber: 42,
				prDetails,
				repoFullName: 'owner/repo',
				headSha: 'sha123',
				workItemId: 'card-123',
				workItemUrl: 'https://trello.com/c/card-123',
				workItemTitle: 'Implement feature',
			});

			expect(review).toMatchObject({
				agentType: 'review',
				prNumber: 42,
				workItemId: 'card-123',
				agentInput: {
					prNumber: 42,
					workItemId: 'card-123',
					triggerEvent: TRIGGER_EVENTS.SCM.CHECK_SUITE_SUCCESS,
					triggerType: 'ci-success',
					repoFullName: 'owner/repo',
					headSha: 'sha123',
				},
			});
			expect(respondToCi).toMatchObject({
				agentType: 'respond-to-ci',
				prNumber: 42,
				workItemId: 'card-123',
				agentInput: {
					prNumber: 42,
					workItemId: 'card-123',
					triggerEvent: TRIGGER_EVENTS.SCM.CHECK_SUITE_FAILURE,
					triggerType: 'check-failure',
					repoFullName: 'owner/repo',
					headSha: 'sha123',
				},
			});
		});
	});

	it('builds deferred re-check results with no embedded agent dispatch', () => {
		expect(
			buildDeferredRecheckResult({
				delayMs: 45_000,
				coalesceKey: 'project-1:pr-conflict-recheck:42',
				agentInput: { prNumber: 42 },
			}),
		).toEqual({
			agentType: null,
			agentInput: { prNumber: 42 },
			deferredRecheck: {
				delayMs: 45_000,
				coalesceKey: 'project-1:pr-conflict-recheck:42',
			},
		});
	});

	it('builds structured skip results that terminate dispatch with a handler reason', () => {
		expect(buildSkipResult('check-suite-success', 'Not all checks complete yet')).toEqual({
			agentType: null,
			agentInput: {},
			skipReason: {
				handler: 'check-suite-success',
				message: 'Not all checks complete yet',
			},
		});
	});
});
