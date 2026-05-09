import { randomUUID } from 'node:crypto';
import { materializeFrictionReport } from '../../../friction/materialize.js';
import {
	appendFiledFrictionReport,
	appendQueuedFrictionReport,
} from '../../../friction/sidecar.js';
import type {
	FrictionCategory,
	FrictionReport,
	FrictionSeverity,
} from '../../../friction/types.js';
import type { ProjectConfig } from '../../../types/index.js';

const FRICTION_SIDECAR_ENV_VAR = 'CASCADE_FRICTION_SIDECAR_PATH';
const DEFAULT_FRICTION_SIDECAR_PATH = '.cascade/friction-reports.jsonl';

const CATEGORIES = [
	'tooling',
	'environment',
	'permissions',
	'dependency',
	'test-failure',
	'pm-data',
	'scm-data',
	'other',
] as const satisfies readonly FrictionCategory[];

const SEVERITIES = [
	'low',
	'medium',
	'high',
	'critical',
] as const satisfies readonly FrictionSeverity[];

export interface ReportFrictionParams {
	summary: string;
	details: string;
	category: FrictionCategory;
	severity: FrictionSeverity;
	whileDoing?: string;
	project?: ProjectConfig;
	sidecarPath?: string;
}

export type ReportFrictionResult =
	| {
			status: 'filed';
			reportId: string;
			workItemId: string;
			workItemUrl?: string;
			message: string;
	  }
	| {
			status: 'queued_for_retry';
			reportId: string;
			message: string;
	  }
	| {
			status: 'queued_slot_missing';
			reportId: string;
			message: string;
	  };

function parseJsonRecord(value: string | undefined): Record<string, string> {
	if (!value) return {};
	const parsed = JSON.parse(value) as unknown;
	return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
		? (parsed as Record<string, string>)
		: {};
}

function projectFromEnv(): ProjectConfig {
	const pmType = process.env.CASCADE_PM_TYPE as ProjectConfig['pm']['type'] | undefined;
	const base = {
		id: process.env.CASCADE_PROJECT_ID ?? 'unknown-project',
		orgId: process.env.CASCADE_ORG_ID ?? 'unknown-org',
		name: process.env.CASCADE_PROJECT_NAME ?? process.env.CASCADE_PROJECT_ID ?? 'Unknown project',
		repo:
			process.env.CASCADE_REPO_OWNER && process.env.CASCADE_REPO_NAME
				? `${process.env.CASCADE_REPO_OWNER}/${process.env.CASCADE_REPO_NAME}`
				: undefined,
		pm: { type: pmType ?? 'trello' },
	} as ProjectConfig;

	if (base.pm.type === 'jira') {
		return {
			...base,
			jira: {
				projectKey: process.env.CASCADE_JIRA_PROJECT_KEY ?? '',
				baseUrl: process.env.CASCADE_JIRA_BASE_URL ?? process.env.JIRA_BASE_URL ?? '',
				statuses: parseJsonRecord(process.env.CASCADE_JIRA_STATUSES),
			},
		} as ProjectConfig;
	}
	if (base.pm.type === 'linear') {
		return {
			...base,
			linear: {
				teamId: process.env.CASCADE_LINEAR_TEAM_ID ?? '',
				...(process.env.CASCADE_LINEAR_PROJECT_ID
					? { projectId: process.env.CASCADE_LINEAR_PROJECT_ID }
					: {}),
				statuses: parseJsonRecord(process.env.CASCADE_LINEAR_STATUSES),
			},
		} as ProjectConfig;
	}
	return {
		...base,
		trello: {
			boardId: process.env.CASCADE_TRELLO_BOARD_ID ?? '',
			lists: parseJsonRecord(process.env.CASCADE_TRELLO_LISTS),
			labels: parseJsonRecord(process.env.CASCADE_TRELLO_LABELS),
		},
	} as ProjectConfig;
}

function requireEnum<T extends string>(value: string, allowed: readonly T[], name: string): T {
	if ((allowed as readonly string[]).includes(value)) return value as T;
	throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
}

function buildReport(params: ReportFrictionParams, project: ProjectConfig): FrictionReport {
	return {
		reportId: randomUUID(),
		summary: params.summary,
		details: params.details,
		category: requireEnum(params.category, CATEGORIES, 'category'),
		severity: requireEnum(params.severity, SEVERITIES, 'severity'),
		whileDoing: params.whileDoing?.trim() || 'not specified',
		createdAt: new Date().toISOString(),
		context: {
			project: {
				id: project.id,
				name: project.name,
				repo: project.repo,
				pmType: project.pm?.type,
			},
			agent: {
				type: process.env.CASCADE_AGENT_TYPE ?? 'unknown',
				engine: process.env.CASCADE_ENGINE_LABEL,
				model: process.env.CASCADE_MODEL,
			},
			run: {
				id: process.env.CASCADE_RUN_ID,
				url:
					process.env.CASCADE_DASHBOARD_URL && process.env.CASCADE_RUN_ID
						? `${process.env.CASCADE_DASHBOARD_URL.replace(/\/$/, '')}/runs/${process.env.CASCADE_RUN_ID}`
						: undefined,
			},
			workItem: {
				id: process.env.CASCADE_WORK_ITEM_ID,
				title: process.env.CASCADE_WORK_ITEM_TITLE,
				url: process.env.CASCADE_WORK_ITEM_URL,
			},
			pr: {
				branch: process.env.CASCADE_PR_BRANCH,
				headSha: process.env.CASCADE_INITIAL_HEAD_SHA,
			},
		},
	};
}

export async function reportFriction(params: ReportFrictionParams): Promise<ReportFrictionResult> {
	const project = params.project ?? projectFromEnv();
	const sidecarPath =
		params.sidecarPath ?? process.env[FRICTION_SIDECAR_ENV_VAR] ?? DEFAULT_FRICTION_SIDECAR_PATH;
	const report = buildReport(params, project);

	await appendQueuedFrictionReport(sidecarPath, report, report.createdAt);

	try {
		const result = await materializeFrictionReport({ project, report });
		if (result.status === 'skipped') {
			return {
				status: 'queued_slot_missing',
				reportId: report.reportId,
				message: result.message,
			};
		}

		await appendFiledFrictionReport(sidecarPath, {
			reportId: report.reportId,
			workItemId: result.workItemId,
			workItemUrl: result.workItemUrl,
		});
		return {
			status: 'filed',
			reportId: report.reportId,
			workItemId: result.workItemId,
			workItemUrl: result.workItemUrl,
			message: `Friction report filed: ${result.workItemUrl ?? result.workItemId}`,
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			status: 'queued_for_retry',
			reportId: report.reportId,
			message: `Friction report queued for retry after filing failed: ${message}`,
		};
	}
}
