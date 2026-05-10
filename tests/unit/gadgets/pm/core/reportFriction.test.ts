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
	delete process.env.CASCADE_PR_BRANCH;
	delete process.env.CASCADE_INITIAL_HEAD_SHA;
	delete process.env.CASCADE_AGENT_TYPE;
	delete process.env.CASCADE_ENGINE_LABEL;
	delete process.env.CASCADE_MODEL;
	// Clear project env vars so projectFromEnv() would return 'unknown-project' when these are absent
	delete process.env.CASCADE_PROJECT_ID;
	delete process.env.CASCADE_PM_TYPE;
	delete process.env.CASCADE_PROJECT_NAME;
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

	it('accepts any string for category and severity (loosened 2026-05-10 — see plan)', async () => {
		// Originally enforced an enum (8 categories × 4 severities) via
		// `requireEnum`. Loosened after prod run `ff6adf00` showed an agent
		// taking the gadget describe text literally and oclif rejecting
		// `--severity 'medium slowdown'`. We now pass through whatever the
		// agent provides; cluster + re-tighten once we have real usage data.
		const path = sidecarPath();
		const result = await reportFriction({
			project,
			sidecarPath: path,
			summary: 'Quirky friction',
			details: 'Agent invented a label that used to reject.',
			category: 'something-not-in-the-old-enum',
			severity: 'medium slowdown',
		});

		// Either filed (if materializer succeeds in this test setup) or
		// queued_slot_missing (if the project under test lacks a friction
		// slot). Both prove the validation gate no longer rejects.
		expect(['filed', 'queued_slot_missing', 'queued_for_retry']).toContain(result.status);

		// The queued sidecar event records the values verbatim — pin that
		// the report stored what the agent passed.
		const events = readFileSync(path, 'utf-8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
		const queued = events.find((e) => e.event === 'queued');
		expect(queued?.report.category).toBe('something-not-in-the-old-enum');
		expect(queued?.report.severity).toBe('medium slowdown');
		rmSync(path, { force: true });
	});

	it('uses SessionState for run/work-item/PR metadata when env vars are absent (LLMist in-process path)', async () => {
		// In LLMist (in-process gadgets), projectSecrets are NOT exported to process.env.
		// All metadata must be sourced from SessionState; env vars are intentionally absent.
		const path = sidecarPath();
		const state = createSessionState();
		state.init({
			agentType: 'implementation',
			projectId: 'project-1',
			workItemId: 'card-123',
			workItemUrl: 'https://trello.com/c/card123',
			workItemTitle: 'Runtime metadata',
			frictionSidecarPath: path,
			runId: 'run-123',
			prNumber: 77,
			prUrl: 'https://github.com/o/r/pull/77',
			prTitle: 'fix: runtime metadata',
			prBranch: 'feature/runtime-metadata',
			initialHeadSha: 'abc123sha',
			engineLabel: 'llmist',
			model: 'gpt-4o',
		});
		setDefaultSessionState(state);
		// CASCADE_DASHBOARD_URL is a global infra config, available in process.env even for LLMist
		process.env.CASCADE_DASHBOARD_URL = 'https://dashboard.example.com';
		// Confirm none of the per-run secrets are in env (simulating LLMist production environment)
		// The beforeEach already deletes CASCADE_RUN_ID, CASCADE_WORK_ITEM_ID, etc.
		mockMaterializeFrictionReport.mockResolvedValue({
			status: 'filed',
			reportId: 'ignored',
			workItemId: 'friction-card',
		});

		await reportFriction({
			project,
			summary: 'Context attached',
			details: 'The report should carry run/work item/PR metadata from SessionState.',
			category: 'tooling',
			severity: 'medium',
		});

		const event = JSON.parse(readFileSync(path, 'utf-8').trim().split('\n')[0]);
		expect(event.report.context).toMatchObject({
			agent: {
				type: 'implementation',
				engine: 'llmist',
				model: 'gpt-4o',
			},
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
				branch: 'feature/runtime-metadata',
				headSha: 'abc123sha',
			},
		});
		rmSync(path, { force: true });
	});

	it('uses project from SessionState when params.project is absent (production ReportFriction wrapper path)', async () => {
		// The production ReportFriction.ts gadget does NOT pass params.project.
		// In LLMist, projectSecrets are NOT exported to process.env, so projectFromEnv()
		// would produce 'unknown-project'/empty PM config. The project must come from
		// SessionState (stored by LLMist via createConfiguredBuilder → initSessionState).
		const path = sidecarPath();
		const sessionProject = {
			id: 'real-project-id',
			orgId: 'org-1',
			name: 'Real Project',
			repo: 'owner/real-repo',
			pm: { type: 'trello' as const },
			trello: {
				boardId: 'board-real',
				lists: { friction: 'list-friction-real' },
				labels: {},
			},
		} as ProjectConfig;
		const state = createSessionState();
		state.init({
			agentType: 'implementation',
			projectId: 'real-project-id',
			project: sessionProject,
			frictionSidecarPath: path,
		});
		setDefaultSessionState(state);
		// Simulate LLMist env: no project secrets exported
		// (beforeEach already clears CASCADE_PROJECT_ID, etc.)
		mockMaterializeFrictionReport.mockResolvedValue({
			status: 'filed',
			reportId: 'ignored',
			workItemId: 'friction-card-real',
		});

		// Crucially: NO params.project — this is what the production wrapper does
		await reportFriction({
			summary: 'Missing config',
			details: 'Need better docs.',
			category: 'tooling',
			severity: 'low',
		});

		const event = JSON.parse(readFileSync(path, 'utf-8').trim().split('\n')[0]);
		// The report must carry the real project context, not 'unknown-project'
		expect(event.report.context.project).toMatchObject({
			id: 'real-project-id',
			name: 'Real Project',
			repo: 'owner/real-repo',
			pmType: 'trello',
		});
		// Materialization must receive the real project so drain can place the card correctly
		expect(mockMaterializeFrictionReport).toHaveBeenCalledWith(
			expect.objectContaining({
				project: expect.objectContaining({ id: 'real-project-id' }),
			}),
		);
		rmSync(path, { force: true });
	});
});
