import type { AgentDefinition } from '../../../src/agents/definitions/schema.js';
import { getDb } from '../../../src/db/client.js';
import { upsertAgentDefinition } from '../../../src/db/repositories/agentDefinitionsRepository.js';
import { writeProjectCredential } from '../../../src/db/repositories/credentialsRepository.js';
import {
	agentConfigs,
	agentRuns,
	agentTriggerConfigs,
	organizations,
	projectIntegrations,
	projects,
	promptPartials,
	sessions,
	users,
	webhookLogs,
} from '../../../src/db/schema/index.js';

/**
 * Seeds a test organization.
 */
export async function seedOrg(id = 'test-org', name = 'Test Org') {
	const db = getDb();
	const [row] = await db.insert(organizations).values({ id, name }).returning();
	return row;
}

/**
 * Seeds a test project linked to an org.
 */
export async function seedProject(
	overrides: {
		id?: string;
		orgId?: string;
		name?: string;
		repo?: string;
		baseBranch?: string;
		branchPrefix?: string;
		maxIterations?: number | null;
		watchdogTimeoutMs?: number | null;
		progressModel?: string | null;
		progressIntervalMinutes?: string | null;
	} = {},
) {
	const db = getDb();
	const [row] = await db
		.insert(projects)
		.values({
			id: overrides.id ?? 'test-project',
			orgId: overrides.orgId ?? 'test-org',
			name: overrides.name ?? 'Test Project',
			repo: overrides.repo ?? 'owner/repo',
			baseBranch: overrides.baseBranch ?? 'main',
			branchPrefix: overrides.branchPrefix ?? 'feature/',
			maxIterations: overrides.maxIterations,
			watchdogTimeoutMs: overrides.watchdogTimeoutMs,
			progressModel: overrides.progressModel,
			progressIntervalMinutes: overrides.progressIntervalMinutes,
		})
		.returning();
	return row;
}

/**
 * Seeds a project-scoped credential via the repository.
 */
export async function seedCredential(
	overrides: { projectId?: string; name?: string; envVarKey?: string; value?: string } = {},
) {
	const projectId = overrides.projectId ?? 'test-project';
	const envVarKey = overrides.envVarKey ?? 'TEST_KEY';
	const value = overrides.value ?? 'test-value';
	const name = overrides.name ?? 'Test Key';
	await writeProjectCredential(projectId, envVarKey, value, name);
	return { projectId, envVarKey, value, name };
}

/**
 * Seeds a project integration (PM or SCM).
 */
export async function seedIntegration(
	overrides: {
		projectId?: string;
		category?: string;
		provider?: string;
		config?: Record<string, unknown>;
		triggers?: Record<string, unknown>;
	} = {},
) {
	const db = getDb();
	const [row] = await db
		.insert(projectIntegrations)
		.values({
			projectId: overrides.projectId ?? 'test-project',
			category: overrides.category ?? 'pm',
			provider: overrides.provider ?? 'trello',
			config: overrides.config ?? {},
			triggers: overrides.triggers ?? {},
		})
		.returning();
	return row;
}

/**
 * Seeds an integration credential by writing directly to project_credentials.
 * Maps the role to its envVarKey for the integration's provider.
 */
export async function seedIntegrationCredential(overrides: {
	integrationId: number;
	role?: string;
	credentialId: number;
}) {
	// For backward compatibility.
	// The credentialId is no longer meaningful after legacy table removal.
	// This function is preserved to avoid breaking existing test seeds that call it.
	// Integration credentials are now stored in project_credentials by envVarKey.
	return {
		integrationId: overrides.integrationId,
		role: overrides.role ?? 'api_key',
		credentialId: overrides.credentialId,
	};
}

/**
 * Seeds a project-scoped agent config row.
 */
export async function seedAgentConfig(
	overrides: {
		projectId?: string;
		agentType?: string;
		model?: string | null;
		maxIterations?: number | null;
		agentEngine?: string | null;
	} = {},
) {
	const db = getDb();
	const [row] = await db
		.insert(agentConfigs)
		.values({
			projectId: overrides.projectId ?? 'test-project',
			agentType: overrides.agentType ?? 'implementation',
			model: overrides.model ?? null,
			maxIterations: overrides.maxIterations ?? null,
			agentEngine: overrides.agentEngine ?? null,
		})
		.returning();
	return row;
}

/**
 * Seeds an agent trigger config row (DB-driven trigger enable/disable).
 */
export async function seedTriggerConfig(overrides: {
	projectId?: string;
	agentType: string;
	triggerEvent: string;
	enabled?: boolean;
	parameters?: Record<string, unknown>;
}) {
	const db = getDb();
	const [row] = await db
		.insert(agentTriggerConfigs)
		.values({
			projectId: overrides.projectId ?? 'test-project',
			agentType: overrides.agentType,
			triggerEvent: overrides.triggerEvent,
			enabled: overrides.enabled ?? true,
			parameters: overrides.parameters ?? {},
		})
		.returning();
	return row;
}

/**
 * Seeds an agent run row.
 */
export async function seedRun(
	overrides: {
		projectId?: string;
		workItemId?: string;
		agentType?: string;
		engine?: string;
		status?: string;
	} = {},
) {
	const db = getDb();
	const [row] = await db
		.insert(agentRuns)
		.values({
			projectId: overrides.projectId ?? 'test-project',
			workItemId: overrides.workItemId ?? 'test-card',
			agentType: overrides.agentType ?? 'implementation',
			engine: overrides.engine ?? 'claude-code',
			status: overrides.status ?? 'running',
		})
		.returning();
	return row;
}

/**
 * Seeds a user row linked to an org.
 */
export async function seedUser(
	overrides: {
		orgId?: string;
		email?: string;
		name?: string;
		passwordHash?: string;
		role?: string;
	} = {},
) {
	const db = getDb();
	const [row] = await db
		.insert(users)
		.values({
			orgId: overrides.orgId ?? 'test-org',
			email: overrides.email ?? 'test@example.com',
			name: overrides.name ?? 'Test User',
			passwordHash: overrides.passwordHash ?? '$2b$10$hashedpassword',
			role: overrides.role ?? 'member',
		})
		.returning();
	return row;
}

/**
 * Seeds a webhook log row.
 */
export async function seedWebhookLog(
	overrides: {
		source?: string;
		method?: string;
		path?: string;
		eventType?: string;
		projectId?: string;
		headers?: Record<string, unknown>;
		body?: Record<string, unknown>;
	} = {},
) {
	const db = getDb();
	const [row] = await db
		.insert(webhookLogs)
		.values({
			source: overrides.source ?? 'trello',
			method: overrides.method ?? 'POST',
			path: overrides.path ?? '/webhooks/trello',
			eventType: overrides.eventType ?? 'updateCard',
			projectId: overrides.projectId,
			headers: overrides.headers,
			body: overrides.body,
		})
		.returning();
	return row;
}

/**
 * Seeds a prompt partial row.
 */
export async function seedPromptPartial(
	overrides: { orgId?: string | null; name?: string; content?: string } = {},
) {
	const db = getDb();
	const [row] = await db
		.insert(promptPartials)
		.values({
			orgId: overrides.orgId ?? null,
			name: overrides.name ?? 'test-partial',
			content: overrides.content ?? 'Test partial content',
		})
		.returning();
	return row;
}

/**
 * Seeds a session for a user.
 */
export async function seedSession(overrides: { userId: string; token?: string; expiresAt?: Date }) {
	const db = getDb();
	const futureDate = new Date();
	futureDate.setDate(futureDate.getDate() + 30);
	const [row] = await db
		.insert(sessions)
		.values({
			userId: overrides.userId,
			token: overrides.token ?? 'test-session-token',
			expiresAt: overrides.expiresAt ?? futureDate,
		})
		.returning();
	return row;
}

/**
 * Minimal valid AgentDefinition fixture that satisfies AgentDefinitionSchema.parse().
 */
export const MINIMAL_AGENT_DEFINITION: AgentDefinition = {
	identity: {
		emoji: '🤖',
		label: 'Test Agent',
		roleHint: 'A minimal test agent definition',
		initialMessage: 'Starting test agent...',
	},
	capabilities: {
		required: ['fs:read'],
		optional: [],
	},
	triggers: [],
	strategies: {
		gadgetOptions: undefined,
	},
	hint: 'This is a test hint for iteration guidance.',
	prompts: {
		taskPrompt: 'Perform the test task as described.',
	},
};

/**
 * Seeds an agent definition via the repository's upsertAgentDefinition function.
 * Merges overrides into the minimal valid AgentDefinition.
 */
export async function seedAgentDefinition(
	overrides: {
		agentType?: string;
		definition?: Partial<AgentDefinition>;
		isBuiltin?: boolean;
	} = {},
) {
	const agentType = overrides.agentType ?? 'test-agent';
	const definition: AgentDefinition = {
		...MINIMAL_AGENT_DEFINITION,
		...overrides.definition,
	};
	const isBuiltin = overrides.isBuiltin ?? false;
	await upsertAgentDefinition(agentType, definition, isBuiltin);
	return { agentType, definition, isBuiltin };
}

// ============================================================================
// Composite helpers for common integration setups
// ============================================================================

/**
 * Seeds a complete Trello PM integration with all required credentials.
 */
export async function seedTrelloIntegration(
	projectId = 'test-project',
	options?: { skipApiKey?: boolean; skipToken?: boolean; skipApiSecret?: boolean },
) {
	const integ = await seedIntegration({
		projectId,
		category: 'pm',
		provider: 'trello',
		config: { boardId: 'board-1', lists: {}, labels: {} },
	});

	if (!options?.skipApiKey) {
		await writeProjectCredential(projectId, 'TRELLO_API_KEY', 'test-api-key', 'Trello API Key');
	}

	if (!options?.skipApiSecret) {
		await writeProjectCredential(
			projectId,
			'TRELLO_API_SECRET',
			'test-api-secret',
			'Trello API Secret',
		);
	}

	if (!options?.skipToken) {
		await writeProjectCredential(projectId, 'TRELLO_TOKEN', 'test-token', 'Trello Token');
	}

	return integ;
}

/**
 * Seeds a complete JIRA PM integration with both required credentials.
 */
export async function seedJiraIntegration(
	projectId = 'test-project',
	options?: { skipEmail?: boolean; skipApiToken?: boolean },
) {
	const integ = await seedIntegration({
		projectId,
		category: 'pm',
		provider: 'jira',
		config: { siteUrl: 'https://test.atlassian.net', projectKey: 'TEST', statuses: {} },
	});

	if (!options?.skipEmail) {
		await writeProjectCredential(projectId, 'JIRA_EMAIL', 'test@example.com', 'JIRA Email');
	}

	if (!options?.skipApiToken) {
		await writeProjectCredential(projectId, 'JIRA_API_TOKEN', 'test-api-token', 'JIRA API Token');
	}

	return integ;
}

/**
 * Seeds a GitHub SCM integration with configurable persona tokens.
 *
 * By default, seeds both implementer and reviewer tokens.
 * Use skipImplementer/skipReviewer to omit specific tokens.
 */
export async function seedGitHubIntegration(
	projectId = 'test-project',
	options?: { skipImplementer?: boolean; skipReviewer?: boolean },
) {
	const integ = await seedIntegration({
		projectId,
		category: 'scm',
		provider: 'github',
	});

	if (!options?.skipImplementer) {
		await writeProjectCredential(
			projectId,
			'GITHUB_TOKEN_IMPLEMENTER',
			'ghp-impl-test',
			'Implementer Token',
		);
	}

	if (!options?.skipReviewer) {
		await writeProjectCredential(
			projectId,
			'GITHUB_TOKEN_REVIEWER',
			'ghp-rev-test',
			'Reviewer Token',
		);
	}

	return integ;
}
