/**
 * JIRA manifest configSchema (plan 009/3 task 1).
 *
 * Extracts the JIRA Zod schema from its inline location in
 * src/config/schema.ts into a dedicated file so the manifest can
 * declare `configSchema: jiraConfigSchema` and the conformance
 * harness can run round-trip identity against it.
 *
 * The inline copy in src/config/schema.ts stays in place and is
 * marked @deprecated pointing here. Plan 5 routes the config mapper
 * through the manifest registry and deletes the duplicate.
 *
 * NOTE: JIRA API credentials (email, apiToken) live in the
 * project_credentials table, not in this config. The schema only
 * covers project-scoped settings.
 */

import { beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import { registerBuiltInEngines } from '../../../../src/backends/bootstrap.js';
import { ProjectConfigSchema } from '../../../../src/config/schema.js';
import {
	type JiraIntegrationConfig,
	jiraConfigSchema,
} from '../../../../src/integrations/pm/jira/config-schema.js';
import { jiraManifest } from '../../../../src/integrations/pm/jira/manifest.js';
import type { ProjectConfig } from '../../../../src/types/index.js';

const fullFixture = {
	projectKey: 'CASCADE',
	baseUrl: 'https://example.atlassian.net',
	statuses: { backlog: '10000', todo: '10001', done: '10002' },
	issueTypes: { task: 'Task', bug: 'Bug' },
	customFields: { cost: 'customfield_10100' },
	labels: {
		processing: 'cascade-processing',
		processed: 'cascade-processed',
		error: 'cascade-error',
		readyToProcess: 'cascade-ready',
	},
};

describe('jiraConfigSchema', () => {
	it('round-trip identity: parse → serialize → reparse → deep-equal', () => {
		const parsed1 = jiraConfigSchema.parse(fullFixture);
		const parsed2 = jiraConfigSchema.parse(JSON.parse(JSON.stringify(parsed1)));
		expect(parsed2).toEqual(parsed1);
	});

	it('rejects missing projectKey', () => {
		const { projectKey: _, ...rest } = fullFixture;
		expect(() => jiraConfigSchema.parse(rest)).toThrow();
	});

	it('rejects missing baseUrl', () => {
		const { baseUrl: _, ...rest } = fullFixture;
		expect(() => jiraConfigSchema.parse(rest)).toThrow();
	});

	it('rejects invalid baseUrl (not a URL)', () => {
		expect(() => jiraConfigSchema.parse({ ...fullFixture, baseUrl: 'not a url' })).toThrow();
	});

	it('accepts minimal config (projectKey + baseUrl + statuses)', () => {
		const parsed = jiraConfigSchema.parse({
			projectKey: 'X',
			baseUrl: 'https://x.atlassian.net',
			statuses: {},
		});
		expect(parsed.projectKey).toBe('X');
	});

	it('applies label defaults when labels block is present but keys are missing', () => {
		// The inline schema declares .default() on each label key, but only
		// fires when the outer labels object exists.
		const parsed = jiraConfigSchema.parse({
			projectKey: 'X',
			baseUrl: 'https://x.atlassian.net',
			statuses: {},
			labels: {},
		});
		expect(parsed.labels?.processing).toBe('cascade-processing');
		expect(parsed.labels?.readyToProcess).toBe('cascade-ready');
	});
});

describe('jiraManifest exposes configSchema', () => {
	it('jiraManifest.configSchema is the extracted jiraConfigSchema', () => {
		expect(jiraManifest.configSchema).toBe(jiraConfigSchema);
	});

	it('jiraManifest.configFixture parses cleanly against the schema', () => {
		const schema = jiraManifest.configSchema;
		expect(schema).toBeDefined();
		if (!schema) return;
		expect(() => schema.parse(jiraManifest.configFixture)).not.toThrow();
	});

	it("jiraManifest.configFixture includes authType: 'basic'", () => {
		const schema = jiraManifest.configSchema;
		expect(schema).toBeDefined();
		if (!schema) return;
		const parsed = schema.parse(jiraManifest.configFixture) as JiraIntegrationConfig;
		expect(parsed.authType).toBe('basic');
	});
});

describe('jiraConfigSchema — optional authType (MNG-1736)', () => {
	it("accepts authType: 'basic' and preserves it across a round-trip", () => {
		const parsed1 = jiraConfigSchema.parse({ ...fullFixture, authType: 'basic' });
		expect(parsed1.authType).toBe('basic');
		const parsed2 = jiraConfigSchema.parse(JSON.parse(JSON.stringify(parsed1)));
		expect(parsed2).toEqual(parsed1);
	});

	it("accepts authType: 'scoped' and preserves it across a round-trip", () => {
		const parsed1 = jiraConfigSchema.parse({ ...fullFixture, authType: 'scoped' });
		expect(parsed1.authType).toBe('scoped');
		const parsed2 = jiraConfigSchema.parse(JSON.parse(JSON.stringify(parsed1)));
		expect(parsed2).toEqual(parsed1);
	});

	it('treats absent authType as valid — existing configs without authType stay valid', () => {
		// fullFixture carries no authType: this is the pre-MNG-1736 shape.
		const parsed = jiraConfigSchema.parse(fullFixture);
		expect(parsed.authType).toBeUndefined();
		// Optional-without-default: absent stays absent (no key injected), so the
		// round-trip identity the conformance harness relies on stays green.
		const reparsed = jiraConfigSchema.parse(JSON.parse(JSON.stringify(parsed)));
		expect(reparsed).toEqual(parsed);
		expect('authType' in reparsed).toBe(false);
	});

	it('rejects unknown authType values (no bearer/oauth enum expansion — MNG-1735)', () => {
		expect(() => jiraConfigSchema.parse({ ...fullFixture, authType: 'bearer' })).toThrow();
		expect(() => jiraConfigSchema.parse({ ...fullFixture, authType: 'oauth' })).toThrow();
		expect(() => jiraConfigSchema.parse({ ...fullFixture, authType: '' })).toThrow();
	});

	it('infers authType as an optional basic|scoped union on JiraIntegrationConfig', () => {
		expectTypeOf<JiraIntegrationConfig['authType']>().toEqualTypeOf<
			'basic' | 'scoped' | undefined
		>();
	});
});

describe('ProjectConfig-level authType flow (MNG-1736 — src/types/index.ts)', () => {
	beforeAll(() => {
		// ProjectConfigSchema references engine defaults elsewhere in the object;
		// register the built-in engines so an unrelated default never interferes.
		registerBuiltInEngines();
	});

	it("central ProjectConfigSchema accepts a jira block carrying authType: 'scoped'", () => {
		const result = ProjectConfigSchema.parse({
			id: 'p1',
			orgId: 'org1',
			name: 'Proj',
			repo: 'owner/repo',
			pm: { type: 'jira' },
			jira: {
				projectKey: 'CASCADE',
				baseUrl: 'https://acme.atlassian.net',
				authType: 'scoped',
				statuses: {},
			},
		});
		expect(result.jira?.authType).toBe('scoped');
	});

	it('central ProjectConfigSchema still accepts a jira block without authType (backward compat)', () => {
		const result = ProjectConfigSchema.parse({
			id: 'p2',
			orgId: 'org1',
			name: 'Proj',
			repo: 'owner/repo',
			pm: { type: 'jira' },
			jira: {
				projectKey: 'CASCADE',
				baseUrl: 'https://acme.atlassian.net',
				statuses: {},
			},
		});
		expect(result.jira?.authType).toBeUndefined();
	});

	it('ProjectConfig["jira"] type (src/types/index.ts) exposes optional authType', () => {
		// ProjectConfig is z.infer<typeof ProjectConfigSchema>, whose `jira` field
		// derives from jiraConfigSchema — the single source of truth. Adding the
		// field to the schema flows it here with no hand-written interface to edit.
		expectTypeOf<NonNullable<ProjectConfig['jira']>['authType']>().toEqualTypeOf<
			'basic' | 'scoped' | undefined
		>();
	});
});
