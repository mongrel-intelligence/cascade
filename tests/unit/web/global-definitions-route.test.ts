import { describe, expect, it } from 'vitest';
import { AGENT_DEFINITIONS_TABS } from '../../../web/src/routes/global/definitions-tabs.js';
import { getStatusDispatchAgentTypes } from '../../../web/src/routes/global/definitions-utils.js';

describe('global definitions route', () => {
	it('exposes the workflow statuses tab in the tab bar', () => {
		expect(AGENT_DEFINITIONS_TABS).toEqual(['definitions', 'partials', 'workflow-statuses']);
	});

	it('lists only agents that declare status-changed dispatch for workflow status mappings', () => {
		const result = getStatusDispatchAgentTypes([
			{
				agentType: 'debug',
				definition: {
					triggers: [],
				},
			},
			{
				agentType: 'story',
				definition: {
					triggers: [
						{
							event: 'pm:status-changed',
						},
					],
				},
			},
			{
				agentType: 'respond-to-pr-comment',
				definition: {
					triggers: [
						{
							event: 'scm:pr-comment-mention',
						},
					],
				},
			},
		]);

		expect(result).toEqual(['story']);
	});
});
