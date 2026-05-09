import { describe, expect, it } from 'vitest';
import {
	buildPMStatusCoalesceKey,
	buildPMStatusDispatchResult,
	resolvePMStatusAgentById,
	resolvePMStatusAgentByName,
	shouldFirePMStatusEvent,
} from '../../../../src/triggers/shared/pm-status.js';

describe('PM status helpers', () => {
	it('resolves provider status names to agent types case-insensitively', () => {
		expect(
			resolvePMStatusAgentByName({
				statusName: 'to do',
				configuredStatuses: {
					splitting: 'Splitting',
					todo: 'To Do',
				},
			}),
		).toEqual({ agentType: 'implementation', cascadeStatus: 'todo' });
	});

	it('resolves provider status IDs to agent types exactly', () => {
		expect(
			resolvePMStatusAgentById({
				statusId: 'state-planning',
				configuredStatuses: {
					planning: 'state-planning',
					todo: 'state-todo',
				},
			}),
		).toEqual({ agentType: 'planning', cascadeStatus: 'planning' });
	});

	it('ignores configured statuses without an agent mapping', () => {
		expect(
			resolvePMStatusAgentByName({
				statusName: 'Done',
				configuredStatuses: {
					merged: 'Done',
				},
			}),
		).toBeUndefined();
	});

	it('applies shared onCreate/onMove trigger parameter semantics', () => {
		expect(shouldFirePMStatusEvent(true, { onCreate: true })).toBe(true);
		expect(shouldFirePMStatusEvent(true, {})).toBe(false);
		expect(shouldFirePMStatusEvent(false, {})).toBe(true);
		expect(shouldFirePMStatusEvent(false, { onMove: false })).toBe(false);
	});

	it('builds project-scoped coalesce keys', () => {
		expect(buildPMStatusCoalesceKey('project-1', 'CARD-123')).toBe('project-1:CARD-123');
	});

	it('builds canonical status-changed dispatch results', () => {
		expect(
			buildPMStatusDispatchResult({
				projectId: 'project-1',
				agentType: 'implementation',
				workItemId: 'CARD-123',
				workItemUrl: 'https://example.test/CARD-123',
				workItemTitle: 'Implement feature',
				agentInput: { linearIssueId: 'linear-issue-id' },
			}),
		).toEqual({
			agentType: 'implementation',
			agentInput: {
				workItemId: 'CARD-123',
				workItemUrl: 'https://example.test/CARD-123',
				workItemTitle: 'Implement feature',
				triggerEvent: 'pm:status-changed',
				linearIssueId: 'linear-issue-id',
			},
			workItemId: 'CARD-123',
			workItemUrl: 'https://example.test/CARD-123',
			workItemTitle: 'Implement feature',
			onBlocked: undefined,
			coalesceKey: 'project-1:CARD-123',
		});
	});
});
