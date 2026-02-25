/**
 * Config mapper — pure transformation functions for converting DB rows into
 * raw config objects consumed by `validateConfig`.
 *
 * Extracted from configRepository.ts to separate query concerns from mapping
 * concerns and to enable isolated unit testing of the transformation logic.
 */

// ---------------------------------------------------------------------------
// Integration config interfaces
// ---------------------------------------------------------------------------

export interface TrelloIntegrationConfig {
	boardId: string;
	lists: Record<string, string>;
	labels: Record<string, string>;
	customFields?: { cost?: string };
}

export interface JiraIntegrationConfig {
	projectKey: string;
	baseUrl: string;
	statuses: Record<string, string>;
	issueTypes?: Record<string, string>;
	customFields?: { cost?: string };
	labels?: Record<string, string>;
}

// biome-ignore lint/complexity/noBannedTypes: GitHub config has no fields (credentials are in integration_credentials)
export type GitHubIntegrationConfig = {};

// ---------------------------------------------------------------------------
// Row interfaces (mirrors DB select shapes)
// ---------------------------------------------------------------------------

export interface DefaultsRow {
	model: string | null;
	maxIterations: number | null;
	watchdogTimeoutMs: number | null;
	cardBudgetUsd: string | null;
	agentBackend: string | null;
	progressModel: string | null;
	progressIntervalMinutes: string | null;
}

export interface AgentConfigRow {
	orgId: string | null;
	projectId: string | null;
	agentType: string;
	model: string | null;
	maxIterations: number | null;
	agentBackend: string | null;
	prompt: string | null;
	taskPrompt: string | null;
}

export interface IntegrationRow {
	projectId: string;
	category: string;
	provider: string;
	config: unknown;
	triggers: unknown;
}

// ---------------------------------------------------------------------------
// Structured input for mapProjectRow (replaces 8 positional params)
// ---------------------------------------------------------------------------

export interface MapProjectInput {
	row: ProjectRow;
	projectAgentConfigs: AgentConfigRow[];
	trelloConfig?: TrelloIntegrationConfig;
	trelloTriggers?: Record<string, boolean>;
	jiraConfig?: JiraIntegrationConfig;
	jiraTriggers?: Record<string, boolean>;
	githubConfig?: GitHubIntegrationConfig;
	githubTriggers?: Record<string, boolean>;
}

// ---------------------------------------------------------------------------
// Typed return interface for mapProjectRow
// ---------------------------------------------------------------------------

export interface ProjectConfigRaw {
	id: string;
	orgId: string;
	name: string;
	repo: string;
	baseBranch: string;
	branchPrefix: string;
	pm: { type: string };
	prompts?: Record<string, string>;
	taskPrompts?: Record<string, string>;
	model?: string;
	agentModels?: Record<string, string>;
	cardBudgetUsd?: number;
	squintDbUrl?: string;
	trello?: {
		boardId: string;
		lists: Record<string, string>;
		labels: Record<string, string>;
		customFields?: { cost?: string };
		triggers?: Record<string, boolean>;
	};
	jira?: {
		projectKey: string;
		baseUrl: string;
		statuses: Record<string, string>;
		issueTypes?: Record<string, string>;
		customFields?: { cost?: string };
		labels?: Record<string, string>;
		triggers?: Record<string, boolean>;
	};
	github?: { triggers: Record<string, boolean> };
	agentBackend?: {
		default?: string;
		overrides: Record<string, string>;
		subscriptionCostZero: boolean;
	};
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type ProjectRow = {
	id: string;
	orgId: string;
	name: string;
	repo: string;
	baseBranch: string | null;
	branchPrefix: string | null;
	model: string | null;
	cardBudgetUsd: string | null;
	squintDbUrl: string | null;
	agentBackend: string | null;
	subscriptionCostZero: boolean | null;
};

export function buildAgentMaps(configs: AgentConfigRow[]): {
	models: Record<string, string>;
	iterations: Record<string, number>;
	prompts: Record<string, string>;
	taskPrompts: Record<string, string>;
	backends: Record<string, string>;
} {
	const models: Record<string, string> = {};
	const iterations: Record<string, number> = {};
	const prompts: Record<string, string> = {};
	const taskPrompts: Record<string, string> = {};
	const backends: Record<string, string> = {};
	for (const ac of configs) {
		if (ac.model) models[ac.agentType] = ac.model;
		if (ac.maxIterations != null) iterations[ac.agentType] = ac.maxIterations;
		if (ac.prompt) prompts[ac.agentType] = ac.prompt;
		if (ac.taskPrompt) taskPrompts[ac.agentType] = ac.taskPrompt;
		if (ac.agentBackend) backends[ac.agentType] = ac.agentBackend;
	}
	return { models, iterations, prompts, taskPrompts, backends };
}

export function orUndefined<T extends Record<string, unknown>>(obj: T): T | undefined {
	return Object.keys(obj).length > 0 ? obj : undefined;
}

function buildTrelloConfig(
	config: TrelloIntegrationConfig,
	triggers?: Record<string, boolean>,
): ProjectConfigRaw['trello'] {
	return {
		boardId: config.boardId,
		lists: config.lists,
		labels: config.labels,
		customFields: config.customFields,
		...(triggers && Object.keys(triggers).length > 0 ? { triggers } : {}),
	};
}

function buildJiraConfig(
	config: JiraIntegrationConfig,
	triggers?: Record<string, boolean>,
): ProjectConfigRaw['jira'] {
	return {
		projectKey: config.projectKey,
		baseUrl: config.baseUrl,
		statuses: config.statuses,
		issueTypes: config.issueTypes,
		customFields: config.customFields,
		labels: config.labels,
		...(triggers && Object.keys(triggers).length > 0 ? { triggers } : {}),
	};
}

function buildAgentBackendConfig(
	row: ProjectRow,
	backends: Record<string, string>,
): ProjectConfigRaw['agentBackend'] | undefined {
	if (!row.agentBackend && Object.keys(backends).length === 0) return undefined;
	return {
		default: row.agentBackend ?? undefined,
		overrides: backends,
		subscriptionCostZero: row.subscriptionCostZero ?? false,
	};
}

// ---------------------------------------------------------------------------
// Public mapping functions
// ---------------------------------------------------------------------------

export function mapDefaultsRow(
	row: DefaultsRow | undefined,
	globalAgentConfigs: AgentConfigRow[],
): Record<string, unknown> {
	const { models, iterations, prompts, taskPrompts } = buildAgentMaps(globalAgentConfigs);

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
		taskPrompts: orUndefined(taskPrompts),
	};
}

export function extractIntegrationConfigs(integrations: IntegrationRow[]): {
	trelloConfig?: TrelloIntegrationConfig;
	trelloTriggers?: Record<string, boolean>;
	jiraConfig?: JiraIntegrationConfig;
	jiraTriggers?: Record<string, boolean>;
	githubConfig?: GitHubIntegrationConfig;
	githubTriggers?: Record<string, boolean>;
} {
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

export function mapProjectRow({
	row,
	projectAgentConfigs,
	trelloConfig,
	trelloTriggers,
	jiraConfig,
	jiraTriggers,
	githubTriggers,
}: MapProjectInput): ProjectConfigRaw {
	const { models, prompts, taskPrompts, backends } = buildAgentMaps(projectAgentConfigs);

	// Derive PM type from integration config
	const pmType = jiraConfig ? 'jira' : 'trello';

	const project: ProjectConfigRaw = {
		id: row.id,
		orgId: row.orgId,
		name: row.name,
		repo: row.repo,
		baseBranch: row.baseBranch ?? 'main',
		branchPrefix: row.branchPrefix ?? 'feature/',
		pm: { type: pmType },
		prompts: orUndefined(prompts),
		taskPrompts: orUndefined(taskPrompts),
		model: row.model ?? undefined,
		agentModels: orUndefined(models),
		cardBudgetUsd: row.cardBudgetUsd ? Number(row.cardBudgetUsd) : undefined,
		squintDbUrl: row.squintDbUrl ?? undefined,
	};

	if (trelloConfig) {
		project.trello = buildTrelloConfig(trelloConfig, trelloTriggers);
	}

	if (jiraConfig) {
		project.jira = buildJiraConfig(jiraConfig, jiraTriggers);
	}

	if (githubTriggers && Object.keys(githubTriggers).length > 0) {
		project.github = { triggers: githubTriggers };
	}

	const agentBackend = buildAgentBackendConfig(row, backends);
	if (agentBackend) {
		project.agentBackend = agentBackend;
	}

	return project;
}
