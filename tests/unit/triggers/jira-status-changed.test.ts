import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	mockConfigResolverModule,
	mockLogger,
	mockTriggerCheckModule,
} from '../../helpers/sharedMocks.js';

const { mockGetCustomWorkflowStatusDefinition } = vi.hoisted(() => ({
	mockGetCustomWorkflowStatusDefinition: vi.fn(),
}));

vi.mock('../../../src/db/repositories/workflowStatusDefinitionsRepository.js', () => ({
	getCustomWorkflowStatusDefinition: mockGetCustomWorkflowStatusDefinition,
	listCustomWorkflowStatusDefinitions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../src/utils/logging.js', () => ({ logger: mockLogger }));

vi.mock('../../../src/triggers/config-resolver.js', () => mockConfigResolverModule);
vi.mock('../../../src/triggers/shared/trigger-check.js', () => mockTriggerCheckModule);

// Spec 017 / plan 2: the capacity gate is now fail-closed when no
// PM-provider AsyncLocalStorage scope is in effect (the case in these
// unit tests). Mock as passthrough so trigger-logic assertions still run.
vi.mock('../../../src/triggers/shared/pipeline-capacity-gate.js', () => ({
	shouldBlockForPipelineCapacity: vi.fn().mockResolvedValue(false),
}));

import { JiraStatusChangedTrigger } from '../../../src/triggers/jira/status-changed.js';
import { checkTriggerEnabledWithParams } from '../../../src/triggers/shared/trigger-check.js';
import type { TriggerContext } from '../../../src/triggers/types.js';

const mockProject = {
	id: 'test-project',
	name: 'Test Project',
	repo: 'owner/repo',
	baseBranch: 'main',
	branchPrefix: 'feature/',
	jira: {
		projectKey: 'PROJ',
		baseUrl: 'https://myorg.atlassian.net',
		statuses: {
			backlog: 'Backlog',
			splitting: 'Splitting',
			planning: 'Planning',
			todo: 'To Do',
			done: 'Done',
		},
	},
} as TriggerContext['project'];

function buildCtx(
	overrides: {
		source?: TriggerContext['source'];
		webhookEvent?: string;
		issueKey?: string;
		statusChangeItems?: Array<{
			field?: string;
			from?: string;
			to?: string;
			fromString?: string;
			toString?: string;
		}>;
		noJiraConfig?: boolean;
		/** Status name in issue.fields.status.name (for creation events) */
		issueStatusName?: string;
		/** Status ID in issue.fields.status.id (for creation events) */
		issueStatusId?: string;
		/** Override the configured jira.statuses map (locale/id-based repros) */
		configuredStatuses?: Record<string, string>;
	} = {},
): TriggerContext {
	const baseProject = overrides.configuredStatuses
		? {
				...mockProject,
				jira: { ...mockProject.jira, statuses: overrides.configuredStatuses },
			}
		: mockProject;
	const project = overrides.noJiraConfig ? { ...baseProject, jira: undefined } : baseProject;

	return {
		project: project as TriggerContext['project'],
		source: overrides.source ?? 'jira',
		payload: {
			webhookEvent: overrides.webhookEvent ?? 'jira:issue_updated',
			issue: {
				key: overrides.issueKey ?? 'PROJ-42',
				fields: {
					summary: 'Test Issue',
					...(overrides.issueStatusName !== undefined || overrides.issueStatusId !== undefined
						? {
								status: {
									...(overrides.issueStatusName !== undefined
										? { name: overrides.issueStatusName }
										: {}),
									...(overrides.issueStatusId !== undefined ? { id: overrides.issueStatusId } : {}),
								},
							}
						: {}),
				},
			},
			changelog: {
				items: overrides.statusChangeItems ?? [
					{ field: 'status', fromString: 'Backlog', toString: 'Splitting' },
				],
			},
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

describe('JiraStatusChangedTrigger', () => {
	let trigger: JiraStatusChangedTrigger;

	beforeEach(() => {
		vi.resetAllMocks();
		mockTriggerConfig(true);
		mockGetCustomWorkflowStatusDefinition.mockResolvedValue(null);
		trigger = new JiraStatusChangedTrigger();
	});

	describe('matches', () => {
		it('matches jira:issue_updated event with status change', () => {
			expect(trigger.matches(buildCtx())).toBe(true);
		});

		it('does not match non-jira source', () => {
			expect(trigger.matches(buildCtx({ source: 'trello' }))).toBe(false);
		});

		it('does not match unrelated webhook events', () => {
			expect(trigger.matches(buildCtx({ webhookEvent: 'jira:issue_deleted' }))).toBe(false);
		});

		it('matches jira:issue_created events when fields.status.name is present', () => {
			expect(
				trigger.matches(buildCtx({ webhookEvent: 'jira:issue_created', issueStatusName: 'To Do' })),
			).toBe(true);
		});

		it('does not match jira:issue_created events without a status field', () => {
			// issueStatusName omitted → no fields.status.name
			expect(trigger.matches(buildCtx({ webhookEvent: 'jira:issue_created' }))).toBe(false);
		});

		it('does not match update events with no status change in changelog', () => {
			const ctx = buildCtx({
				statusChangeItems: [{ field: 'assignee', fromString: 'Alice', toString: 'Bob' }],
			});
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match update events with empty changelog items', () => {
			const ctx = buildCtx({ statusChangeItems: [] });
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('matches jira:issue_updated with any suffix', () => {
			expect(trigger.matches(buildCtx({ webhookEvent: 'jira:issue_updated:something' }))).toBe(
				true,
			);
		});
	});

	describe('handle — move events (update)', () => {
		it('returns implementation agent for "To Do" transition', async () => {
			const ctx = buildCtx({
				statusChangeItems: [{ field: 'status', fromString: 'Planning', toString: 'To Do' }],
			});

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('implementation');
			expect(result?.workItemId).toBe('PROJ-42');
			expect(result?.agentInput.workItemId).toBe('PROJ-42');
			expect(result?.workItemUrl).toBe('https://myorg.atlassian.net/browse/PROJ-42');
			expect(result?.workItemTitle).toBe('Test Issue');
			expect(result?.agentInput.triggerEvent).toBe('pm:status-changed');
		});

		it('returns splitting agent for "Splitting" transition', async () => {
			const ctx = buildCtx({
				statusChangeItems: [{ field: 'status', fromString: 'Backlog', toString: 'Splitting' }],
			});
			expect((await trigger.handle(ctx))?.agentType).toBe('splitting');
		});

		it('returns planning agent for "Planning" transition', async () => {
			const ctx = buildCtx({
				statusChangeItems: [{ field: 'status', fromString: 'Splitting', toString: 'Planning' }],
			});
			expect((await trigger.handle(ctx))?.agentType).toBe('planning');
		});

		it('is case insensitive when matching status names', async () => {
			const ctx = buildCtx({
				statusChangeItems: [{ field: 'status', fromString: 'Backlog', toString: 'splitting' }],
			});
			expect((await trigger.handle(ctx))?.agentType).toBe('splitting');
		});

		it('returns backlog-manager agent for Backlog transition', async () => {
			const ctx = buildCtx({
				statusChangeItems: [{ field: 'status', fromString: 'Done', toString: 'Backlog' }],
			});
			const result = await trigger.handle(ctx);
			expect(result?.agentType).toBe('backlog-manager');
			expect(result?.workItemId).toBe('PROJ-42');
		});

		it('returns null for unmapped status transitions', async () => {
			const ctx = buildCtx({
				statusChangeItems: [{ field: 'status', fromString: 'To Do', toString: 'Done' }],
			});
			expect(await trigger.handle(ctx)).toBeNull();
		});

		it('returns null when issue key is missing', async () => {
			const ctx = buildCtx({ issueKey: '' });
			(ctx.payload as Record<string, unknown>).issue = undefined;
			expect(await trigger.handle(ctx)).toBeNull();
		});

		it('returns null when JIRA config is missing', async () => {
			const ctx = buildCtx({ noJiraConfig: true });
			expect(await trigger.handle(ctx)).toBeNull();
		});

		it('returns null when status change has an empty toString value', async () => {
			const ctx = buildCtx({
				statusChangeItems: [{ field: 'status', fromString: 'Backlog', toString: '' }],
			});
			expect(await trigger.handle(ctx)).toBeNull();
		});

		it('dispatches via status ID when config stores IDs and toString is a foreign language (MNG-1768 repro)', async () => {
			// Config maps `todo` → status ID "10010". The webhook carries the
			// localized name "En cours" (French) which would never match by name,
			// but the id `to: '10010'` matches locale-invariantly.
			const ctx = buildCtx({
				configuredStatuses: {
					backlog: '10000',
					todo: '10010',
					done: '10011',
				},
				statusChangeItems: [
					{
						field: 'status',
						from: '10000',
						to: '10010',
						fromString: 'Backlog',
						toString: 'En cours',
					},
				],
			});

			const result = await trigger.handle(ctx);

			expect(result?.agentType).toBe('implementation');
			expect(result?.workItemId).toBe('PROJ-42');
		});

		it('still dispatches via toString when config stores names (back-compat)', async () => {
			const ctx = buildCtx({
				statusChangeItems: [
					{ field: 'status', from: '10000', to: '10010', fromString: 'Backlog', toString: 'To Do' },
				],
			});

			expect((await trigger.handle(ctx))?.agentType).toBe('implementation');
		});

		it('logs toStatusId alongside toStatus on the update path', async () => {
			const ctx = buildCtx({
				statusChangeItems: [
					{
						field: 'status',
						from: '10000',
						to: '10005',
						fromString: 'Backlog',
						toString: 'Splitting',
					},
				],
			});
			await trigger.handle(ctx);

			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.stringContaining('JIRA'),
				expect.objectContaining({
					toStatus: 'Splitting',
					toStatusId: '10005',
					eventKind: 'move',
				}),
			);
		});

		it('logs fromStatus on the update path', async () => {
			const ctx = buildCtx({
				statusChangeItems: [{ field: 'status', fromString: 'Backlog', toString: 'Splitting' }],
			});
			await trigger.handle(ctx);

			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.stringContaining('JIRA'),
				expect.objectContaining({
					fromStatus: 'Backlog',
					toStatus: 'Splitting',
					eventKind: 'move',
				}),
			);
		});
	});

	describe('handle — create events (jira:issue_created)', () => {
		it('returns null when onCreate is false (default)', async () => {
			// Default mock already sets onCreate: false
			const ctx = buildCtx({
				webhookEvent: 'jira:issue_created',
				issueStatusName: 'To Do',
			});
			expect(await trigger.handle(ctx)).toBeNull();
		});

		it('returns implementation agent when onCreate is true and created in "To Do"', async () => {
			mockTriggerConfig(true, { onCreate: true, onMove: true });
			const ctx = buildCtx({
				webhookEvent: 'jira:issue_created',
				issueStatusName: 'To Do',
			});

			const result = await trigger.handle(ctx);

			expect(result?.agentType).toBe('implementation');
			expect(result?.workItemId).toBe('PROJ-42');
			expect(result?.workItemUrl).toBe('https://myorg.atlassian.net/browse/PROJ-42');
			expect(result?.workItemTitle).toBe('Test Issue');
			expect(result?.agentInput.triggerEvent).toBe('pm:status-changed');
		});

		it('returns splitting agent when onCreate is true and created in "Splitting"', async () => {
			mockTriggerConfig(true, { onCreate: true, onMove: true });
			const ctx = buildCtx({
				webhookEvent: 'jira:issue_created',
				issueStatusName: 'Splitting',
			});
			expect((await trigger.handle(ctx))?.agentType).toBe('splitting');
		});

		it('resolves the create path via status.id when config stores IDs (MNG-1768)', async () => {
			mockTriggerConfig(true, { onCreate: true, onMove: true });
			const ctx = buildCtx({
				webhookEvent: 'jira:issue_created',
				configuredStatuses: {
					todo: '10010',
				},
				// Foreign-language name; only the id matches.
				issueStatusName: 'En cours',
				issueStatusId: '10010',
			});

			const result = await trigger.handle(ctx);

			expect(result?.agentType).toBe('implementation');
			expect(result?.workItemId).toBe('PROJ-42');
		});

		it('returns null when onCreate is true but status is unmapped', async () => {
			mockTriggerConfig(true, { onCreate: true, onMove: true });
			const ctx = buildCtx({
				webhookEvent: 'jira:issue_created',
				issueStatusName: 'Done',
			});
			expect(await trigger.handle(ctx)).toBeNull();
		});

		it('does NOT log fromStatus on the create path', async () => {
			mockTriggerConfig(true, { onCreate: true, onMove: true });
			const ctx = buildCtx({
				webhookEvent: 'jira:issue_created',
				issueStatusName: 'To Do',
			});
			await trigger.handle(ctx);

			const call = mockLogger.info.mock.calls.find(
				(args) => typeof args[0] === 'string' && args[0].includes('JIRA'),
			);
			expect(call).toBeTruthy();
			expect(call?.[1]).not.toHaveProperty('fromStatus');
			expect(call?.[1]).toMatchObject({ toStatus: 'To Do', eventKind: 'create' });
		});
	});

	describe('handle — onMove gating', () => {
		it('returns null when onMove is false and event is a move', async () => {
			mockTriggerConfig(true, { onCreate: false, onMove: false });
			const ctx = buildCtx({
				statusChangeItems: [{ field: 'status', fromString: 'Backlog', toString: 'Splitting' }],
			});
			expect(await trigger.handle(ctx)).toBeNull();
		});

		it('fires only for create when onMove is false and onCreate is true', async () => {
			mockTriggerConfig(true, { onCreate: true, onMove: false });

			const createCtx = buildCtx({
				webhookEvent: 'jira:issue_created',
				issueStatusName: 'To Do',
			});
			expect((await trigger.handle(createCtx))?.agentType).toBe('implementation');

			mockTriggerConfig(true, { onCreate: true, onMove: false });
			const moveCtx = buildCtx({
				statusChangeItems: [{ field: 'status', fromString: 'Planning', toString: 'To Do' }],
			});
			expect(await trigger.handle(moveCtx)).toBeNull();
		});
	});

	describe('per-agent statusChanged toggle', () => {
		it('returns null when trigger is disabled for the resolved agent', async () => {
			mockTriggerConfig(false);

			const ctx = buildCtx({
				statusChangeItems: [{ field: 'status', fromString: 'Backlog', toString: 'Splitting' }],
			});

			expect(await trigger.handle(ctx)).toBeNull();
			expect(checkTriggerEnabledWithParams).toHaveBeenCalledWith(
				'test-project',
				'splitting',
				'pm:status-changed',
				'jira-status-changed',
			);
		});

		it('calls checkTriggerEnabledWithParams with correct args for implementation agent', async () => {
			const ctx = buildCtx({
				statusChangeItems: [{ field: 'status', fromString: 'Planning', toString: 'To Do' }],
			});
			await trigger.handle(ctx);

			expect(checkTriggerEnabledWithParams).toHaveBeenCalledWith(
				'test-project',
				'implementation',
				'pm:status-changed',
				'jira-status-changed',
			);
		});
	});

	describe('coalesce metadata', () => {
		it('tags move results with a project-scoped coalesceKey (no coalesceRole)', async () => {
			const ctx = buildCtx({
				statusChangeItems: [{ field: 'status', fromString: 'Backlog', toString: 'Splitting' }],
			});
			const result = await trigger.handle(ctx);

			expect(result?.coalesceKey).toBe('test-project:PROJ-42');
			expect(result).not.toHaveProperty('coalesceRole');
		});

		it('tags create results with a project-scoped coalesceKey (no coalesceRole)', async () => {
			mockTriggerConfig(true, { onCreate: true, onMove: true });
			const ctx = buildCtx({
				webhookEvent: 'jira:issue_created',
				issueStatusName: 'To Do',
			});
			const result = await trigger.handle(ctx);

			expect(result?.coalesceKey).toBe('test-project:PROJ-42');
			expect(result).not.toHaveProperty('coalesceRole');
		});
	});

	describe('custom workflow status mapping', () => {
		const customProject = {
			id: 'test-project',
			name: 'Test Project',
			repo: 'owner/repo',
			baseBranch: 'main',
			branchPrefix: 'feature/',
			jira: {
				projectKey: 'PROJ',
				baseUrl: 'https://myorg.atlassian.net',
				statuses: {
					backlog: 'Backlog',
					splitting: 'Splitting',
					planning: 'Planning',
					todo: 'To Do',
					done: 'Done',
					prd: 'PRD Review',
					ux: 'UX Mocks',
				},
			},
		} as TriggerContext['project'];

		function buildCustomCtx(statusName: string): TriggerContext {
			return {
				project: customProject,
				source: 'jira',
				payload: {
					webhookEvent: 'jira:issue_updated',
					issue: {
						key: 'PROJ-42',
						fields: { summary: 'Test Issue' },
					},
					changelog: {
						items: [{ field: 'status', fromString: 'Backlog', toString: statusName }],
					},
				},
			};
		}

		it('dispatches a custom agent when a custom status is configured and matches case-insensitively', async () => {
			mockGetCustomWorkflowStatusDefinition.mockImplementation(async (key: string) => {
				if (key === 'prd') {
					return {
						id: 1,
						key: 'prd',
						label: 'PRD',
						agentType: 'prd',
						sortOrder: 1000,
						createdAt: null,
						updatedAt: null,
					};
				}
				return null;
			});

			const result = await trigger.handle(buildCustomCtx('prd review'));

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('prd');
			expect(result?.workItemId).toBe('PROJ-42');
			expect(result?.workItemUrl).toBe('https://myorg.atlassian.net/browse/PROJ-42');
			expect(result?.workItemTitle).toBe('Test Issue');
			expect(result?.agentInput.triggerEvent).toBe('pm:status-changed');
		});

		it('returns null when a custom status has no dispatch agent configured', async () => {
			mockGetCustomWorkflowStatusDefinition.mockImplementation(async (key: string) => {
				if (key === 'ux') {
					return {
						id: 2,
						key: 'ux',
						label: 'UX',
						agentType: null,
						sortOrder: 2000,
						createdAt: null,
						updatedAt: null,
					};
				}
				return null;
			});

			const result = await trigger.handle(buildCustomCtx('UX Mocks'));
			expect(result).toBeNull();
		});

		it('returns null when a custom status is missing from the workflow definitions table', async () => {
			mockGetCustomWorkflowStatusDefinition.mockResolvedValue(null);

			const result = await trigger.handle(buildCustomCtx('PRD Review'));
			expect(result).toBeNull();
		});

		it('calls checkTriggerEnabledWithParams with the custom agent type', async () => {
			mockGetCustomWorkflowStatusDefinition.mockImplementation(async (key: string) => {
				if (key === 'prd') {
					return {
						id: 1,
						key: 'prd',
						label: 'PRD',
						agentType: 'prd',
						sortOrder: 1000,
						createdAt: null,
						updatedAt: null,
					};
				}
				return null;
			});

			await trigger.handle(buildCustomCtx('PRD Review'));

			expect(checkTriggerEnabledWithParams).toHaveBeenCalledWith(
				'test-project',
				'prd',
				'pm:status-changed',
				'jira-status-changed',
			);
		});

		it('returns null when the trigger is disabled for the resolved custom agent', async () => {
			mockGetCustomWorkflowStatusDefinition.mockImplementation(async (key: string) => {
				if (key === 'prd') {
					return {
						id: 1,
						key: 'prd',
						label: 'PRD',
						agentType: 'prd',
						sortOrder: 1000,
						createdAt: null,
						updatedAt: null,
					};
				}
				return null;
			});
			mockTriggerConfig(false);

			const result = await trigger.handle(buildCustomCtx('PRD Review'));
			expect(result).toBeNull();
		});

		it('dispatches a custom agent on create when onCreate is enabled', async () => {
			mockGetCustomWorkflowStatusDefinition.mockImplementation(async (key: string) => {
				if (key === 'prd') {
					return {
						id: 1,
						key: 'prd',
						label: 'PRD',
						agentType: 'prd',
						sortOrder: 1000,
						createdAt: null,
						updatedAt: null,
					};
				}
				return null;
			});
			mockTriggerConfig(true, { onCreate: true, onMove: true });

			const ctx: TriggerContext = {
				project: customProject,
				source: 'jira',
				payload: {
					webhookEvent: 'jira:issue_created',
					issue: {
						key: 'PROJ-42',
						fields: { summary: 'Test Issue', status: { name: 'PRD Review' } },
					},
				},
			};

			const result = await trigger.handle(ctx);
			expect(result?.agentType).toBe('prd');
		});
	});
});
