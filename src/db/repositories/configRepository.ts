import { type SQL, and, eq, isNull, sql } from 'drizzle-orm';
import { validateConfig } from '../../config/schema.js';
import type { CascadeConfig, ProjectConfig } from '../../types/index.js';
import { getDb } from '../client.js';
import { agentConfigs, cascadeDefaults, projectIntegrations, projects } from '../schema/index.js';

interface TrelloIntegrationConfig {
	boardId: string;
	lists: Record<string, string>;
	labels: Record<string, string>;
	customFields?: { cost?: string };
}

interface JiraIntegrationConfig {
	projectKey: string;
	baseUrl: string;
	statuses: Record<string, string>;
	issueTypes?: Record<string, string>;
	customFields?: { cost?: string };
	labels?: Record<string, string>;
}

// biome-ignore lint/complexity/noBannedTypes: GitHub config has no fields (credentials are in integration_credentials)
type GitHubIntegrationConfig = {};

interface DefaultsRow {
	model: string | null;
	maxIterations: number | null;
	watchdogTimeoutMs: number | null;
	cardBudgetUsd: string | null;
	agentBackend: string | null;
	progressModel: string | null;
	progressIntervalMinutes: string | null;
}

interface AgentConfigRow {
	orgId: string | null;
	projectId: string | null;
	agentType: string;
	model: string | null;
	maxIterations: number | null;
	agentBackend: string | null;
	prompt: string | null;
}

function buildAgentMaps(configs: AgentConfigRow[]) {
	const models: Record<string, string> = {};
	const iterations: Record<string, number> = {};
	const prompts: Record<string, string> = {};
	const backends: Record<string, string> = {};
	for (const ac of configs) {
		if (ac.model) models[ac.agentType] = ac.model;
		if (ac.maxIterations != null) iterations[ac.agentType] = ac.maxIterations;
		if (ac.prompt) prompts[ac.agentType] = ac.prompt;
		if (ac.agentBackend) backends[ac.agentType] = ac.agentBackend;
	}
	return { models, iterations, prompts, backends };
}

function orUndefined<T extends Record<string, unknown>>(obj: T): T | undefined {
	return Object.keys(obj).length > 0 ? obj : undefined;
}

function mapDefaultsRow(row: DefaultsRow | undefined, globalAgentConfigs: AgentConfigRow[]) {
	const { models, iterations, prompts } = buildAgentMaps(globalAgentConfigs);

	return {
		model: row?.model ?? undefined,
		agentModels: orUndefined(models),
		maxIterations: row?.maxIterations ?? undefined,
		agentIterations: orUndefined(iterations),
		watchdogTimeoutMs: row?.watchdogTimeoutMs ?? undefined,
		cardBudgetUsd: row?.cardBudgetUsd ? Number(row.cardBudgetUsd) : undefined,
		agentBackend: row?.agentBackend ?? undefined,
		progressModel: row?.progressModel ?? undefined,
		progressIntervalMinutes: row?.progressIntervalMinutes
			? Number(row.progressIntervalMinutes)
			: undefined,
		prompts: orUndefined(prompts),
	};
}

type ProjectRow = typeof projects.$inferSelect;

interface IntegrationRow {
	category: string;
	provider: string;
	config: unknown;
	triggers: unknown;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: inherently maps multiple integration types
function mapProjectRow(
	row: ProjectRow,
	projectAgentConfigs: AgentConfigRow[],
	trelloConfig?: TrelloIntegrationConfig,
	trelloTriggers?: Record<string, boolean>,
	jiraConfig?: JiraIntegrationConfig,
	jiraTriggers?: Record<string, boolean>,
	_githubConfig?: GitHubIntegrationConfig,
	githubTriggers?: Record<string, boolean>,
): Record<string, unknown> {
	const { models, prompts, backends } = buildAgentMaps(projectAgentConfigs);

	// Derive PM type from integration config
	const pmType = jiraConfig ? 'jira' : 'trello';

	const project: Record<string, unknown> = {
		id: row.id,
		orgId: row.orgId,
		name: row.name,
		repo: row.repo,
		baseBranch: row.baseBranch ?? 'main',
		branchPrefix: row.branchPrefix ?? 'feature/',
		pm: { type: pmType },
		prompts: orUndefined(prompts),
		model: row.model ?? undefined,
		agentModels: orUndefined(models),
		cardBudgetUsd: row.cardBudgetUsd ? Number(row.cardBudgetUsd) : undefined,
		squintDbUrl: row.squintDbUrl ?? undefined,
	};

	if (trelloConfig) {
		project.trello = {
			boardId: trelloConfig.boardId,
			lists: trelloConfig.lists,
			labels: trelloConfig.labels,
			customFields: trelloConfig.customFields,
			...(trelloTriggers && Object.keys(trelloTriggers).length > 0
				? { triggers: trelloTriggers }
				: {}),
		};
	}

	if (jiraConfig) {
		project.jira = {
			projectKey: jiraConfig.projectKey,
			baseUrl: jiraConfig.baseUrl,
			statuses: jiraConfig.statuses,
			issueTypes: jiraConfig.issueTypes,
			customFields: jiraConfig.customFields,
			labels: jiraConfig.labels,
			...(jiraTriggers && Object.keys(jiraTriggers).length > 0 ? { triggers: jiraTriggers } : {}),
		};
	}

	if (githubTriggers && Object.keys(githubTriggers).length > 0) {
		project.github = { triggers: githubTriggers };
	}

	if (row.agentBackend || Object.keys(backends).length > 0) {
		project.agentBackend = {
			default: row.agentBackend ?? undefined,
			overrides: backends,
			subscriptionCostZero: row.subscriptionCostZero ?? false,
		};
	}

	return project;
}

function extractIntegrationConfigs(integrations: IntegrationRow[]) {
	const trelloRow = integrations.find((i) => i.provider === 'trello');
	const jiraRow = integrations.find((i) => i.provider === 'jira');
	const githubRow = integrations.find((i) => i.provider === 'github');

	return {
		trelloConfig: trelloRow?.config as TrelloIntegrationConfig | undefined,
		trelloTriggers: (trelloRow?.triggers ?? undefined) as Record<string, boolean> | undefined,
		jiraConfig: jiraRow?.config as JiraIntegrationConfig | undefined,
		jiraTriggers: (jiraRow?.triggers ?? undefined) as Record<string, boolean> | undefined,
		githubConfig: githubRow?.config as GitHubIntegrationConfig | undefined,
		githubTriggers: (githubRow?.triggers ?? undefined) as Record<string, boolean> | undefined,
	};
}

async function loadAgentConfigs(): Promise<AgentConfigRow[]> {
	const db = getDb();
	return db.select().from(agentConfigs);
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

	// Index integrations by project ID
	const integrationsByProject = new Map<string, typeof integrationRows>();
	for (const row of integrationRows) {
		const existing = integrationsByProject.get(row.projectId) ?? [];
		existing.push(row);
		integrationsByProject.set(row.projectId, existing);
	}

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

	const rawConfig = {
		defaults: mapDefaultsRow(defaultsRow, mergedGlobalConfigs),
		projects: projectRows.map((row) => {
			const integrations = (integrationsByProject.get(row.id) ?? []) as IntegrationRow[];
			const {
				trelloConfig,
				trelloTriggers,
				jiraConfig,
				jiraTriggers,
				githubConfig,
				githubTriggers,
			} = extractIntegrationConfigs(integrations);
			return mapProjectRow(
				row,
				projectAgentConfigsMap.get(row.id) ?? [],
				trelloConfig,
				trelloTriggers,
				jiraConfig,
				jiraTriggers,
				githubConfig,
				githubTriggers,
			);
		}),
	};

	return validateConfig(rawConfig);
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

	const integrationRows = integrations as IntegrationRow[];
	const { trelloConfig, trelloTriggers, jiraConfig, jiraTriggers, githubConfig, githubTriggers } =
		extractIntegrationConfigs(integrationRows);

	const rawConfig = {
		defaults: mapDefaultsRow(defaultsRow, [...globalAcs, ...orgAcs]),
		projects: [
			mapProjectRow(
				row,
				projectAcs,
				trelloConfig,
				trelloTriggers,
				jiraConfig,
				jiraTriggers,
				githubConfig,
				githubTriggers,
			),
		],
	};
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
