import { getDb } from '../../../src/db/client.js';
import {
	agentConfigs,
	agentRuns,
	agentTriggerConfigs,
	cascadeDefaults,
	credentials,
	integrationCredentials,
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
		})
		.returning();
	return row;
}

/**
 * Seeds a credential row.
 */
export async function seedCredential(
	overrides: {
		orgId?: string;
		name?: string;
		envVarKey?: string;
		value?: string;
		isDefault?: boolean;
	} = {},
) {
	const db = getDb();
	const [row] = await db
		.insert(credentials)
		.values({
			orgId: overrides.orgId ?? 'test-org',
			name: overrides.name ?? 'Test Key',
			envVarKey: overrides.envVarKey ?? 'TEST_KEY',
			value: overrides.value ?? 'test-value',
			isDefault: overrides.isDefault ?? false,
		})
		.returning();
	return row;
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
 * Seeds an integration credential link.
 */
export async function seedIntegrationCredential(overrides: {
	integrationId: number;
	role?: string;
	credentialId: number;
}) {
	const db = getDb();
	const [row] = await db
		.insert(integrationCredentials)
		.values({
			integrationId: overrides.integrationId,
			role: overrides.role ?? 'api_key',
			credentialId: overrides.credentialId,
		})
		.returning();
	return row;
}

/**
 * Seeds cascade defaults for an org.
 */
export async function seedDefaults(
	overrides: {
		orgId?: string;
		model?: string | null;
		maxIterations?: number | null;
		agentEngine?: string | null;
	} = {},
) {
	const db = getDb();
	const [row] = await db
		.insert(cascadeDefaults)
		.values({
			orgId: overrides.orgId ?? 'test-org',
			model: overrides.model ?? null,
			maxIterations: overrides.maxIterations ?? null,
			agentEngine: overrides.agentEngine ?? null,
		})
		.returning();
	return row;
}

/**
 * Seeds an agent config row.
 */
export async function seedAgentConfig(
	overrides: {
		orgId?: string | null;
		projectId?: string | null;
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
			orgId: overrides.orgId ?? null,
			projectId: overrides.projectId ?? null,
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
	overrides: {
		orgId?: string | null;
		name?: string;
		content?: string;
	} = {},
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
export async function seedSession(overrides: {
	userId: string;
	token?: string;
	expiresAt?: Date;
}) {
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

// ============================================================================
// Composite helpers for common integration setups
// ============================================================================

/**
 * Seeds a complete Trello PM integration with both required credentials.
 */
export async function seedTrelloIntegration(
	projectId = 'test-project',
	options?: { skipApiKey?: boolean; skipToken?: boolean },
) {
	const integ = await seedIntegration({
		projectId,
		category: 'pm',
		provider: 'trello',
		config: { boardId: 'board-1', lists: {}, labels: {} },
	});

	if (!options?.skipApiKey) {
		const apiKey = await seedCredential({
			envVarKey: 'TRELLO_API_KEY',
			value: 'test-api-key',
			name: 'Trello API Key',
		});
		await seedIntegrationCredential({
			integrationId: integ.id,
			role: 'api_key',
			credentialId: apiKey.id,
		});
	}

	if (!options?.skipToken) {
		const token = await seedCredential({
			envVarKey: 'TRELLO_TOKEN',
			value: 'test-token',
			name: 'Trello Token',
		});
		await seedIntegrationCredential({
			integrationId: integ.id,
			role: 'token',
			credentialId: token.id,
		});
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
		const email = await seedCredential({
			envVarKey: 'JIRA_EMAIL',
			value: 'test@example.com',
			name: 'JIRA Email',
		});
		await seedIntegrationCredential({
			integrationId: integ.id,
			role: 'email',
			credentialId: email.id,
		});
	}

	if (!options?.skipApiToken) {
		const apiToken = await seedCredential({
			envVarKey: 'JIRA_API_TOKEN',
			value: 'test-api-token',
			name: 'JIRA API Token',
		});
		await seedIntegrationCredential({
			integrationId: integ.id,
			role: 'api_token',
			credentialId: apiToken.id,
		});
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
		const implCred = await seedCredential({
			envVarKey: 'GITHUB_TOKEN_IMPLEMENTER',
			value: 'ghp-impl-test',
			name: 'Implementer Token',
		});
		await seedIntegrationCredential({
			integrationId: integ.id,
			role: 'implementer_token',
			credentialId: implCred.id,
		});
	}

	if (!options?.skipReviewer) {
		const revCred = await seedCredential({
			envVarKey: 'GITHUB_TOKEN_REVIEWER',
			value: 'ghp-rev-test',
			name: 'Reviewer Token',
		});
		await seedIntegrationCredential({
			integrationId: integ.id,
			role: 'reviewer_token',
			credentialId: revCred.id,
		});
	}

	return integ;
}
