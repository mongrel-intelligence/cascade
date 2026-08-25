/**
 * Spec 024 plan 1 — the routing discriminator must survive the DB load path.
 *
 * `jiraConfigSchema` accepting the field is not enough: `buildJiraConfig`
 * hand-picks the JIRA fields it forwards, so anything it omits is dropped
 * before `validateConfig` re-parses and loads back as `undefined`. That is
 * exactly the MNG-1736 `authType` bug, documented in a comment inside the very
 * function this test guards.
 *
 * These tests exercise the real mapper (no mocks) so a future field added to
 * the schema but forgotten in the mapper fails here rather than silently at
 * runtime.
 */
import { describe, expect, it } from 'vitest';
import { validateConfig } from '../../../src/config/schema.js';
import {
	extractIntegrationConfigs,
	type IntegrationRow,
	mapProjectRow,
} from '../../../src/db/repositories/configMapper.js';

const jiraIntegrationRow = (config: Record<string, unknown>): IntegrationRow =>
	({
		projectId: 'be',
		category: 'pm',
		provider: 'jira',
		config,
		triggers: {},
	}) as unknown as IntegrationRow;

const projectRow = {
	id: 'be',
	orgId: 'acme',
	name: 'BE',
	repo: null,
	repoPrimary: true,
	baseBranch: 'main',
	branchPrefix: 'feature/',
} as never;

const baseJira = {
	projectKey: 'CLFX',
	baseUrl: 'https://acme.atlassian.net',
	statuses: { todo: '1' },
};

/** Runs the production load path: integration rows → mapper → validateConfig. */
function loadJiraConfig(rawJira: Record<string, unknown>) {
	const { trelloConfig, jiraConfig, linearConfig, githubConfig } = extractIntegrationConfigs([
		jiraIntegrationRow(rawJira),
	]);
	const mapped = mapProjectRow({
		row: projectRow,
		projectAgentConfigs: [],
		trelloConfig,
		jiraConfig,
		linearConfig,
		githubConfig,
	});
	return validateConfig({ projects: [mapped] }).projects[0].jira;
}

describe('configMapper — JIRA routing discriminator survives the load path', () => {
	it('preserves a label discriminator through mapProjectRow and validateConfig', () => {
		const jira = loadJiraConfig({
			...baseJira,
			routing: { discriminator: { kind: 'label', value: 'team-be' } },
		});

		expect(jira?.routing).toEqual({ discriminator: { kind: 'label', value: 'team-be' } });
	});

	it('preserves a component discriminator', () => {
		const jira = loadJiraConfig({
			...baseJira,
			routing: { discriminator: { kind: 'component', value: 'Backend' } },
		});

		expect(jira?.routing?.discriminator).toEqual({ kind: 'component', value: 'Backend' });
	});

	it('loads a config without routing as undefined, not as a dropped field', () => {
		// The discriminator-less sibling is the default project; it must stay
		// distinguishable from "the mapper ate the field".
		const jira = loadJiraConfig(baseJira);

		expect(jira?.routing).toBeUndefined();
		expect(jira?.projectKey).toBe('CLFX');
	});
});
