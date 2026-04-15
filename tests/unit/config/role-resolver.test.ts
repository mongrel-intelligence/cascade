/**
 * Tests for roleToEnvVarKey disambiguation by provider.
 *
 * The prior implementation iterated all providers in a category and returned
 * the first role-name match, so ('pm', 'api_key') silently returned
 * TRELLO_API_KEY on a Linear-only project and ('pm', 'webhook_secret')
 * silently returned JIRA_WEBHOOK_SECRET when asking about Linear. The fix
 * requires an explicit provider argument.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveSpy = vi.fn<(projectId: string, envVarKey: string) => Promise<string | null>>();

vi.mock('../../../src/db/repositories/credentialsRepository.js', () => ({
	resolveProjectCredential: (projectId: string, envVarKey: string) =>
		resolveSpy(projectId, envVarKey),
}));

const { getIntegrationCredential, getIntegrationCredentialOrNull } = await import(
	'../../../src/config/provider.js'
);

describe('role resolver — disambiguation by provider', () => {
	beforeEach(() => {
		resolveSpy.mockReset();
		resolveSpy.mockResolvedValue('stored-value');
	});

	it('looks up TRELLO_API_KEY for (pm, trello, api_key)', async () => {
		await getIntegrationCredentialOrNull('proj', 'pm', 'trello', 'api_key');
		expect(resolveSpy).toHaveBeenCalledWith('proj', 'TRELLO_API_KEY');
	});

	it('looks up LINEAR_API_KEY for (pm, linear, api_key)', async () => {
		await getIntegrationCredentialOrNull('proj', 'pm', 'linear', 'api_key');
		expect(resolveSpy).toHaveBeenCalledWith('proj', 'LINEAR_API_KEY');
	});

	it('looks up JIRA_WEBHOOK_SECRET for (pm, jira, webhook_secret)', async () => {
		await getIntegrationCredentialOrNull('proj', 'pm', 'jira', 'webhook_secret');
		expect(resolveSpy).toHaveBeenCalledWith('proj', 'JIRA_WEBHOOK_SECRET');
	});

	it('looks up LINEAR_WEBHOOK_SECRET for (pm, linear, webhook_secret) — the production bug', async () => {
		await getIntegrationCredentialOrNull('proj', 'pm', 'linear', 'webhook_secret');
		expect(resolveSpy).toHaveBeenCalledWith('proj', 'LINEAR_WEBHOOK_SECRET');
	});

	it('looks up GITHUB_WEBHOOK_SECRET for (scm, github, webhook_secret)', async () => {
		await getIntegrationCredentialOrNull('proj', 'scm', 'github', 'webhook_secret');
		expect(resolveSpy).toHaveBeenCalledWith('proj', 'GITHUB_WEBHOOK_SECRET');
	});

	it('looks up SENTRY_WEBHOOK_SECRET for (alerting, sentry, webhook_secret)', async () => {
		await getIntegrationCredentialOrNull('proj', 'alerting', 'sentry', 'webhook_secret');
		expect(resolveSpy).toHaveBeenCalledWith('proj', 'SENTRY_WEBHOOK_SECRET');
	});

	it('returns null when the role is not registered for the provider', async () => {
		// JIRA does not have an api_key role.
		const result = await getIntegrationCredentialOrNull('proj', 'pm', 'jira', 'api_key');
		expect(result).toBeNull();
		expect(resolveSpy).not.toHaveBeenCalled();
	});

	it('returns null when the provided category does not match the provider', async () => {
		const result = await getIntegrationCredentialOrNull(
			'proj',
			'pm',
			'github',
			'implementer_token',
		);
		expect(result).toBeNull();
		expect(resolveSpy).not.toHaveBeenCalled();
	});

	it('getIntegrationCredential throws and the error message names the provider', async () => {
		resolveSpy.mockResolvedValue(null);
		await expect(getIntegrationCredential('proj', 'pm', 'linear', 'api_key')).rejects.toThrow(
			/linear.*api_key|api_key.*linear/i,
		);
	});
});
