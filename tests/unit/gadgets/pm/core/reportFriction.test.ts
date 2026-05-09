import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockMaterializeFrictionReport = vi.fn();

vi.mock('../../../../../src/friction/materialize.js', () => ({
	materializeFrictionReport: (...args: unknown[]) => mockMaterializeFrictionReport(...args),
}));

import { reportFriction } from '../../../../../src/gadgets/pm/core/reportFriction.js';
import {
	createSessionState,
	setDefaultSessionState,
} from '../../../../../src/gadgets/sessionState.js';
import type { ProjectConfig } from '../../../../../src/types/index.js';

const project = {
	id: 'project-1',
	orgId: 'org-1',
	name: 'Cascade',
	repo: 'owner/repo',
	pm: { type: 'trello' },
	trello: {
		boardId: 'board-1',
		lists: { friction: 'list-friction' },
		labels: {},
	},
} as ProjectConfig;

function sidecarPath(): string {
	return join(tmpdir(), `cascade-report-friction-${Date.now()}-${Math.random()}.jsonl`);
}

afterEach(() => {
	vi.restoreAllMocks();
});

beforeEach(() => {
	mockMaterializeFrictionReport.mockReset();
	setDefaultSessionState(createSessionState());
	delete process.env.CASCADE_FRICTION_SIDECAR_PATH;
	delete process.env.CASCADE_RUN_ID;
	delete process.env.CASCADE_DASHBOARD_URL;
	delete process.env.CASCADE_WORK_ITEM_ID;
	delete process.env.CASCADE_WORK_ITEM_TITLE;
	delete process.env.CASCADE_WORK_ITEM_URL;
	delete process.env.CASCADE_PR_NUMBER;
	delete process.env.CASCADE_PR_TITLE;
	delete process.env.CASCADE_PR_URL;
});

describe('reportFriction', () => {
	it('queues before filing and appends filed event after successful materialization', async () => {
		const path = sidecarPath();
		mockMaterializeFrictionReport.mockResolvedValue({
			status: 'filed',
			reportId: 'ignored',
			workItemId: 'card-1',
			workItemUrl: 'https://pm.example/card-1',
		});

		const result = await reportFriction({
			project,
			sidecarPath: path,
			summary: 'Missing setup hint',
			details: 'The command needs an undocumented env var.',
			category: 'environment',
			severity: 'medium',
			whileDoing: 'Running tests',
		});

		expect(result).toMatchObject({
			status: 'filed',
			workItemId: 'card-1',
			workItemUrl: 'https://pm.example/card-1',
		});
		const events = readFileSync(path, 'utf-8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
		expect(events.map((event) => event.event)).toEqual(['queued', 'filed']);
		expect(events[0].report.summary).toBe('Missing setup hint');
		expect(events[1].reportId).toBe(events[0].reportId);
		rmSync(path, { force: true });
	});

	it('keeps the queued event and returns queued_slot_missing when friction slot is absent', async () => {
		const path = sidecarPath();
		mockMaterializeFrictionReport.mockResolvedValue({
			status: 'skipped',
			reportId: 'friction-1',
			reason: 'friction_slot_missing',
			message: "Project project-1 has no 'friction' slot configured.",
		});

		const result = await reportFriction({
			project,
			sidecarPath: path,
			summary: 'No destination',
			details: 'Cannot route friction.',
			category: 'pm-data',
			severity: 'low',
		});

		expect(result.status).toBe('queued_slot_missing');
		const events = readFileSync(path, 'utf-8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
		expect(events).toHaveLength(1);
		expect(events[0].event).toBe('queued');
		rmSync(path, { force: true });
	});

	it('keeps the queued event and returns queued_for_retry when filing fails', async () => {
		const path = sidecarPath();
		mockMaterializeFrictionReport.mockRejectedValue(new Error('PM unavailable'));

		const result = await reportFriction({
			project,
			sidecarPath: path,
			summary: 'PM outage',
			details: 'Create failed.',
			category: 'tooling',
			severity: 'high',
		});

		expect(result).toMatchObject({
			status: 'queued_for_retry',
			message: expect.stringContaining('PM unavailable'),
		});
		const events = readFileSync(path, 'utf-8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
		expect(events).toHaveLength(1);
		expect(events[0].event).toBe('queued');
		rmSync(path, { force: true });
	});

	it('validates category and severity in the core function', async () => {
		await expect(
			reportFriction({
				project,
				sidecarPath: sidecarPath(),
				summary: 'Bad category',
				details: 'Invalid classification.',
				category: 'invalid' as never,
				severity: 'medium',
			}),
		).rejects.toThrow('category must be one of');
	});

	it('uses SessionState friction sidecar path and env runtime metadata for in-process gadgets', async () => {
		const path = sidecarPath();
		const state = createSessionState();
		state.init({
			agentType: 'implementation',
			projectId: 'project-1',
			workItemId: 'card-123',
			workItemUrl: 'https://trello.com/c/card123',
			workItemTitle: 'Runtime metadata',
			frictionSidecarPath: path,
		});
		setDefaultSessionState(state);
		process.env.CASCADE_RUN_ID = 'run-123';
		process.env.CASCADE_DASHBOARD_URL = 'https://dashboard.example.com';
		process.env.CASCADE_WORK_ITEM_ID = 'card-123';
		process.env.CASCADE_WORK_ITEM_TITLE = 'Runtime metadata';
		process.env.CASCADE_WORK_ITEM_URL = 'https://trello.com/c/card123';
		process.env.CASCADE_PR_NUMBER = '77';
		process.env.CASCADE_PR_TITLE = 'fix: runtime metadata';
		process.env.CASCADE_PR_URL = 'https://github.com/o/r/pull/77';
		mockMaterializeFrictionReport.mockResolvedValue({
			status: 'filed',
			reportId: 'ignored',
			workItemId: 'friction-card',
		});

		await reportFriction({
			project,
			summary: 'Context attached',
			details: 'The report should carry run/work item/PR metadata.',
			category: 'tooling',
			severity: 'medium',
		});

		const event = JSON.parse(readFileSync(path, 'utf-8').trim().split('\n')[0]);
		expect(event.report.context).toMatchObject({
			run: {
				id: 'run-123',
				url: 'https://dashboard.example.com/runs/run-123',
			},
			workItem: {
				id: 'card-123',
				title: 'Runtime metadata',
				url: 'https://trello.com/c/card123',
			},
			pr: {
				number: 77,
				title: 'fix: runtime metadata',
				url: 'https://github.com/o/r/pull/77',
			},
		});
		rmSync(path, { force: true });
	});
});
