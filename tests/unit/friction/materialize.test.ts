import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateWorkItem = vi.fn();
const mockMoveWorkItem = vi.fn();
const mockGetWorkItemUrl = vi.fn();

const fakePMProvider = {
	createWorkItem: (...a: unknown[]) => mockCreateWorkItem(...a),
	moveWorkItem: (...a: unknown[]) => mockMoveWorkItem(...a),
	getWorkItemUrl: (...a: unknown[]) => mockGetWorkItemUrl(...a),
};

vi.mock('../../../src/pm/registry.js', () => ({
	pmRegistry: { createProvider: () => fakePMProvider },
}));

import { materializeFrictionReport } from '../../../src/friction/materialize.js';
import type { FrictionReport } from '../../../src/friction/types.js';
import type { ProjectConfig } from '../../../src/types/index.js';

function makeReport(): FrictionReport {
	return {
		reportId: 'friction-1',
		summary: 'Tool failed while reading logs',
		details: 'The log file disappeared before the agent could inspect it.',
		category: 'tooling',
		severity: 'low',
		whileDoing: 'checking CI logs',
		context: {
			project: { id: 'proj-1', name: 'Cascade', pmType: 'trello' },
			agent: { type: 'implementation' },
			run: { id: 'run-1' },
			workItem: { id: 'card-source' },
			pr: { number: 123 },
		},
	};
}

function makeTrelloProject(
	lists: Record<string, string> = { friction: 'list-friction' },
): ProjectConfig {
	return {
		id: 'proj-1',
		orgId: 'org-1',
		name: 'Cascade',
		pm: { type: 'trello' },
		trello: { boardId: 'board-1', lists, labels: {} },
	} as unknown as ProjectConfig;
}

function makeJiraProject(
	statuses: Record<string, string> = { friction: 'Friction' },
): ProjectConfig {
	return {
		id: 'proj-1',
		orgId: 'org-1',
		name: 'Cascade',
		pm: { type: 'jira' },
		jira: {
			projectKey: 'CAS',
			baseUrl: 'https://acme.atlassian.net',
			statuses,
			labels: {},
		},
	} as unknown as ProjectConfig;
}

describe('materializeFrictionReport', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCreateWorkItem.mockResolvedValue({
			id: 'friction-card-1',
			title: 'Friction',
			description: '',
			url: 'https://pm.example/friction-card-1',
			labels: [],
		});
		mockMoveWorkItem.mockResolvedValue(undefined);
		mockGetWorkItemUrl.mockReturnValue('https://pm.example/generated');
	});

	it('creates a work item in the friction container and moves it to the friction destination', async () => {
		const result = await materializeFrictionReport({
			project: makeJiraProject(),
			report: makeReport(),
			now: new Date('2026-05-09T18:00:00.000Z'),
		});

		expect(result).toEqual({
			status: 'filed',
			reportId: 'friction-1',
			workItemId: 'friction-card-1',
			workItemUrl: 'https://pm.example/friction-card-1',
		});
		expect(mockCreateWorkItem).toHaveBeenCalledWith(
			expect.objectContaining({
				containerId: 'CAS',
				title: '[Friction][low] Tool failed while reading logs',
				labels: [],
			}),
		);
		expect(mockCreateWorkItem.mock.calls[0][0].description).toContain('## Context');
		expect(mockMoveWorkItem).toHaveBeenCalledWith('friction-card-1', 'Friction');
	});

	it('uses the Trello friction list as both create container and move destination', async () => {
		await materializeFrictionReport({ project: makeTrelloProject(), report: makeReport() });

		expect(mockCreateWorkItem).toHaveBeenCalledWith(
			expect.objectContaining({ containerId: 'list-friction' }),
		);
		expect(mockMoveWorkItem).toHaveBeenCalledWith('friction-card-1', 'list-friction');
	});

	it('returns a non-fatal skipped result when the friction slot is missing', async () => {
		const result = await materializeFrictionReport({
			project: makeTrelloProject({ todo: 'list-todo' }),
			report: makeReport(),
		});

		expect(result).toEqual({
			status: 'skipped',
			reportId: 'friction-1',
			reason: 'friction_slot_missing',
			message: expect.stringContaining("has no 'friction' slot configured"),
		});
		expect(mockCreateWorkItem).not.toHaveBeenCalled();
		expect(mockMoveWorkItem).not.toHaveBeenCalled();
	});

	it('falls back to provider.getWorkItemUrl when createWorkItem returns no URL', async () => {
		mockCreateWorkItem.mockResolvedValue({
			id: 'friction-card-1',
			title: 'Friction',
			description: '',
			url: '',
			labels: [],
		});

		const result = await materializeFrictionReport({
			project: makeTrelloProject(),
			report: makeReport(),
		});

		expect(result).toMatchObject({ status: 'filed', workItemUrl: 'https://pm.example/generated' });
		expect(mockGetWorkItemUrl).toHaveBeenCalledWith('friction-card-1');
	});
});
