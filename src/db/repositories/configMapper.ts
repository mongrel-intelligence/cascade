import type { EngineSettings } from '../../config/engineSettings.js';
import { REVIEW_EVENT_POLICIES, type ReviewEventPolicy } from '../../config/reviewEventPolicy.js';
import { UPDATE_CHANNELS, type UpdateChannel } from '../../config/updateChannel.js';
import type { JiraAuthType } from '../../integrations/pm/jira/config-schema.js';

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
	/** Optional JIRA auth mode (non-secret config, mirrors `baseUrl`). See jiraConfigSchema. */
	authType?: JiraAuthType;
	statuses: Record<string, string>;
	issueTypes?: Record<string, string>;
	customFields?: { cost?: string };
	labels?: Record<string, string>;
}

export interface LinearIntegrationConfig {
	teamId: string;
	projectId?: string;
	statuses: Record<string, string>;
	labels?: {
		processing?: string;
		processed?: string;
		error?: string;
		readyToProcess?: string;
		auto?: string;
	};
	customFields?: { cost?: string };
}

// biome-ignore lint/complexity/noBannedTypes: GitHub config has no fields (credentials are in integration_credentials)
export type GitHubIntegrationConfig = {};

// ---------------------------------------------------------------------------
// Row interfaces (mirrors DB select shapes)
// ---------------------------------------------------------------------------

export interface AgentConfigRow {
	projectId: string;
	agentType: string;
	model: string | null;
	maxIterations: number | null;
	agentEngine: string | null;
	agentEngineSettings?: EngineSettings | null;
	/** Per-agent update-channel override. NULL/absent → inherit the default (`both`). */
	updateChannel?: string | null;
	/** Per-agent review-event-policy override. NULL/absent → inherit the default (`all`). */
	reviewEventPolicy?: string | null;
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
	linearConfig?: LinearIntegrationConfig;
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
	pm?: { type: string };
	model?: string;
	agentModels?: Record<string, string>;
	maxIterations?: number;
	watchdogTimeoutMs?: number;
	progressModel?: string;
	progressIntervalMinutes?: number;
	workItemBudgetUsd?: number;
	engineSettings?: EngineSettings;
	/** Per-agent engine settings overrides keyed by agent type. */
	agentEngineSettings?: Record<string, EngineSettings>;
	/** Per-agent update-channel overrides keyed by agent type. */
	agentUpdateChannels?: Record<string, UpdateChannel>;
	/** Per-agent review-event-policy overrides keyed by agent type. */
	agentReviewEventPolicies?: Record<string, ReviewEventPolicy>;
	runLinksEnabled?: boolean;
	maxInFlightItems?: number;
	snapshotEnabled?: boolean;
	snapshotTtlMs?: number;
	/** Per-project wall timeout (ms) for `.cascade/setup.sh`. NULL/0 → no limit. */
	setupTimeoutMs?: number;
	/** Per-project worker image (spec 022). Raw strings; validated by ProjectConfigSchema. */
	workerImage?: string;
	workerImageDigest?: string;
	workerImageStatus?: string;
	workerImageError?: string;
	/** Per-project worker Dockerfile (spec 023). Raw strings; validated by ProjectConfigSchema. */
	workerDockerfile?: string;
	workerImageBuildHash?: string;
	workerImageBuildStatus?: string;
	/**
	 * Derived (never stored) effective image source: `dockerfile` (worker_dockerfile
	 * set) > `reference` (worker_image set) > `default`. Computed by mapProjectRow.
	 */
	workerImageSource?: 'default' | 'reference' | 'dockerfile';
	trello?: {
		boardId: string;
		lists: Record<string, string>;
		labels: Record<string, string>;
		customFields?: { cost?: string };
	};
	jira?: {
		projectKey: string;
		baseUrl: string;
		authType?: JiraAuthType;
		statuses: Record<string, string>;
		issueTypes?: Record<string, string>;
		customFields?: { cost?: string };
		labels?: Record<string, string>;
	};
	linear?: {
		teamId: string;
		projectId?: string;
		statuses: Record<string, string>;
		labels?: {
			processing?: string;
			processed?: string;
			error?: string;
			readyToProcess?: string;
			auto?: string;
		};
		customFields?: { cost?: string };
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
	maxIterations: number | null;
	watchdogTimeoutMs: number | null;
	workItemBudgetUsd: string | null;
	progressModel: string | null;
	progressIntervalMinutes: string | null;
	agentEngine: string | null;
	agentEngineSettings: EngineSettings | null;
	runLinksEnabled: boolean;
	maxInFlightItems: number | null;
	snapshotEnabled: boolean | null;
	snapshotTtlMs: number | null;
	setupTimeoutMs: number | null;
	workerImage: string | null;
	workerImageDigest: string | null;
	workerImageStatus: string | null;
	workerImageError: string | null;
	workerDockerfile: string | null;
	workerImageBuildHash: string | null;
	workerImageBuildStatus: string | null;
};

export function buildAgentMaps(configs: AgentConfigRow[]): {
	models: Record<string, string>;
	iterations: Record<string, number>;
	engines: Record<string, string>;
	engineSettings: Record<string, EngineSettings>;
	updateChannels: Record<string, UpdateChannel>;
	reviewEventPolicies: Record<string, ReviewEventPolicy>;
} {
	const models: Record<string, string> = {};
	const iterations: Record<string, number> = {};
	const engines: Record<string, string> = {};
	const engineSettings: Record<string, EngineSettings> = {};
	const updateChannels: Record<string, UpdateChannel> = {};
	const reviewEventPolicies: Record<string, ReviewEventPolicy> = {};
	for (const ac of configs) {
		if (ac.model) models[ac.agentType] = ac.model;
		if (ac.maxIterations != null) iterations[ac.agentType] = ac.maxIterations;
		if (ac.agentEngine) engines[ac.agentType] = ac.agentEngine;
		if (ac.agentEngineSettings != null) engineSettings[ac.agentType] = ac.agentEngineSettings;
		// Validate the persisted value against the channel catalog; ignore unknown
		// values (and NULL) so a stale/invalid column never breaks config loading.
		if (ac.updateChannel != null && isUpdateChannel(ac.updateChannel)) {
			updateChannels[ac.agentType] = ac.updateChannel;
		}
		// Same contract for the review-event policy: unknown/NULL values are skipped.
		if (ac.reviewEventPolicy != null && isReviewEventPolicy(ac.reviewEventPolicy)) {
			reviewEventPolicies[ac.agentType] = ac.reviewEventPolicy;
		}
	}
	return { models, iterations, engines, engineSettings, updateChannels, reviewEventPolicies };
}

/** Type guard narrowing a persisted string to a known {@link UpdateChannel}. */
function isUpdateChannel(value: string): value is UpdateChannel {
	return (UPDATE_CHANNELS as readonly string[]).includes(value);
}

/** Type guard narrowing a persisted string to a known {@link ReviewEventPolicy}. */
function isReviewEventPolicy(value: string): value is ReviewEventPolicy {
	return (REVIEW_EVENT_POLICIES as readonly string[]).includes(value);
}

export function orUndefined<T extends Record<string, unknown>>(obj: T): T | undefined {
	return Object.keys(obj).length > 0 ? obj : undefined;
}

function numericOrUndefined(value: string | null): number | undefined {
	return value != null ? Number(value) : undefined;
}

/** Normalizes a nullable DB column to `undefined` for the raw config object. */
function nullToUndefined<T>(value: T | null): T | undefined {
	return value ?? undefined;
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
		// Thread the optional auth mode through the DB-load path so
		// ProjectConfig.jira.authType survives validateConfig (MNG-1736). Without
		// this hand-pick, the field is dropped before jiraConfigSchema re-parses,
		// so a persisted authType would always load back as `undefined`.
		authType: config.authType,
		statuses: config.statuses,
		issueTypes: config.issueTypes,
		customFields: config.customFields,
		labels: config.labels,
	};
}

function buildLinearConfig(config: LinearIntegrationConfig): ProjectConfigRaw['linear'] {
	return {
		teamId: config.teamId,
		projectId: config.projectId,
		statuses: config.statuses,
		labels: config.labels,
		customFields: config.customFields,
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

function buildBaseProjectFields(
	row: ProjectRow,
	pmType: 'trello' | 'jira' | 'linear' | undefined,
): ProjectConfigRaw {
	return {
		id: row.id,
		orgId: row.orgId,
		name: row.name,
		repo: row.repo ?? undefined,
		baseBranch: row.baseBranch ?? 'main',
		branchPrefix: row.branchPrefix ?? 'feature/',
		pm: pmType ? { type: pmType } : undefined,
		model: row.model ?? undefined,
		maxIterations: row.maxIterations ?? undefined,
		watchdogTimeoutMs: row.watchdogTimeoutMs ?? undefined,
		progressModel: row.progressModel ?? undefined,
		progressIntervalMinutes: numericOrUndefined(row.progressIntervalMinutes),
		workItemBudgetUsd: numericOrUndefined(row.workItemBudgetUsd),
		engineSettings: row.agentEngineSettings ?? undefined,
		runLinksEnabled: row.runLinksEnabled ?? false,
		maxInFlightItems: row.maxInFlightItems ?? undefined,
		snapshotEnabled: row.snapshotEnabled ?? undefined,
		snapshotTtlMs: row.snapshotTtlMs ?? undefined,
		setupTimeoutMs: row.setupTimeoutMs ?? undefined,
		workerImage: nullToUndefined(row.workerImage),
		workerImageDigest: nullToUndefined(row.workerImageDigest),
		workerImageStatus: nullToUndefined(row.workerImageStatus),
		workerImageError: nullToUndefined(row.workerImageError),
		workerDockerfile: nullToUndefined(row.workerDockerfile),
		workerImageBuildHash: nullToUndefined(row.workerImageBuildHash),
		workerImageBuildStatus: nullToUndefined(row.workerImageBuildStatus),
		// Derived, never stored: dockerfile > reference > default.
		workerImageSource: deriveWorkerImageSource(row),
	};
}

/**
 * Derives the effective worker-image source (spec 023). Precedence is
 * `dockerfile` (worker_dockerfile set) > `reference` (worker_image set) >
 * `default` (neither set). Purely a function of the two source columns; the
 * pin/status columns do not participate.
 */
function deriveWorkerImageSource(
	row: Pick<ProjectRow, 'workerDockerfile' | 'workerImage'>,
): 'default' | 'reference' | 'dockerfile' {
	if (row.workerDockerfile != null) return 'dockerfile';
	if (row.workerImage != null) return 'reference';
	return 'default';
}

// ---------------------------------------------------------------------------
// Public mapping functions
// ---------------------------------------------------------------------------

export function extractIntegrationConfigs(integrations: IntegrationRow[]): {
	trelloConfig?: TrelloIntegrationConfig;
	jiraConfig?: JiraIntegrationConfig;
	linearConfig?: LinearIntegrationConfig;
	githubConfig?: GitHubIntegrationConfig;
} {
	const trelloRow = integrations.find((i) => i.provider === 'trello');
	const jiraRow = integrations.find((i) => i.provider === 'jira');
	const linearRow = integrations.find((i) => i.provider === 'linear');
	const githubRow = integrations.find((i) => i.provider === 'github');

	return {
		trelloConfig: trelloRow?.config as TrelloIntegrationConfig | undefined,
		jiraConfig: jiraRow?.config as JiraIntegrationConfig | undefined,
		linearConfig: linearRow?.config as LinearIntegrationConfig | undefined,
		githubConfig: githubRow?.config as GitHubIntegrationConfig | undefined,
	};
}

export function mapProjectRow({
	row,
	projectAgentConfigs,
	trelloConfig,
	jiraConfig,
	linearConfig,
}: MapProjectInput): ProjectConfigRaw {
	const {
		models,
		engines,
		engineSettings: agentEngineSettingsMap,
		updateChannels,
		reviewEventPolicies,
	} = buildAgentMaps(projectAgentConfigs);

	// Derive PM type from integration config. No PM integration → `undefined`
	// (an SCM-only project); do NOT default to Trello. Check trelloConfig
	// explicitly (it is no longer the catch-all).
	const pmType = trelloConfig
		? 'trello'
		: jiraConfig
			? 'jira'
			: linearConfig
				? 'linear'
				: undefined;

	const project: ProjectConfigRaw = {
		...buildBaseProjectFields(row, pmType),
		agentModels: orUndefined(models),
		agentEngineSettings: orUndefined(agentEngineSettingsMap) as
			| Record<string, EngineSettings>
			| undefined,
		agentUpdateChannels: orUndefined(updateChannels),
		agentReviewEventPolicies: orUndefined(reviewEventPolicies),
	};

	if (trelloConfig) {
		project.trello = buildTrelloConfig(trelloConfig);
	}

	if (jiraConfig) {
		project.jira = buildJiraConfig(jiraConfig);
	}

	if (linearConfig) {
		project.linear = buildLinearConfig(linearConfig);
	}

	const agentEngine = buildAgentEngineConfig(row, engines);
	if (agentEngine) {
		project.agentEngine = agentEngine;
	}

	return project;
}
