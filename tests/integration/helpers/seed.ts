import { getDb } from '../../../src/db/client.js';
import {
	credentials,
	integrationCredentials,
	organizations,
	projectIntegrations,
	projects,
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
