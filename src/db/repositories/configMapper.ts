import type { EngineSettings } from '../../config/engineSettings.js';

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
	workItemBudgetUsd: string | null;
	agentEngine: string | null;
	agentEngineSettings: EngineSettings | null;
	progressModel: string | null;
	progressIntervalMinutes: string | null;
}

export interface AgentConfigRow {
	orgId: string | null;
	projectId: string | null;
	agentType: string;
	model: string | null;
	maxIterations: number | null;
	agentEngine: string | null;
}

export interface IntegrationRow {
	projectId: string;
	category: string;
	provider: string;
	config: unknown;
}

// ---------------------------------------------------------------------------
// Structured input for mapProjectRow (replaces 8 positional params)
// ---------------------------------------------------------------------------

export interface MapProjectInput {
	row: ProjectRow;
	projectAgentConfigs: AgentConfigRow[];
	trelloConfig?: TrelloIntegrationConfig;
	jiraConfig?: JiraIntegrationConfig;
	githubConfig?: GitHubIntegrationConfig;
}

// ---------------------------------------------------------------------------
// Typed return interface for mapProjectRow
// ---------------------------------------------------------------------------

export interface ProjectConfigRaw {
	id: string;
	orgId: string;
	name: string;
	repo?: string;
	baseBranch: string;
	branchPrefix: string;
	pm: { type: string };
	model?: string;
	agentModels?: Record<string, string>;
	workItemBudgetUsd?: number;
	squintDbUrl?: string;
	engineSettings?: EngineSettings;
	trello?: {
		boardId: string;
		lists: Record<string, string>;
		labels: Record<string, string>;
		customFields?: { cost?: string };
	};
	jira?: {
		projectKey: string;
		baseUrl: string;
		statuses: Record<string, string>;
		issueTypes?: Record<string, string>;
		customFields?: { cost?: string };
		labels?: Record<string, string>;
	};
	agentEngine?: {
		default?: string;
		overrides: Record<string, string>;
	};
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type ProjectRow = {
	id: string;
	orgId: string;
	name: string;
	repo: string | null;
	baseBranch: string | null;
	branchPrefix: string | null;
	model: string | null;
	workItemBudgetUsd: string | null;
	squintDbUrl: string | null;
	agentEngine: string | null;
	agentEngineSettings: EngineSettings | null;
};

export function buildAgentMaps(configs: AgentConfigRow[]): {
	models: Record<string, string>;
	iterations: Record<string, number>;
	engines: Record<string, string>;
} {
	const models: Record<string, string> = {};
	const iterations: Record<string, number> = {};
	const engines: Record<string, string> = {};
	for (const ac of configs) {
		if (ac.model) models[ac.agentType] = ac.model;
		if (ac.maxIterations != null) iterations[ac.agentType] = ac.maxIterations;
		if (ac.agentEngine) engines[ac.agentType] = ac.agentEngine;
	}
	return { models, iterations, engines };
}

export function orUndefined<T extends Record<string, unknown>>(obj: T): T | undefined {
	return Object.keys(obj).length > 0 ? obj : undefined;
}

function buildTrelloConfig(config: TrelloIntegrationConfig): ProjectConfigRaw['trello'] {
	return {
		boardId: config.boardId,
		lists: config.lists,
		labels: config.labels,
		customFields: config.customFields,
	};
}

function buildJiraConfig(config: JiraIntegrationConfig): ProjectConfigRaw['jira'] {
	return {
		projectKey: config.projectKey,
		baseUrl: config.baseUrl,
		statuses: config.statuses,
		issueTypes: config.issueTypes,
		customFields: config.customFields,
		labels: config.labels,
	};
}

function buildAgentEngineConfig(
	row: ProjectRow,
	engines: Record<string, string>,
): ProjectConfigRaw['agentEngine'] | undefined {
	if (!row.agentEngine && Object.keys(engines).length === 0) return undefined;
	return {
		default: row.agentEngine ?? undefined,
		overrides: engines,
	};
}

// ---------------------------------------------------------------------------
// Public mapping functions
// ---------------------------------------------------------------------------

export function mapDefaultsRow(
	row: DefaultsRow | undefined,
	globalAgentConfigs: AgentConfigRow[],
): Record<string, unknown> {
	const { models, iterations } = buildAgentMaps(globalAgentConfigs);

	return {
		model: row?.model ?? undefined,
		agentModels: orUndefined(models),
		maxIterations: row?.maxIterations ?? undefined,
		agentIterations: orUndefined(iterations),
		watchdogTimeoutMs: row?.watchdogTimeoutMs ?? undefined,
		workItemBudgetUsd: row?.workItemBudgetUsd ? Number(row.workItemBudgetUsd) : undefined,
		agentEngine: row?.agentEngine ?? undefined,
		engineSettings: row?.agentEngineSettings ?? undefined,
		progressModel: row?.progressModel ?? undefined,
		progressIntervalMinutes: row?.progressIntervalMinutes
			? Number(row.progressIntervalMinutes)
			: undefined,
	};
}

export function extractIntegrationConfigs(integrations: IntegrationRow[]): {
	trelloConfig?: TrelloIntegrationConfig;
	jiraConfig?: JiraIntegrationConfig;
	githubConfig?: GitHubIntegrationConfig;
} {
	const trelloRow = integrations.find((i) => i.provider === 'trello');
	const jiraRow = integrations.find((i) => i.provider === 'jira');
	const githubRow = integrations.find((i) => i.provider === 'github');

	return {
		trelloConfig: trelloRow?.config as TrelloIntegrationConfig | undefined,
		jiraConfig: jiraRow?.config as JiraIntegrationConfig | undefined,
		githubConfig: githubRow?.config as GitHubIntegrationConfig | undefined,
	};
}

export function mapProjectRow({
	row,
	projectAgentConfigs,
	trelloConfig,
	jiraConfig,
}: MapProjectInput): ProjectConfigRaw {
	const { models, engines } = buildAgentMaps(projectAgentConfigs);

	// Derive PM type from integration config
	const pmType = jiraConfig ? 'jira' : 'trello';

	const project: ProjectConfigRaw = {
		id: row.id,
		orgId: row.orgId,
		name: row.name,
		repo: row.repo ?? undefined,
		baseBranch: row.baseBranch ?? 'main',
		branchPrefix: row.branchPrefix ?? 'feature/',
		pm: { type: pmType },
		model: row.model ?? undefined,
		agentModels: orUndefined(models),
		workItemBudgetUsd: row.workItemBudgetUsd ? Number(row.workItemBudgetUsd) : undefined,
		engineSettings: row.agentEngineSettings ?? undefined,
		squintDbUrl: row.squintDbUrl ?? undefined,
	};

	if (trelloConfig) {
		project.trello = buildTrelloConfig(trelloConfig);
	}

	if (jiraConfig) {
		project.jira = buildJiraConfig(jiraConfig);
	}

	const agentEngine = buildAgentEngineConfig(row, engines);
	if (agentEngine) {
		project.agentEngine = agentEngine;
	}

	return project;
}
