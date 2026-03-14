import { type SQL, eq, sql } from 'drizzle-orm';
import { validateConfig } from '../../config/schema.js';
import type { CascadeConfig, ProjectConfig } from '../../types/index.js';
import { getDb } from '../client.js';
import { agentConfigs, projectIntegrations, projects } from '../schema/index.js';
import {
	type AgentConfigRow,
	type IntegrationRow,
	extractIntegrationConfigs,
	mapProjectRow,
} from './configMapper.js';

// ---------------------------------------------------------------------------
// Shared config builder — eliminates duplicated extract→split→map→validate
// ---------------------------------------------------------------------------

interface BuildRawConfigOpts {
	projectRows: Array<typeof projects.$inferSelect>;
	/** All integration rows for all projects in projectRows */
	integrationRows: IntegrationRow[];
	/** Per-project agent configs, keyed by project ID */
	projectAgentConfigsMap: Map<string, AgentConfigRow[]>;
}

function buildRawConfig({
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

export async function loadConfigFromDb(): Promise<CascadeConfig> {
	const db = getDb();

	const [projectRows, allAgentConfigs, integrationRows] = await Promise.all([
		db.select().from(projects),
		loadAgentConfigs(),
		db.select().from(projectIntegrations),
	]);

	// All agent configs are project-scoped (project_id IS NOT NULL) after migration 0036
	const projectAgentConfigsMap = new Map<string, AgentConfigRow[]>();
	for (const ac of allAgentConfigs) {
		const existing = projectAgentConfigsMap.get(ac.projectId) ?? [];
		existing.push(ac);
		projectAgentConfigsMap.set(ac.projectId, existing);
	}

	const rawConfig = buildRawConfig({
		projectRows,
		integrationRows: integrationRows as IntegrationRow[],
		projectAgentConfigsMap,
	});

	return validateConfig(rawConfig);
}

async function findProjectConfigFromDb(
	whereClause: SQL,
): Promise<{ project: ProjectConfig; config: CascadeConfig } | undefined> {
	const db = getDb();
	const [row] = await db.select().from(projects).where(whereClause);
	if (!row) return undefined;

	const [projectAcs, integrations] = await Promise.all([
		db.select().from(agentConfigs).where(eq(agentConfigs.projectId, row.id)),
		db.select().from(projectIntegrations).where(eq(projectIntegrations.projectId, row.id)),
	]);

	const projectAgentConfigsMap = new Map<string, AgentConfigRow[]>([[row.id, projectAcs]]);

	const rawConfig = buildRawConfig({
		projectRows: [row],
		integrationRows: integrations as IntegrationRow[],
		projectAgentConfigsMap,
	});

	const config = validateConfig(rawConfig);
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
