import { type SQL, and, eq, isNull, sql } from 'drizzle-orm';
import { mergeEngineSettings } from '../../config/engineSettings.js';
import { validateConfig } from '../../config/schema.js';
import type { CascadeConfig, ProjectConfig } from '../../types/index.js';
import { getDb } from '../client.js';
import { agentConfigs, cascadeDefaults, projectIntegrations, projects } from '../schema/index.js';
import {
	type AgentConfigRow,
	type DefaultsRow,
	type IntegrationRow,
	extractIntegrationConfigs,
	mapDefaultsRow,
	mapProjectRow,
} from './configMapper.js';

// ---------------------------------------------------------------------------
// Shared config builder — eliminates duplicated extract→split→map→validate
// ---------------------------------------------------------------------------

interface BuildRawConfigOpts {
	defaultsRow: DefaultsRow | undefined;
	globalAgentConfigs: AgentConfigRow[];
	projectRows: Array<typeof projects.$inferSelect>;
	/** All integration rows for all projects in projectRows */
	integrationRows: IntegrationRow[];
	/** Per-project agent configs, keyed by project ID */
	projectAgentConfigsMap: Map<string, AgentConfigRow[]>;
}

function buildRawConfig({
	defaultsRow,
	globalAgentConfigs,
	projectRows,
	integrationRows,
	projectAgentConfigsMap,
}: BuildRawConfigOpts) {
	// Index integrations by project ID
	const integrationsByProject = new Map<string, IntegrationRow[]>();
	for (const row of integrationRows) {
		const existing = integrationsByProject.get(row.projectId as string) ?? [];
		existing.push(row);
		integrationsByProject.set(row.projectId as string, existing);
	}

	return {
		defaults: mapDefaultsRow(defaultsRow, globalAgentConfigs),
		projects: projectRows.map((row) => {
			const integrations = integrationsByProject.get(row.id) ?? [];
			const { trelloConfig, jiraConfig, githubConfig } = extractIntegrationConfigs(integrations);
			return mapProjectRow({
				row,
				projectAgentConfigs: projectAgentConfigsMap.get(row.id) ?? [],
				trelloConfig,
				jiraConfig,
				githubConfig,
			});
		}),
	};
}

async function loadAgentConfigs(): Promise<AgentConfigRow[]> {
	const db = getDb();
	return db.select().from(agentConfigs);
}

function applyProjectEngineSettings(config: CascadeConfig): CascadeConfig {
	return {
		...config,
		projects: config.projects.map((project) => ({
			...project,
			engineSettings: mergeEngineSettings(config.defaults.engineSettings, project.engineSettings),
		})),
	};
}

export async function loadConfigFromDb(): Promise<CascadeConfig> {
	const db = getDb();

	const [defaultsRow, projectRows, allAgentConfigs, integrationRows] = await Promise.all([
		db
			.select()
			.from(cascadeDefaults)
			.limit(1)
			.then((r) => r[0]),
		db.select().from(projects),
		loadAgentConfigs(),
		db.select().from(projectIntegrations),
	]);

	// Split agent configs: global (project_id IS NULL, org_id IS NULL) and per-project
	// Also collect org-level configs (org_id set, project_id IS NULL) as fallback globals
	const globalAgentConfigs = allAgentConfigs.filter(
		(ac) => ac.projectId === null && ac.orgId === null,
	);
	const orgAgentConfigsMap = new Map<string, AgentConfigRow[]>();
	const projectAgentConfigsMap = new Map<string, AgentConfigRow[]>();
	for (const ac of allAgentConfigs) {
		if (ac.projectId !== null) {
			const existing = projectAgentConfigsMap.get(ac.projectId) ?? [];
			existing.push(ac);
			projectAgentConfigsMap.set(ac.projectId, existing);
		} else if (ac.orgId !== null) {
			const existing = orgAgentConfigsMap.get(ac.orgId) ?? [];
			existing.push(ac);
			orgAgentConfigsMap.set(ac.orgId, existing);
		}
	}

	// Merge global + org-level agent configs for defaults
	const mergedGlobalConfigs = [
		...globalAgentConfigs,
		...(defaultsRow ? (orgAgentConfigsMap.get(defaultsRow.orgId) ?? []) : []),
	];

	const rawConfig = buildRawConfig({
		defaultsRow,
		globalAgentConfigs: mergedGlobalConfigs,
		projectRows,
		integrationRows: integrationRows as IntegrationRow[],
		projectAgentConfigsMap,
	});

	return applyProjectEngineSettings(validateConfig(rawConfig));
}

async function findProjectConfigFromDb(
	whereClause: SQL,
): Promise<{ project: ProjectConfig; config: CascadeConfig } | undefined> {
	const db = getDb();
	const [row] = await db.select().from(projects).where(whereClause);
	if (!row) return undefined;

	const [projectAcs, orgAcs, globalAcs, defaultsRow, integrations] = await Promise.all([
		db.select().from(agentConfigs).where(eq(agentConfigs.projectId, row.id)),
		db
			.select()
			.from(agentConfigs)
			.where(and(eq(agentConfigs.orgId, row.orgId), isNull(agentConfigs.projectId))),
		db
			.select()
			.from(agentConfigs)
			.where(and(isNull(agentConfigs.projectId), isNull(agentConfigs.orgId))),
		db
			.select()
			.from(cascadeDefaults)
			.where(eq(cascadeDefaults.orgId, row.orgId))
			.then((r) => r[0]),
		db.select().from(projectIntegrations).where(eq(projectIntegrations.projectId, row.id)),
	]);

	const projectAgentConfigsMap = new Map<string, AgentConfigRow[]>([[row.id, projectAcs]]);

	const rawConfig = buildRawConfig({
		defaultsRow,
		globalAgentConfigs: [...globalAcs, ...orgAcs],
		projectRows: [row],
		integrationRows: integrations as IntegrationRow[],
		projectAgentConfigsMap,
	});

	const config = applyProjectEngineSettings(validateConfig(rawConfig));
	return { project: config.projects[0], config };
}

async function findProjectFromDb(whereClause: SQL): Promise<ProjectConfig | undefined> {
	const result = await findProjectConfigFromDb(whereClause);
	return result?.project;
}

type ProjectWithConfig = { project: ProjectConfig; config: CascadeConfig };

const boardIdWhereClause = (boardId: string) =>
	sql`${projects.id} IN (
		SELECT ${projectIntegrations.projectId} FROM ${projectIntegrations}
		WHERE ${projectIntegrations.provider} = 'trello'
		AND ${projectIntegrations.config}->>'boardId' = ${boardId}
	)`;

const jiraProjectKeyWhereClause = (projectKey: string) =>
	sql`${projects.id} IN (
		SELECT ${projectIntegrations.projectId} FROM ${projectIntegrations}
		WHERE ${projectIntegrations.provider} = 'jira'
		AND ${projectIntegrations.config}->>'projectKey' = ${projectKey}
	)`;

export function findProjectByBoardIdFromDb(boardId: string): Promise<ProjectConfig | undefined> {
	return findProjectFromDb(boardIdWhereClause(boardId));
}

export function findProjectByRepoFromDb(repo: string): Promise<ProjectConfig | undefined> {
	return findProjectFromDb(eq(projects.repo, repo));
}

export function findProjectByIdFromDb(id: string): Promise<ProjectConfig | undefined> {
	return findProjectFromDb(eq(projects.id, id));
}

export function findProjectByJiraProjectKeyFromDb(
	projectKey: string,
): Promise<ProjectConfig | undefined> {
	return findProjectFromDb(jiraProjectKeyWhereClause(projectKey));
}

// WithConfig variants — return both the project and its org-scoped CascadeConfig

export function findProjectWithConfigByBoardId(
	boardId: string,
): Promise<ProjectWithConfig | undefined> {
	return findProjectConfigFromDb(boardIdWhereClause(boardId));
}

export function findProjectWithConfigByRepo(repo: string): Promise<ProjectWithConfig | undefined> {
	return findProjectConfigFromDb(eq(projects.repo, repo));
}

export function findProjectWithConfigById(id: string): Promise<ProjectWithConfig | undefined> {
	return findProjectConfigFromDb(eq(projects.id, id));
}

export function findProjectWithConfigByJiraProjectKey(
	projectKey: string,
): Promise<ProjectWithConfig | undefined> {
	return findProjectConfigFromDb(jiraProjectKeyWhereClause(projectKey));
}
