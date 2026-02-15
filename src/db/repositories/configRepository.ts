import { eq, isNull } from 'drizzle-orm';
import { validateConfig } from '../../config/schema.js';
import type { CascadeConfig, ProjectConfig } from '../../types/index.js';
import { getDb } from '../client.js';
import { agentConfigs, cascadeDefaults, projects } from '../schema/index.js';

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
	projectId: string | null;
	agentType: string;
	model: string | null;
	maxIterations: number | null;
	backend: string | null;
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
		if (ac.backend) backends[ac.agentType] = ac.backend;
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
): Record<string, unknown> {
	const { models, prompts, backends } = buildAgentMaps(projectAgentConfigs);

	const project: Record<string, unknown> = {
		id: row.id,
		name: row.name,
		repo: row.repo,
		baseBranch: row.baseBranch ?? 'main',
		branchPrefix: row.branchPrefix ?? 'feature/',
		trello: {
			boardId: row.trelloBoardId,
			lists: {
				briefing: row.trelloListBriefing,
				stories: row.trelloListStories,
				planning: row.trelloListPlanning,
				todo: row.trelloListTodo,
				inProgress: row.trelloListInProgress,
				inReview: row.trelloListInReview,
				done: row.trelloListDone,
				merged: row.trelloListMerged,
				debug: row.trelloListDebug,
			},
			labels: {
				readyToProcess: row.trelloLabelReadyToProcess,
				processing: row.trelloLabelProcessing,
				processed: row.trelloLabelProcessed,
				error: row.trelloLabelError,
			},
			customFields: row.trelloCustomFieldCost ? { cost: row.trelloCustomFieldCost } : undefined,
		},
		prompts: orUndefined(prompts),
		model: row.model ?? undefined,
		agentModels: orUndefined(models),
		cardBudgetUsd: row.cardBudgetUsd ? Number(row.cardBudgetUsd) : undefined,
	};

	if (row.agentBackendDefault) {
		project.agentBackend = {
			default: row.agentBackendDefault,
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

	const [defaultsRow] = await db.select().from(cascadeDefaults).limit(1);
	const projectRows = await db.select().from(projects);
	const allAgentConfigs = await loadAgentConfigs();

	// Split agent configs into global (project_id IS NULL) and per-project
	const globalAgentConfigs = allAgentConfigs.filter((ac) => ac.projectId === null);
	const projectAgentConfigsMap = new Map<string, AgentConfigRow[]>();
	for (const ac of allAgentConfigs) {
		if (ac.projectId !== null) {
			const existing = projectAgentConfigsMap.get(ac.projectId) ?? [];
			existing.push(ac);
			projectAgentConfigsMap.set(ac.projectId, existing);
		}
	}

	const rawConfig = {
		defaults: mapDefaultsRow(defaultsRow, globalAgentConfigs),
		projects: projectRows.map((row) =>
			mapProjectRow(row, projectAgentConfigsMap.get(row.id) ?? []),
		),
	};

	return validateConfig(rawConfig);
}

export async function findProjectByBoardIdFromDb(
	boardId: string,
): Promise<ProjectConfig | undefined> {
	const db = getDb();
	const [row] = await db.select().from(projects).where(eq(projects.trelloBoardId, boardId));
	if (!row) return undefined;

	const projectAcs = await db.select().from(agentConfigs).where(eq(agentConfigs.projectId, row.id));
	const globalAcs = await db.select().from(agentConfigs).where(isNull(agentConfigs.projectId));

	const [defaultsRow] = await db.select().from(cascadeDefaults).limit(1);
	const rawConfig = {
		defaults: mapDefaultsRow(defaultsRow, globalAcs),
		projects: [mapProjectRow(row, projectAcs)],
	};
	const validated = validateConfig(rawConfig);
	return validated.projects[0];
}

export async function findProjectByRepoFromDb(repo: string): Promise<ProjectConfig | undefined> {
	const db = getDb();
	const [row] = await db.select().from(projects).where(eq(projects.repo, repo));
	if (!row) return undefined;

	const projectAcs = await db.select().from(agentConfigs).where(eq(agentConfigs.projectId, row.id));
	const globalAcs = await db.select().from(agentConfigs).where(isNull(agentConfigs.projectId));

	const [defaultsRow] = await db.select().from(cascadeDefaults).limit(1);
	const rawConfig = {
		defaults: mapDefaultsRow(defaultsRow, globalAcs),
		projects: [mapProjectRow(row, projectAcs)],
	};
	const validated = validateConfig(rawConfig);
	return validated.projects[0];
}

export async function findProjectByIdFromDb(id: string): Promise<ProjectConfig | undefined> {
	const db = getDb();
	const [row] = await db.select().from(projects).where(eq(projects.id, id));
	if (!row) return undefined;

	const projectAcs = await db.select().from(agentConfigs).where(eq(agentConfigs.projectId, row.id));
	const globalAcs = await db.select().from(agentConfigs).where(isNull(agentConfigs.projectId));

	const [defaultsRow] = await db.select().from(cascadeDefaults).limit(1);
	const rawConfig = {
		defaults: mapDefaultsRow(defaultsRow, globalAcs),
		projects: [mapProjectRow(row, projectAcs)],
	};
	const validated = validateConfig(rawConfig);
	return validated.projects[0];
}
