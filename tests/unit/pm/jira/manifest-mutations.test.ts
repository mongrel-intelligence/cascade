/**
 * JIRA manifest mutation hooks (plan 010/1 task 5).
 *
 * JIRA declares `createCustomField` only — JIRA labels are free-form
 * strings auto-created on first use (spec 009/3 discovery returns
 * empty for labels).
 *
 * JIRA's `createCustomField` is global (ignores containerId / projectKey).
 * The hook accepts `containerId` for uniform shape but doesn't thread
 * it to the client.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/jira/client.js', () => ({
	withJiraCredentials: vi.fn(async (_creds, fn) => fn()),
	jiraClient: {
		createCustomField: vi.fn(async (name: string) => ({
			id: `customfield_${name}`,
			name,
		})),
	},
}));

import { jiraManifest } from '../../../../src/integrations/pm/jira/manifest.js';
import { withJiraCredentials } from '../../../../src/jira/client.js';

describe('jiraManifest.createCustomField (plan 010/1)', () => {
	it('is declared', () => {
		expect(typeof jiraManifest.createCustomField).toBe('function');
	});

	it('delegates to jiraClient.createCustomField via withJiraCredentials', async () => {
		const hook = jiraManifest.createCustomField;
		if (!hook) throw new Error('createCustomField should be defined');
		const result = await hook({
			credentials: { email: 'a@b.com', api_token: 't', base_url: 'https://x.atlassian.net' },
			containerId: 'CASC',
			name: 'Cost',
		});
		expect(result).toMatchObject({ name: 'Cost' });
		expect(result.type).toBeTruthy();
	});

	// MNG-1743: thread the configured auth mode into withJiraCredentials so the
	// createCustomField call routes through the correct host under scoped auth.
	it("threads auth_type: 'scoped' from credentials into withJiraCredentials", async () => {
		const hook = jiraManifest.createCustomField;
		if (!hook) throw new Error('createCustomField should be defined');
		await hook({
			credentials: {
				email: 'a@b.com',
				api_token: 't',
				base_url: 'https://x.atlassian.net',
				auth_type: 'scoped',
			},
			containerId: 'CASC',
			name: 'Cost',
		});
		expect(withJiraCredentials).toHaveBeenCalledWith(
			expect.objectContaining({
				email: 'a@b.com',
				apiToken: 't',
				baseUrl: 'https://x.atlassian.net',
				authType: 'scoped',
			}),
			expect.any(Function),
		);
	});

	it('passes authType undefined when auth_type is absent', async () => {
		const hook = jiraManifest.createCustomField;
		if (!hook) throw new Error('createCustomField should be defined');
		await hook({
			credentials: { email: 'a@b.com', api_token: 't', base_url: 'https://x.atlassian.net' },
			containerId: 'CASC',
			name: 'Cost',
		});
		const call = vi.mocked(withJiraCredentials).mock.calls.at(-1);
		expect((call?.[0] as { authType?: string }).authType).toBeUndefined();
	});
});

describe('jiraManifest does NOT declare createLabel (free-form labels)', () => {
	it('createLabel hook is undefined', () => {
		expect(jiraManifest.createLabel).toBeUndefined();
	});
});
