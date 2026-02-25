import { getDb } from '../../../src/db/client.js';
import {
	agentConfigs,
	agentRunLogs,
	agentRuns,
	cascadeDefaults,
	credentials,
	integrationCredentials,
	organizations,
	prWorkItems,
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
		agentBackend?: string | null;
	} = {},
) {
	const db = getDb();
	const [row] = await db
		.insert(cascadeDefaults)
		.values({
			orgId: overrides.orgId ?? 'test-org',
			model: overrides.model ?? null,
			maxIterations: overrides.maxIterations ?? null,
			agentBackend: overrides.agentBackend ?? null,
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
		agentBackend?: string | null;
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
			agentBackend: overrides.agentBackend ?? null,
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
		cardId?: string;
		agentType?: string;
		backend?: string;
		status?: string;
	} = {},
) {
	const db = getDb();
	const [row] = await db
		.insert(agentRuns)
		.values({
			projectId: overrides.projectId ?? 'test-project',
			cardId: overrides.cardId ?? 'test-card',
			agentType: overrides.agentType ?? 'implementation',
			backend: overrides.backend ?? 'claude-code',
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
 * Seeds a PR work item link.
 */
export async function seedPrWorkItem(
	overrides: {
		projectId?: string;
		repoFullName?: string;
		prNumber?: number;
		workItemId?: string;
	} = {},
) {
	const db = getDb();
	const [row] = await db
		.insert(prWorkItems)
		.values({
			projectId: overrides.projectId ?? 'test-project',
			repoFullName: overrides.repoFullName ?? 'owner/repo',
			prNumber: overrides.prNumber ?? 1,
			workItemId: overrides.workItemId ?? 'card-abc123',
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

/**
 * Seeds run logs for an agent run.
 */
export async function seedRunLogs(overrides: {
	runId: string;
	cascadeLog?: string;
	llmistLog?: string;
}) {
	const db = getDb();
	const [row] = await db
		.insert(agentRunLogs)
		.values({
			runId: overrides.runId,
			cascadeLog: overrides.cascadeLog ?? 'Test cascade log',
			llmistLog: overrides.llmistLog ?? null,
		})
		.returning();
	return row;
}
