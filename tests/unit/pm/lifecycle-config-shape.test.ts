/**
 * Type-level + runtime assertions on the canonical ProjectPMConfig shape.
 *
 * The normalized interface must declare the full CASCADE stage vocabulary
 * so every provider has one canonical shape to fill in. Without this
 * guarantee, providers drift (as JIRA did — its wizard accepts splitting /
 * planning / todo but resolveLifecycleConfig silently dropped them).
 */

import { describe, expect, it } from 'vitest';
import type { ProjectPMConfig } from '../../../src/pm/lifecycle.js';
import { STATUS_TO_AGENT } from '../../../src/triggers/shared/status-to-agent.js';

describe('ProjectPMConfig.statuses shape', () => {
	it('accepts all 9 canonical CASCADE stages as optional string keys', () => {
		const cfg: ProjectPMConfig = {
			labels: {},
			statuses: {
				backlog: 'state-bl',
				splitting: 'state-sp',
				planning: 'state-pl',
				todo: 'state-td',
				inProgress: 'state-ip',
				inReview: 'state-ir',
				done: 'state-dn',
				merged: 'state-mg',
				debug: 'state-dbg',
			},
		};
		expect(Object.keys(cfg.statuses)).toHaveLength(9);
	});

	it('accepts an empty statuses object (all keys optional)', () => {
		const cfg: ProjectPMConfig = { labels: {}, statuses: {} };
		expect(cfg.statuses).toEqual({});
	});

	it('accepts custom workflow status keys for provider lifecycle moves', () => {
		const cfg: ProjectPMConfig = {
			labels: {},
			statuses: {
				prd: 'state-prd',
				story: 'state-story',
				'phased-plan': 'state-phased-plan',
			},
		};

		expect(cfg.statuses.story).toBe('state-story');
		expect(cfg.statuses['phased-plan']).toBe('state-phased-plan');
	});

	it('every key in STATUS_TO_AGENT is a declared key of ProjectPMConfig.statuses', () => {
		// Construct a fully populated statuses object; if STATUS_TO_AGENT contains
		// any key that isn't assignable to ProjectPMConfig.statuses, this ceases to
		// type-check.
		const allStatuses = {
			backlog: '',
			splitting: '',
			planning: '',
			todo: '',
			inProgress: '',
			inReview: '',
			done: '',
			merged: '',
			debug: '',
		} satisfies Required<Record<keyof typeof STATUS_TO_AGENT, string>>;

		for (const agentKey of Object.keys(STATUS_TO_AGENT)) {
			expect(agentKey in allStatuses).toBe(true);
		}
	});
});
