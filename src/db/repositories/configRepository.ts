import { and, eq, isNull } from 'drizzle-orm';
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
	orgId: string | null;
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

/** Filter null/undefined values from a key-value mapping, returning only string entries. */
function compactRecord(entries: Record<string, string | null>): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(entries)) {
		if (value != null) result[key] = value;
	}
	return result;
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

	const lists = compactRecord({
		briefing: row.trelloListBriefing,
		stories: row.trelloListStories,
		planning: row.trelloListPlanning,
		todo: row.trelloListTodo,
		inProgress: row.trelloListInProgress,
		inReview: row.trelloListInReview,
		done: row.trelloListDone,
		merged: row.trelloListMerged,
		debug: row.trelloListDebug,
	});

	const labels = compactRecord({
		readyToProcess: row.trelloLabelReadyToProcess,
		processing: row.trelloLabelProcessing,
		processed: row.trelloLabelProcessed,
		error: row.trelloLabelError,
	});

	const project: Record<string, unknown> = {
		id: row.id,
		orgId: row.orgId,
		name: row.name,
		repo: row.repo,
		baseBranch: row.baseBranch ?? 'main',
		branchPrefix: row.branchPrefix ?? 'feature/',
		trello: {
			boardId: row.trelloBoardId,
			lists,
			labels,
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

	// Load first defaults row (for the primary/default org)
	const [defaultsRow] = await db.select().from(cascadeDefaults).limit(1);
	const projectRows = await db.select().from(projects);
	const allAgentConfigs = await loadAgentConfigs();

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
	const orgAcs = await db
		.select()
		.from(agentConfigs)
		.where(and(eq(agentConfigs.orgId, row.orgId), isNull(agentConfigs.projectId)));
	const globalAcs = await db
		.select()
		.from(agentConfigs)
		.where(and(isNull(agentConfigs.projectId), isNull(agentConfigs.orgId)));

	const [defaultsRow] = await db
		.select()
		.from(cascadeDefaults)
		.where(eq(cascadeDefaults.orgId, row.orgId));
	const rawConfig = {
		defaults: mapDefaultsRow(defaultsRow, [...globalAcs, ...orgAcs]),
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
	const orgAcs = await db
		.select()
		.from(agentConfigs)
		.where(and(eq(agentConfigs.orgId, row.orgId), isNull(agentConfigs.projectId)));
	const globalAcs = await db
		.select()
		.from(agentConfigs)
		.where(and(isNull(agentConfigs.projectId), isNull(agentConfigs.orgId)));

	const [defaultsRow] = await db
		.select()
		.from(cascadeDefaults)
		.where(eq(cascadeDefaults.orgId, row.orgId));
	const rawConfig = {
		defaults: mapDefaultsRow(defaultsRow, [...globalAcs, ...orgAcs]),
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
	const orgAcs = await db
		.select()
		.from(agentConfigs)
		.where(and(eq(agentConfigs.orgId, row.orgId), isNull(agentConfigs.projectId)));
	const globalAcs = await db
		.select()
		.from(agentConfigs)
		.where(and(isNull(agentConfigs.projectId), isNull(agentConfigs.orgId)));

	const [defaultsRow] = await db
		.select()
		.from(cascadeDefaults)
		.where(eq(cascadeDefaults.orgId, row.orgId));
	const rawConfig = {
		defaults: mapDefaultsRow(defaultsRow, [...globalAcs, ...orgAcs]),
		projects: [mapProjectRow(row, projectAcs)],
	};
	const validated = validateConfig(rawConfig);
	return validated.projects[0];
}
