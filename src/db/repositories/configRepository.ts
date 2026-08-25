import { and, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { validateConfig } from '../../config/schema.js';
import type { CascadeConfig, ProjectConfig } from '../../types/index.js';
import { getDb } from '../client.js';
import { agentConfigs, projectIntegrations, projects } from '../schema/index.js';
import {
	type AgentConfigRow,
	extractIntegrationConfigs,
	type IntegrationRow,
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
			const { trelloConfig, jiraConfig, linearConfig, githubConfig } =
				extractIntegrationConfigs(integrations);
			return mapProjectRow({
				row,
				projectAgentConfigs: projectAgentConfigsMap.get(row.id) ?? [],
				trelloConfig,
				jiraConfig,
				linearConfig,
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

/**
 * Multi-row sibling of {@link findProjectFromDb} (spec 024).
 *
 * Shared board keys and shared repositories mean a where-clause can legitimately
 * match several projects; this returns all of them, hydrated the same way, so
 * callers can decide between siblings instead of taking whichever row came back
 * first. Ordered by project id so the sibling list — which surfaces verbatim in
 * operator-facing skip messages — is stable across restarts.
 */
async function findProjectsFromDb(whereClause: SQL): Promise<ProjectConfig[]> {
	const db = getDb();
	const rows = await db.select().from(projects).where(whereClause).orderBy(projects.id);
	if (rows.length === 0) return [];

	const ids = rows.map((r) => r.id);
	const [allAgentConfigs, integrations] = await Promise.all([
		db.select().from(agentConfigs).where(inArray(agentConfigs.projectId, ids)),
		db.select().from(projectIntegrations).where(inArray(projectIntegrations.projectId, ids)),
	]);

	const projectAgentConfigsMap = new Map<string, AgentConfigRow[]>(ids.map((id) => [id, []]));
	for (const ac of allAgentConfigs) {
		projectAgentConfigsMap.get(ac.projectId)?.push(ac);
	}

	const rawConfig = buildRawConfig({
		projectRows: rows,
		integrationRows: integrations as IntegrationRow[],
		projectAgentConfigsMap,
	});

	return validateConfig(rawConfig).projects;
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

const linearTeamIdWhereClause = (teamId: string) =>
	sql`${projects.id} IN (
		SELECT ${projectIntegrations.projectId} FROM ${projectIntegrations}
		WHERE ${projectIntegrations.provider} = 'linear'
		AND ${projectIntegrations.config}->>'teamId' = ${teamId}
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

/**
 * Every project configured against a JIRA project key (spec 024).
 *
 * The singular variant above answers "some project on this key", which is only
 * correct while a key has one owner. Shared-board routing needs the whole set
 * so the resolver can pick by discriminator instead of by position.
 */
export function findProjectsByJiraProjectKeyFromDb(projectKey: string): Promise<ProjectConfig[]> {
	return findProjectsFromDb(jiraProjectKeyWhereClause(projectKey));
}

/**
 * The id + primacy of every project on a repository (spec 024).
 *
 * Deliberately NOT a `ProjectConfig[]`: `repoPrimary` is a column, not part of
 * the hand-written config projection, so hydrating full configs here would
 * return siblings that cannot say which of them is the primary — the one thing
 * the caller needs. Ordered by id so operator-facing messages are stable.
 */
export async function findRepoSiblingsFromDb(
	repo: string,
	orgId: string,
): Promise<Array<{ id: string; repoPrimary: boolean }>> {
	const db = getDb();
	return (
		db
			.select({ id: projects.id, repoPrimary: projects.repoPrimary })
			.from(projects)
			// Org-scoped: these ids are rendered verbatim into operator-facing errors,
			// so an unscoped lookup would name another tenant's project.
			.where(and(eq(projects.repo, repo), eq(projects.orgId, orgId)))
			.orderBy(projects.id)
	);
}

/**
 * The primary project for a repository (spec 024) — the one that owns GitHub
 * events carrying no PR->project link. DB-enforced unique per repo by
 * `uq_projects_repo_primary`.
 */
export function findPrimaryProjectByRepoFromDb(repo: string): Promise<ProjectConfig | undefined> {
	return findProjectFromDb(and(eq(projects.repo, repo), eq(projects.repoPrimary, true)) as SQL);
}

export function findProjectByLinearTeamIdFromDb(
	teamId: string,
): Promise<ProjectConfig | undefined> {
	return findProjectFromDb(linearTeamIdWhereClause(teamId));
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

export function findProjectWithConfigByLinearTeamId(
	teamId: string,
): Promise<ProjectWithConfig | undefined> {
	return findProjectConfigFromDb(linearTeamIdWhereClause(teamId));
}
