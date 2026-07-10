/**
 * JIRA manifest `configToCredentials` hook.
 *
 * Regression pin for the 2026-04-24 prod incident: the JIRA wizard's
 * Select Project step returned "Error: Internal server error" because
 * `pm.discovery.discover({ projectId })` resolved credentials only from
 * `project_credentials` (email, api_token) and never read `baseUrl` off
 * the integration config, so the JIRA client constructed
 * `new Version3Client({ host: '' })` and threw "Couldn't parse the host URL".
 *
 * The fix is a manifest-level `configToCredentials` hook that promotes
 * `config.baseUrl` into the discovery credentials bag as `base_url`.
 * These tests pin that contract at the manifest layer, independent of
 * the router wiring (which is covered by the pm-discovery router test).
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { jiraManifest } from '../../../../src/integrations/pm/jira/manifest.js';

describe('jiraManifest.configToCredentials', () => {
	let hook: NonNullable<typeof jiraManifest.configToCredentials>;

	beforeAll(() => {
		const declared = jiraManifest.configToCredentials;
		if (!declared) {
			throw new Error(
				'jiraManifest.configToCredentials must be declared — the 2026-04-24 wizard incident depends on it.',
			);
		}
		hook = declared;
	});

	it('promotes baseUrl from config into base_url credential slot', () => {
		expect(hook({ baseUrl: 'https://acme.atlassian.net' })).toEqual({
			base_url: 'https://acme.atlassian.net',
		});
	});

	it('returns an empty object when baseUrl is missing', () => {
		expect(hook({})).toEqual({});
	});

	it('returns an empty object when baseUrl is an empty string', () => {
		expect(hook({ baseUrl: '' })).toEqual({});
	});

	it('returns an empty object when baseUrl is non-string', () => {
		expect(hook({ baseUrl: 123 })).toEqual({});
		expect(hook({ baseUrl: null })).toEqual({});
		expect(hook({ baseUrl: { nested: 'x' } })).toEqual({});
	});

	it('returns an empty object when config is null or undefined', () => {
		expect(hook(null)).toEqual({});
		expect(hook(undefined)).toEqual({});
	});

	it('returns an empty object when config is not an object', () => {
		expect(hook('string-config')).toEqual({});
		expect(hook(42)).toEqual({});
	});

	it('ignores unrelated config fields', () => {
		expect(
			hook({
				baseUrl: 'https://acme.atlassian.net',
				projectKey: 'CASCADE',
				statuses: { todo: 'To Do' },
			}),
		).toEqual({ base_url: 'https://acme.atlassian.net' });
	});
});

/**
 * MNG-1743: the hook also promotes `config.authType → auth_type` so the
 * projectId (edit-mode) path of `pm.discovery.*` re-verifies scoped JIRA
 * projects against the Atlassian gateway host instead of the classic site URL.
 */
describe('jiraManifest.configToCredentials — authType promotion (MNG-1743)', () => {
	let hook: NonNullable<typeof jiraManifest.configToCredentials>;

	beforeAll(() => {
		const declared = jiraManifest.configToCredentials;
		if (!declared) {
			throw new Error('jiraManifest.configToCredentials must be declared');
		}
		hook = declared;
	});

	it("promotes authType: 'scoped' into auth_type alongside base_url", () => {
		expect(hook({ baseUrl: 'https://acme.atlassian.net', authType: 'scoped' })).toEqual({
			base_url: 'https://acme.atlassian.net',
			auth_type: 'scoped',
		});
	});

	it("promotes authType: 'basic' into auth_type alongside base_url", () => {
		expect(hook({ baseUrl: 'https://acme.atlassian.net', authType: 'basic' })).toEqual({
			base_url: 'https://acme.atlassian.net',
			auth_type: 'basic',
		});
	});

	it('promotes authType even when baseUrl is absent', () => {
		expect(hook({ authType: 'scoped' })).toEqual({ auth_type: 'scoped' });
	});

	it('omits auth_type when authType is absent (backward compat)', () => {
		expect(hook({ baseUrl: 'https://acme.atlassian.net' })).toEqual({
			base_url: 'https://acme.atlassian.net',
		});
	});

	it('omits auth_type for unknown / invalid authType values', () => {
		expect(hook({ baseUrl: 'https://acme.atlassian.net', authType: 'bearer' })).toEqual({
			base_url: 'https://acme.atlassian.net',
		});
		expect(hook({ authType: '' })).toEqual({});
		expect(hook({ authType: 123 })).toEqual({});
		expect(hook({ authType: null })).toEqual({});
	});
});
