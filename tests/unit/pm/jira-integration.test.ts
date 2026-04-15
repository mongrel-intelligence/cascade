/**
 * JiraIntegration.resolveLifecycleConfig — unit tests.
 *
 * Verifies the silent-drop bug fix: splitting / planning / todo mappings
 * the JIRA wizard accepts now surface through to the normalized
 * ProjectPMConfig used by the trigger layer.
 */

import { describe, expect, it } from 'vitest';
import { JiraIntegration } from '../../../src/pm/jira/integration.js';
import type { ProjectConfig } from '../../../src/types/index.js';

function makeProject(statuses: Record<string, string>): ProjectConfig {
	return {
		id: 'test',
		name: 'test',
		repo: 'owner/repo',
		pm: { type: 'jira' },
		jira: {
			projectKey: 'PROJ',
			baseUrl: 'https://example.atlassian.net',
			statuses,
		},
	} as unknown as ProjectConfig;
}

describe('JiraIntegration.resolveLifecycleConfig', () => {
	const integration = new JiraIntegration();

	it('returns splitting, planning, todo when present in jira config', () => {
		const project = makeProject({
			splitting: 'SPL',
			planning: 'PLAN',
			todo: 'TODO',
			inProgress: 'IP',
			done: 'DN',
		});
		const cfg = integration.resolveLifecycleConfig(project);
		expect(cfg.statuses.splitting).toBe('SPL');
		expect(cfg.statuses.planning).toBe('PLAN');
		expect(cfg.statuses.todo).toBe('TODO');
		expect(cfg.statuses.inProgress).toBe('IP');
		expect(cfg.statuses.done).toBe('DN');
	});

	it('still returns the 5 pre-existing keys (backlog, inProgress, inReview, done, merged) for regression safety', () => {
		const project = makeProject({
			backlog: 'BL',
			inProgress: 'IP',
			inReview: 'IR',
			done: 'DN',
			merged: 'MG',
		});
		const cfg = integration.resolveLifecycleConfig(project);
		expect(cfg.statuses.backlog).toBe('BL');
		expect(cfg.statuses.inProgress).toBe('IP');
		expect(cfg.statuses.inReview).toBe('IR');
		expect(cfg.statuses.done).toBe('DN');
		expect(cfg.statuses.merged).toBe('MG');
	});
});
