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
	// Clear JIRA env-synthesis vars so each env-reconstruction test starts clean.
	delete process.env.CASCADE_JIRA_PROJECT_KEY;
	delete process.env.CASCADE_JIRA_BASE_URL;
	delete process.env.JIRA_BASE_URL;
	delete process.env.CASCADE_JIRA_STATUSES;
	delete process.env.CASCADE_JIRA_AUTH_TYPE;
	// Clear Linear env-synthesis vars.
	delete process.env.CASCADE_LINEAR_TEAM_ID;
	delete process.env.CASCADE_LINEAR_PROJECT_ID;
	delete process.env.CASCADE_LINEAR_STATUSES;
	// Clear GitHub Projects env-synthesis vars.
	delete process.env.CASCADE_GITHUB_PROJECTS_PROJECT_ID;
	delete process.env.CASCADE_GITHUB_PROJECTS_OWNER;
	delete process.env.CASCADE_GITHUB_PROJECTS_OWNER_TYPE;
	delete process.env.CASCADE_GITHUB_PROJECTS_STATUSES;
	delete process.env.CASCADE_GITHUB_PROJECTS_LABELS;
	// Clear Trello env-synthesis vars.
	delete process.env.CASCADE_TRELLO_BOARD_ID;
	delete process.env.CASCADE_TRELLO_LISTS;
	delete process.env.CASCADE_TRELLO_LABELS;
	delete process.env.CASCADE_REPO_OWNER;
	delete process.env.CASCADE_REPO_NAME;
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

	it('env-synthesized JIRA config carries authType from CASCADE_JIRA_AUTH_TYPE (MNG-1741)', async () => {
		// No params.project + empty SessionState → projectFromEnv() reconstruction.
		const path = sidecarPath();
		process.env.CASCADE_PROJECT_ID = 'jira-project';
		process.env.CASCADE_PM_TYPE = 'jira';
		process.env.CASCADE_JIRA_PROJECT_KEY = 'CASCADE';
		process.env.CASCADE_JIRA_BASE_URL = 'https://acme.atlassian.net';
		process.env.CASCADE_JIRA_AUTH_TYPE = 'scoped';
		mockMaterializeFrictionReport.mockResolvedValue({
			status: 'filed',
			reportId: 'ignored',
			workItemId: 'CASCADE-1',
		});

		await reportFriction({
			sidecarPath: path,
			summary: 'JIRA auth mode carried',
			details: 'The synthesized project must carry authType so in-worker calls use the right host.',
			category: 'tooling',
			severity: 'low',
		});

		// Materialization must receive the synthesized JIRA project with authType set.
		expect(mockMaterializeFrictionReport).toHaveBeenCalledWith(
			expect.objectContaining({
				project: expect.objectContaining({
					jira: expect.objectContaining({ authType: 'scoped' }),
				}),
			}),
		);
		rmSync(path, { force: true });
	});

	it("env-synthesized JIRA config defaults authType to 'basic' when CASCADE_JIRA_AUTH_TYPE is unset (MNG-1741)", async () => {
		const path = sidecarPath();
		process.env.CASCADE_PROJECT_ID = 'jira-project';
		process.env.CASCADE_PM_TYPE = 'jira';
		process.env.CASCADE_JIRA_PROJECT_KEY = 'CASCADE';
		process.env.CASCADE_JIRA_BASE_URL = 'https://acme.atlassian.net';
		// CASCADE_JIRA_AUTH_TYPE intentionally unset → normalizes to 'basic'.
		mockMaterializeFrictionReport.mockResolvedValue({
			status: 'filed',
			reportId: 'ignored',
			workItemId: 'CASCADE-2',
		});

		await reportFriction({
			sidecarPath: path,
			summary: 'JIRA default auth mode',
			details: 'Absent env var should synthesize basic to preserve existing projects.',
			category: 'tooling',
			severity: 'low',
		});

		expect(mockMaterializeFrictionReport).toHaveBeenCalledWith(
			expect.objectContaining({
				project: expect.objectContaining({
					jira: expect.objectContaining({ authType: 'basic' }),
				}),
			}),
		);
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

	it('env-synthesized LINEAR config carries teamId, projectId, and parsed statuses (MNG-1050)', async () => {
		const path = sidecarPath();
		process.env.CASCADE_PROJECT_ID = 'linear-project';
		process.env.CASCADE_PM_TYPE = 'linear';
		process.env.CASCADE_LINEAR_TEAM_ID = 'team-1';
		process.env.CASCADE_LINEAR_PROJECT_ID = 'proj-1';
		process.env.CASCADE_LINEAR_STATUSES = JSON.stringify({ friction: 'state-uuid-1' });
		mockMaterializeFrictionReport.mockResolvedValue({
			status: 'filed',
			reportId: 'ignored',
			workItemId: 'LIN-1',
		});

		await reportFriction({
			sidecarPath: path,
			summary: 'Linear env synthesis',
			details: 'The synthesized project must carry Linear connection details.',
			category: 'tooling',
			severity: 'low',
		});

		expect(mockMaterializeFrictionReport).toHaveBeenCalledWith(
			expect.objectContaining({
				project: expect.objectContaining({
					linear: {
						teamId: 'team-1',
						projectId: 'proj-1',
						statuses: { friction: 'state-uuid-1' },
					},
				}),
			}),
		);
		rmSync(path, { force: true });
	});

	it('env-synthesized LINEAR config omits projectId when CASCADE_LINEAR_PROJECT_ID is unset', async () => {
		const path = sidecarPath();
		process.env.CASCADE_PROJECT_ID = 'linear-project';
		process.env.CASCADE_PM_TYPE = 'linear';
		process.env.CASCADE_LINEAR_TEAM_ID = 'team-2';
		mockMaterializeFrictionReport.mockResolvedValue({
			status: 'filed',
			reportId: 'ignored',
			workItemId: 'LIN-2',
		});

		await reportFriction({
			sidecarPath: path,
			summary: 'Linear env synthesis without project scope',
			details: 'CASCADE_LINEAR_PROJECT_ID absent must not add a projectId key.',
			category: 'tooling',
			severity: 'low',
		});

		expect(mockMaterializeFrictionReport).toHaveBeenCalledWith(
			expect.objectContaining({
				project: expect.objectContaining({
					linear: { teamId: 'team-2', statuses: {} },
				}),
			}),
		);
		const call = mockMaterializeFrictionReport.mock.calls[0][0] as {
			project: { linear: Record<string, unknown> };
		};
		expect(call.project.linear).not.toHaveProperty('projectId');
		rmSync(path, { force: true });
	});

	it('env-synthesized GITHUB PROJECTS config carries projectId, owner, ownerType, statuses, and labels (MNG-1050)', async () => {
		const path = sidecarPath();
		process.env.CASCADE_PROJECT_ID = 'gh-projects-project';
		process.env.CASCADE_PM_TYPE = 'github-projects';
		process.env.CASCADE_GITHUB_PROJECTS_PROJECT_ID = 'PVT_1';
		process.env.CASCADE_GITHUB_PROJECTS_OWNER = 'acme-org';
		process.env.CASCADE_GITHUB_PROJECTS_OWNER_TYPE = 'organization';
		process.env.CASCADE_GITHUB_PROJECTS_STATUSES = JSON.stringify({ friction: 'Friction' });
		process.env.CASCADE_GITHUB_PROJECTS_LABELS = JSON.stringify({ 'cascade-friction': 'label-1' });
		mockMaterializeFrictionReport.mockResolvedValue({
			status: 'filed',
			reportId: 'ignored',
			workItemId: 'gh-item-1',
		});

		await reportFriction({
			sidecarPath: path,
			summary: 'GitHub Projects env synthesis',
			details: 'The synthesized project must carry GitHub Projects connection details.',
			category: 'tooling',
			severity: 'low',
		});

		expect(mockMaterializeFrictionReport).toHaveBeenCalledWith(
			expect.objectContaining({
				project: expect.objectContaining({
					githubProjects: {
						projectId: 'PVT_1',
						owner: 'acme-org',
						ownerType: 'organization',
						statuses: { friction: 'Friction' },
						labels: { 'cascade-friction': 'label-1' },
					},
				}),
			}),
		);
		rmSync(path, { force: true });
	});

	it('env-synthesized GITHUB PROJECTS config defaults ownerType to user and omits labels when unset', async () => {
		const path = sidecarPath();
		process.env.CASCADE_PROJECT_ID = 'gh-projects-project';
		process.env.CASCADE_PM_TYPE = 'github-projects';
		process.env.CASCADE_GITHUB_PROJECTS_PROJECT_ID = 'PVT_2';
		process.env.CASCADE_GITHUB_PROJECTS_OWNER = 'octocat';
		mockMaterializeFrictionReport.mockResolvedValue({
			status: 'filed',
			reportId: 'ignored',
			workItemId: 'gh-item-2',
		});

		await reportFriction({
			sidecarPath: path,
			summary: 'GitHub Projects env synthesis without labels',
			details: 'CASCADE_GITHUB_PROJECTS_LABELS absent must not add a labels key.',
			category: 'tooling',
			severity: 'low',
		});

		expect(mockMaterializeFrictionReport).toHaveBeenCalledWith(
			expect.objectContaining({
				project: expect.objectContaining({
					githubProjects: {
						projectId: 'PVT_2',
						owner: 'octocat',
						ownerType: 'user',
						statuses: {},
					},
				}),
			}),
		);
		const call = mockMaterializeFrictionReport.mock.calls[0][0] as {
			project: { githubProjects: Record<string, unknown> };
		};
		expect(call.project.githubProjects).not.toHaveProperty('labels');
		rmSync(path, { force: true });
	});

	it('env-synthesized TRELLO config is the switch default when CASCADE_PM_TYPE is unset', async () => {
		const path = sidecarPath();
		process.env.CASCADE_PROJECT_ID = 'trello-project';
		// CASCADE_PM_TYPE intentionally unset — projectFromEnv() falls through the
		// switch's `default:` branch straight to trelloFromEnv().
		process.env.CASCADE_REPO_OWNER = 'acme';
		process.env.CASCADE_REPO_NAME = 'widgets';
		process.env.CASCADE_TRELLO_BOARD_ID = 'board-99';
		process.env.CASCADE_TRELLO_LISTS = JSON.stringify({ friction: 'list-friction-99' });
		process.env.CASCADE_TRELLO_LABELS = JSON.stringify({ 'cascade-friction': 'label-99' });
		mockMaterializeFrictionReport.mockResolvedValue({
			status: 'filed',
			reportId: 'ignored',
			workItemId: 'card-99',
		});

		await reportFriction({
			sidecarPath: path,
			summary: 'Trello env synthesis via switch default',
			details: 'No CASCADE_PM_TYPE set — must fall through to the Trello default branch.',
			category: 'tooling',
			severity: 'low',
		});

		expect(mockMaterializeFrictionReport).toHaveBeenCalledWith(
			expect.objectContaining({
				project: expect.objectContaining({
					repo: 'acme/widgets',
					trello: {
						boardId: 'board-99',
						lists: { friction: 'list-friction-99' },
						labels: { 'cascade-friction': 'label-99' },
					},
				}),
			}),
		);
		rmSync(path, { force: true });
	});

	it('parseJsonRecord returns {} when the env var parses to a non-object JSON value', async () => {
		const path = sidecarPath();
		process.env.CASCADE_PROJECT_ID = 'linear-project';
		process.env.CASCADE_PM_TYPE = 'linear';
		process.env.CASCADE_LINEAR_TEAM_ID = 'team-3';
		// A JSON array is valid JSON but not a plain object — parseJsonRecord's
		// object/array guard must fall through to the {} branch instead of
		// passing an array through as "statuses".
		process.env.CASCADE_LINEAR_STATUSES = JSON.stringify(['friction']);
		mockMaterializeFrictionReport.mockResolvedValue({
			status: 'filed',
			reportId: 'ignored',
			workItemId: 'LIN-3',
		});

		await reportFriction({
			sidecarPath: path,
			summary: 'Non-object JSON env value',
			details: 'A JSON array value must not be treated as a status record.',
			category: 'tooling',
			severity: 'low',
		});

		expect(mockMaterializeFrictionReport).toHaveBeenCalledWith(
			expect.objectContaining({
				project: expect.objectContaining({
					linear: expect.objectContaining({ statuses: {} }),
				}),
			}),
		);
		rmSync(path, { force: true });
	});

	it('carries CASCADE_PR_NUMBER from process.env when set to a valid integer string', async () => {
		const path = sidecarPath();
		process.env.CASCADE_PR_NUMBER = '482';
		mockMaterializeFrictionReport.mockResolvedValue({
			status: 'filed',
			reportId: 'ignored',
			workItemId: 'card-pr-1',
		});

		await reportFriction({
			project,
			sidecarPath: path,
			summary: 'PR number from env',
			details: 'process.env.CASCADE_PR_NUMBER must be parsed into report.context.pr.number.',
			category: 'tooling',
			severity: 'low',
		});

		const event = JSON.parse(readFileSync(path, 'utf-8').trim().split('\n')[0]);
		expect(event.report.context.pr.number).toBe(482);
		rmSync(path, { force: true });
	});

	it('falls back to undefined PR number when CASCADE_PR_NUMBER is not a safe integer', async () => {
		const path = sidecarPath();
		process.env.CASCADE_PR_NUMBER = 'not-a-number';
		mockMaterializeFrictionReport.mockResolvedValue({
			status: 'filed',
			reportId: 'ignored',
			workItemId: 'card-pr-2',
		});

		await reportFriction({
			project,
			sidecarPath: path,
			summary: 'Invalid PR number from env',
			details:
				'A non-numeric CASCADE_PR_NUMBER must not crash and must yield an undefined PR number.',
			category: 'tooling',
			severity: 'low',
		});

		const event = JSON.parse(readFileSync(path, 'utf-8').trim().split('\n')[0]);
		expect(event.report.context.pr.number).toBeUndefined();
		rmSync(path, { force: true });
	});

	it('falls back to the default sidecar path when no override is provided anywhere', async () => {
		const defaultPath = join(process.cwd(), '.cascade', 'friction-reports.jsonl');
		rmSync(defaultPath, { force: true });
		mockMaterializeFrictionReport.mockResolvedValue({
			status: 'filed',
			reportId: 'ignored',
			workItemId: 'card-default-path',
		});

		try {
			// No params.sidecarPath, no FRICTION_SIDECAR_ENV_VAR, and a SessionState
			// with no frictionSidecarPath configured — must fall through to the
			// module's DEFAULT_FRICTION_SIDECAR_PATH constant.
			const result = await reportFriction({
				project,
				summary: 'No sidecar override anywhere',
				details: 'Must resolve to the default .cascade/friction-reports.jsonl path.',
				category: 'tooling',
				severity: 'low',
			});

			expect(result.status).toBe('filed');
			const events = readFileSync(defaultPath, 'utf-8')
				.trim()
				.split('\n')
				.map((line) => JSON.parse(line));
			expect(events.map((event) => event.event)).toEqual(['queued', 'filed']);
		} finally {
			rmSync(defaultPath, { force: true });
		}
	});
});
