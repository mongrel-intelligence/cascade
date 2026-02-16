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

interface DefaultsRow {
	model: string | null;
	maxIterations: number | null;
	freshMachineTimeoutMs: number | null;
	watchdogTimeoutMs: number | null;
	postJobGracePeriodMs: number | null;
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
	const { models, iterations } = buildAgentMaps(globalAgentConfigs);

	return {
		model: row?.model ?? undefined,
		agentModels: orUndefined(models),
		maxIterations: row?.maxIterations ?? undefined,
		agentIterations: orUndefined(iterations),
		freshMachineTimeoutMs: row?.freshMachineTimeoutMs ?? undefined,
		watchdogTimeoutMs: row?.watchdogTimeoutMs ?? undefined,
		postJobGracePeriodMs: row?.postJobGracePeriodMs ?? undefined,
		cardBudgetUsd: row?.cardBudgetUsd ? Number(row.cardBudgetUsd) : undefined,
		agentBackend: row?.agentBackend ?? undefined,
		progressModel: row?.progressModel ?? undefined,
		progressIntervalMinutes: row?.progressIntervalMinutes
			? Number(row.progressIntervalMinutes)
			: undefined,
	};
}

type ProjectRow = typeof projects.$inferSelect;

function mapProjectRow(
	row: ProjectRow,
	projectAgentConfigs: AgentConfigRow[],
	trelloConfig?: TrelloIntegrationConfig,
): Record<string, unknown> {
	const { models, prompts, backends } = buildAgentMaps(projectAgentConfigs);

	const project: Record<string, unknown> = {
		id: row.id,
		orgId: row.orgId,
		name: row.name,
		repo: row.repo,
		baseBranch: row.baseBranch ?? 'main',
		branchPrefix: row.branchPrefix ?? 'feature/',
		trello: trelloConfig
			? {
					boardId: trelloConfig.boardId,
					lists: trelloConfig.lists,
					labels: trelloConfig.labels,
					customFields: trelloConfig.customFields,
				}
			: { boardId: '', lists: {}, labels: {} },
		prompts: orUndefined(prompts),
		model: row.model ?? undefined,
		agentModels: orUndefined(models),
		cardBudgetUsd: row.cardBudgetUsd ? Number(row.cardBudgetUsd) : undefined,
	};

	if (row.agentBackend) {
		project.agentBackend = {
			default: row.agentBackend,
			overrides: backends,
			subscriptionCostZero: row.subscriptionCostZero ?? false,
		};
	}

	return project;
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
		...(orgAgentConfigsMap.get(defaultsRow?.orgId ?? 'default') ?? []),
	];

	const rawConfig = {
		defaults: mapDefaultsRow(defaultsRow, mergedGlobalConfigs),
		projects: projectRows.map((row) => {
			const integrations = integrationsByProject.get(row.id) ?? [];
			const trelloConfig = integrations.find((i) => i.type === 'trello')?.config as
				| TrelloIntegrationConfig
				| undefined;
			return mapProjectRow(row, projectAgentConfigsMap.get(row.id) ?? [], trelloConfig);
		}),
	};

	return validateConfig(rawConfig);
}

async function findProjectFromDb(whereClause: SQL): Promise<ProjectConfig | undefined> {
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

	const trelloConfig = integrations.find((i) => i.type === 'trello')?.config as
		| TrelloIntegrationConfig
		| undefined;

	const rawConfig = {
		defaults: mapDefaultsRow(defaultsRow, [...globalAcs, ...orgAcs]),
		projects: [mapProjectRow(row, projectAcs, trelloConfig)],
	};
	const validated = validateConfig(rawConfig);
	return validated.projects[0];
}

export function findProjectByBoardIdFromDb(boardId: string): Promise<ProjectConfig | undefined> {
	return findProjectFromDb(
		sql`${projects.id} IN (
			SELECT ${projectIntegrations.projectId} FROM ${projectIntegrations}
			WHERE ${projectIntegrations.type} = 'trello'
			AND ${projectIntegrations.config}->>'boardId' = ${boardId}
		)`,
	);
}

export function findProjectByRepoFromDb(repo: string): Promise<ProjectConfig | undefined> {
	return findProjectFromDb(eq(projects.repo, repo));
}

export function findProjectByIdFromDb(id: string): Promise<ProjectConfig | undefined> {
	return findProjectFromDb(eq(projects.id, id));
}
