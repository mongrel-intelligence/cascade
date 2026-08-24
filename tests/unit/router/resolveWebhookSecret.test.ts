/**
 * Tests for router resolveWebhookSecret — proves Linear webhook signature
 * verification no longer silently resolves to the JIRA webhook secret.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveSpy = vi.fn<(projectId: string, envVarKey: string) => Promise<string | null>>();

vi.mock('../../../src/db/repositories/credentialsRepository.js', () => ({
	resolveProjectCredential: (projectId: string, envVarKey: string) =>
		resolveSpy(projectId, envVarKey),
}));

const { resolveWebhookSecret } = await import('../../../src/router/platformClients/credentials.js');
const { registerCredentialRoles } = await import('../../../src/config/integrationRoles.js');

// github-projects self-registers its credential roles at module load time
// (src/pm/github-projects/integration.ts) rather than via the static
// PROVIDER_CREDENTIAL_ROLES map. Mirror that registration here so the
// 'github-projects' branch of resolveWebhookSecret resolves a real envVarKey
// without needing to import the full integration module (and its DB/client
// transitive imports) into this isolated unit test.
registerCredentialRoles('github-projects', 'pm', [
	{ role: 'token', label: 'Personal Access Token', envVarKey: 'GITHUB_PROJECTS_TOKEN' },
	{
		role: 'webhook_secret',
		label: 'Webhook Secret',
		envVarKey: 'GITHUB_PROJECTS_WEBHOOK_SECRET',
		optional: true,
	},
]);

describe('resolveWebhookSecret', () => {
	beforeEach(() => {
		resolveSpy.mockReset();
	});

	it("returns LINEAR_WEBHOOK_SECRET for provider='linear' — the production bug is fixed", async () => {
		resolveSpy.mockImplementation(async (_, key) =>
			key === 'LINEAR_WEBHOOK_SECRET' ? 'lin-secret' : null,
		);
		const got = await resolveWebhookSecret('proj', 'linear');
		expect(got).toBe('lin-secret');
		expect(resolveSpy).toHaveBeenCalledWith('proj', 'LINEAR_WEBHOOK_SECRET');
	});

	it("returns null for provider='linear' when only JIRA_WEBHOOK_SECRET is configured", async () => {
		resolveSpy.mockImplementation(async (_, key) =>
			key === 'JIRA_WEBHOOK_SECRET' ? 'jira-secret' : null,
		);
		const got = await resolveWebhookSecret('proj', 'linear');
		expect(got).toBeNull();
	});

	it("returns JIRA_WEBHOOK_SECRET for provider='jira'", async () => {
		resolveSpy.mockImplementation(async (_, key) =>
			key === 'JIRA_WEBHOOK_SECRET' ? 'jira-secret' : null,
		);
		const got = await resolveWebhookSecret('proj', 'jira');
		expect(got).toBe('jira-secret');
		expect(resolveSpy).toHaveBeenCalledWith('proj', 'JIRA_WEBHOOK_SECRET');
	});

	it("returns GITHUB_WEBHOOK_SECRET for provider='github'", async () => {
		resolveSpy.mockImplementation(async (_, key) =>
			key === 'GITHUB_WEBHOOK_SECRET' ? 'gh-secret' : null,
		);
		const got = await resolveWebhookSecret('proj', 'github');
		expect(got).toBe('gh-secret');
		expect(resolveSpy).toHaveBeenCalledWith('proj', 'GITHUB_WEBHOOK_SECRET');
	});

	it("returns SENTRY_WEBHOOK_SECRET for provider='sentry'", async () => {
		resolveSpy.mockImplementation(async (_, key) =>
			key === 'SENTRY_WEBHOOK_SECRET' ? 'sentry-secret' : null,
		);
		const got = await resolveWebhookSecret('proj', 'sentry');
		expect(got).toBe('sentry-secret');
		expect(resolveSpy).toHaveBeenCalledWith('proj', 'SENTRY_WEBHOOK_SECRET');
	});

	it("returns GITHUB_PROJECTS_WEBHOOK_SECRET for provider='github-projects'", async () => {
		// GitHub Projects uses a provider-specific webhook-secret env-var key
		// (GITHUB_PROJECTS_WEBHOOK_SECRET) rather than the SCM `github` provider's
		// GITHUB_WEBHOOK_SECRET — see src/pm/github-projects/integration.ts. Since
		// credential rows are keyed only by (projectId, envVarKey), the distinct key
		// lets a project with both GitHub SCM and GitHub Projects PM configured store
		// separate webhook secrets for the repo-hook and the projects_v2_item hook.
		resolveSpy.mockImplementation(async (_, key) =>
			key === 'GITHUB_PROJECTS_WEBHOOK_SECRET' ? 'gh-projects-secret' : null,
		);
		const got = await resolveWebhookSecret('proj', 'github-projects');
		expect(got).toBe('gh-projects-secret');
		expect(resolveSpy).toHaveBeenCalledWith('proj', 'GITHUB_PROJECTS_WEBHOOK_SECRET');
	});

	it("returns null for provider='github-projects' when no secret is configured", async () => {
		resolveSpy.mockImplementation(async () => null);
		const got = await resolveWebhookSecret('proj', 'github-projects');
		expect(got).toBeNull();
	});

	it("returns TRELLO_API_SECRET for provider='trello' (Trello HMAC uses api_secret)", async () => {
		resolveSpy.mockImplementation(async (_, key) =>
			key === 'TRELLO_API_SECRET' ? 'trello-api-secret' : null,
		);
		const got = await resolveWebhookSecret('proj', 'trello');
		expect(got).toBe('trello-api-secret');
		expect(resolveSpy).toHaveBeenCalledWith('proj', 'TRELLO_API_SECRET');
	});
});
