import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockLogger, mockTriggerCheckModule } from '../../helpers/sharedMocks.js';

vi.mock('../../../src/utils/logging.js', () => ({ logger: mockLogger }));
vi.mock('../../../src/triggers/shared/trigger-check.js', () => mockTriggerCheckModule);

// The capacity gate is fail-closed with no PM-provider scope (the case in unit
// tests). Mock it to not block so the trigger-logic assertions run.
vi.mock('../../../src/triggers/shared/pipeline-capacity-gate.js', () => ({
	shouldBlockForPipelineCapacity: vi.fn().mockResolvedValue(false),
}));

const { mockGetCustomWorkflowStatusDefinition } = vi.hoisted(() => ({
	mockGetCustomWorkflowStatusDefinition: vi.fn(),
}));
vi.mock('../../../src/db/repositories/workflowStatusDefinitionsRepository.js', () => ({
	getCustomWorkflowStatusDefinition: mockGetCustomWorkflowStatusDefinition,
	listCustomWorkflowStatusDefinitions: vi.fn().mockResolvedValue([]),
}));

const mockGetGitHubProjectsConfig = vi.fn();
vi.mock('../../../src/pm/config.js', () => ({
	getGitHubProjectsConfig: (...args: unknown[]) => mockGetGitHubProjectsConfig(...args),
}));

const { mockGetProjectItem } = vi.hoisted(() => ({ mockGetProjectItem: vi.fn() }));
vi.mock('../../../src/github-projects/client.js', () => ({
	getProjectItem: mockGetProjectItem,
}));

import { GitHubProjectsStatusChangedTrigger } from '../../../src/triggers/github-projects/status-changed.js';
import { checkTriggerEnabledWithParams } from '../../../src/triggers/shared/trigger-check.js';
import type { TriggerContext } from '../../../src/types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseConfig = {
	projectId: 'PVT_project',
	owner: 'octocat',
	ownerType: 'user' as const,
	statuses: { todo: 'opt-todo', done: 'opt-done' },
};

const mockProject = {
	id: 'proj-ghp',
	orgId: 'org-1',
	name: 'GHP Project',
	pm: { type: 'github-projects' as const },
	githubProjects: baseConfig,
} as TriggerContext['project'];

/** Builds a webhook ctx. `fieldName`/`toId` are optional webhook hints. */
function buildCtx(
	overrides: {
		source?: TriggerContext['source'];
		action?: string;
		fieldNodeId?: string | null;
		fieldName?: string;
		noFieldValue?: boolean;
	} = {},
): TriggerContext {
	const fieldValue = overrides.noFieldValue
		? undefined
		: {
				field_node_id:
					overrides.fieldNodeId === null ? undefined : (overrides.fieldNodeId ?? 'PVTSSF_status'),
				...(overrides.fieldName ? { field_name: overrides.fieldName } : {}),
			};

	return {
		project: mockProject,
		source: overrides.source ?? 'github-projects',
		payload: {
			action: overrides.action ?? 'edited',
			projects_v2_item: {
				node_id: 'PVTI_item',
				project_node_id: 'PVT_project',
				content_node_id: 'I_content',
				content_type: 'Issue',
			},
			...(fieldValue ? { changes: { field_value: fieldValue } } : { changes: {} }),
		},
	};
}

/** Mocks the authoritative getProjectItem read with a given Status option ID. */
function mockCurrentStatus(optionId: string | undefined, statusFieldId = 'PVTSSF_status') {
	mockGetProjectItem.mockResolvedValue({
		id: 'PVTI_item',
		project: { id: 'PVT_project', number: 1 },
		content: { id: 'I_content', type: 'issue', title: 't', body: '', url: '', state: 'OPEN' },
		fieldValues: {
			nodes:
				optionId === undefined
					? []
					: [
							{
								id: 'value-node',
								name: 'Some Status',
								optionId,
								field: { id: statusFieldId, name: 'Status' },
							},
						],
		},
	});
}

function mockTriggerConfig(enabled: boolean, parameters: Record<string, unknown> = {}) {
	vi.mocked(checkTriggerEnabledWithParams).mockResolvedValue({ enabled, parameters });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GitHubProjectsStatusChangedTrigger', () => {
	let trigger: GitHubProjectsStatusChangedTrigger;

	beforeEach(() => {
		vi.clearAllMocks();
		mockTriggerConfig(true);
		mockGetCustomWorkflowStatusDefinition.mockResolvedValue(null);
		mockGetGitHubProjectsConfig.mockReturnValue(baseConfig);
		trigger = new GitHubProjectsStatusChangedTrigger();
	});

	describe('matches', () => {
		it('matches an edited event with a field-value change and no field_name hint', () => {
			expect(trigger.matches(buildCtx())).toBe(true);
		});

		it('matches when the field_name hint is Status', () => {
			expect(trigger.matches(buildCtx({ fieldName: 'Status' }))).toBe(true);
		});

		it('does not match a non-github-projects source', () => {
			expect(trigger.matches(buildCtx({ source: 'jira' }))).toBe(false);
		});

		it('does not match non-edited actions', () => {
			expect(trigger.matches(buildCtx({ action: 'created' }))).toBe(false);
		});

		it('does not match edits with no field_value change', () => {
			expect(trigger.matches(buildCtx({ noFieldValue: true }))).toBe(false);
		});

		it('skips early when the field_name hint is a non-Status field', () => {
			expect(trigger.matches(buildCtx({ fieldName: 'Priority' }))).toBe(false);
		});
	});

	describe('handle', () => {
		it('dispatches the mapped agent using the authoritative option ID (todo → implementation)', async () => {
			mockCurrentStatus('opt-todo');

			const result = await trigger.handle(buildCtx());

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('implementation');
			expect(result?.workItemId).toBe('I_content');
			expect(result?.agentInput.githubProjectsItemId).toBe('PVTI_item');
		});

		it('returns null when the current status maps to no agent', async () => {
			mockCurrentStatus('opt-done'); // done → agentType null
			const result = await trigger.handle(buildCtx());
			expect(result).toBeNull();
		});

		it('returns null when the current status is not in the configured mapping', async () => {
			mockCurrentStatus('opt-unknown');
			const result = await trigger.handle(buildCtx());
			expect(result).toBeNull();
		});

		it('returns null when the changed field is not the Status field (avoids spurious re-trigger)', async () => {
			// Item currently sits in "todo", but the edit touched a different field.
			mockCurrentStatus('opt-todo');
			const result = await trigger.handle(buildCtx({ fieldNodeId: 'PVTSSF_priority' }));
			expect(result).toBeNull();
		});

		it('confirms Status via the field_name hint when field_node_id is absent', async () => {
			mockCurrentStatus('opt-todo');
			const result = await trigger.handle(buildCtx({ fieldNodeId: null, fieldName: 'Status' }));
			expect(result?.agentType).toBe('implementation');
		});

		it('returns null when the item has no Status field value (status cleared)', async () => {
			mockCurrentStatus(undefined);
			const result = await trigger.handle(buildCtx());
			expect(result).toBeNull();
		});

		it('ignores empty {} field-value nodes the real API returns for non-single-select fields (NEW-2 regression)', async () => {
			// getProjectItem selects fieldValues(first:100) but only spreads the
			// ...on ProjectV2ItemFieldSingleSelectValue fragment. Every other field
			// value (Title text — present on every item, dates, numbers, etc.)
			// comes back as an empty {} node with no `field`. The predicate must
			// guard `n.field?.name` or it throws TypeError on real data.
			mockGetProjectItem.mockResolvedValue({
				id: 'PVTI_item',
				project: { id: 'PVT_project', number: 1 },
				content: { id: 'I_content', type: 'issue', title: 't', body: '', url: '', state: 'OPEN' },
				fieldValues: {
					nodes: [
						{}, // Title (text) value — no field in the projection
						{}, // an iteration/date value — no field either
						{
							id: 'value-node',
							name: 'Some Status',
							optionId: 'opt-todo',
							field: { id: 'PVTSSF_status', name: 'Status' },
						},
					],
				},
			});

			const result = await trigger.handle(buildCtx());

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('implementation');
			expect(result?.workItemId).toBe('I_content');
		});

		it('returns null when the project has no status configuration', async () => {
			mockGetGitHubProjectsConfig.mockReturnValue({ ...baseConfig, statuses: undefined });
			const result = await trigger.handle(buildCtx());
			expect(result).toBeNull();
			expect(mockGetProjectItem).not.toHaveBeenCalled();
		});

		it('returns null when the trigger is disabled for the resolved agent', async () => {
			mockCurrentStatus('opt-todo');
			mockTriggerConfig(false);

			const result = await trigger.handle(buildCtx());

			expect(result).toBeNull();
			expect(checkTriggerEnabledWithParams).toHaveBeenCalledWith(
				'proj-ghp',
				'implementation',
				'pm:status-changed',
				'github-projects-status-changed',
			);
		});

		it('dispatches a custom workflow status when configured', async () => {
			mockGetGitHubProjectsConfig.mockReturnValue({
				...baseConfig,
				statuses: { ...baseConfig.statuses, prd: 'opt-prd' },
			});
			mockGetCustomWorkflowStatusDefinition.mockResolvedValue({
				id: 1,
				key: 'prd',
				label: 'PRD',
				agentType: 'prd',
				sortOrder: 1000,
				createdAt: null,
				updatedAt: null,
			});
			mockCurrentStatus('opt-prd');

			const result = await trigger.handle(buildCtx());
			expect(result?.agentType).toBe('prd');
		});
	});
});
