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
});

describe('jiraManifest does NOT declare createLabel (free-form labels)', () => {
	it('createLabel hook is undefined', () => {
		expect(jiraManifest.createLabel).toBeUndefined();
	});
});
