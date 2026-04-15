/**
 * Unit tests for WebhookStep — Node SSR.
 *
 * Covers Linear credential threading and Trello / JIRA non-regression. See the
 * plan-divergence note in the parent plan for why this is SSR-only (interactive
 * tests need jsdom + testing-library, which web/ does not ship).
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Stub ProjectSecretField to keep React Query + tRPC out of module load.
vi.mock('../../../web/src/components/projects/project-secret-field.js', () => ({
	ProjectSecretField: ({
		envVarKey,
		label,
		credential,
	}: {
		projectId: string;
		envVarKey: string;
		label: string;
		credential?: { isConfigured: boolean; maskedValue: string };
	}) =>
		createElement(
			'div',
			{
				'data-testid': 'project-secret-field',
				'data-envvarkey': envVarKey,
			},
			createElement('label', null, label),
			credential?.isConfigured ? createElement('span', null, credential.maskedValue) : null,
		),
}));

import { WebhookStep } from '../../../web/src/components/projects/pm-wizard-common-steps.js';
import type { WizardState } from '../../../web/src/components/projects/pm-wizard-state.js';

function makeState(overrides: Partial<WizardState>): WizardState {
	return {
		provider: 'trello',
		trelloApiKey: '',
		trelloToken: '',
		trelloApiSecret: '',
		trelloBoardId: '',
		trelloOrgId: '',
		trelloLists: {},
		trelloLabels: {},
		trelloCostField: null,
		jiraEmail: '',
		jiraApiToken: '',
		jiraBaseUrl: '',
		jiraProjectId: '',
		jiraProjectKey: '',
		jiraStatuses: {},
		jiraLabels: {},
		jiraCostField: null,
		linearApiKey: '',
		linearTeamId: '',
		linearStatuses: {},
		linearLabels: {},
		isEditing: false,
		verifyStatus: 'idle',
		verifyMessage: null,
		verifiedLogin: null,
		availableBoards: [],
		availableOrgs: [],
		availableProjects: [],
		availableTeams: [],
		availableLists: [],
		availableStatuses: [],
		availableLabels: [],
		availableTrelloCustomFields: [],
		availableJiraCustomFields: [],
		trelloLabelColors: {},
		...overrides,
	} as unknown as WizardState;
}

const baseMutations = {
	createWebhookMutation: {
		mutate: () => {},
		isPending: false,
		isError: false,
		isSuccess: false,
		error: null,
	},
	deleteWebhookMutation: {
		mutate: () => {},
		isPending: false,
		isError: false,
	},
} as unknown as {
	createWebhookMutation: Parameters<typeof WebhookStep>[0]['createWebhookMutation'];
	deleteWebhookMutation: Parameters<typeof WebhookStep>[0]['deleteWebhookMutation'];
};

const baseProps = {
	webhooksQuery: { isLoading: false, data: undefined, refetch: () => {} },
	activeWebhooks: [],
	callbackBaseUrl: 'https://dev.api.ca.sca.de.com',
	linearWebhookUrl: 'https://dev.api.ca.sca.de.com/linear/webhook',
	projectId: 'test-project',
	...baseMutations,
} as const;

function render(extra: Partial<Parameters<typeof WebhookStep>[0]>) {
	return renderToStaticMarkup(
		createElement(WebhookStep, {
			...baseProps,
			...extra,
		} as Parameters<typeof WebhookStep>[0]),
	);
}

describe('WebhookStep — Linear credential threading', () => {
	it('renders the LINEAR_WEBHOOK_SECRET field when state.provider is linear', () => {
		const html = render({
			state: makeState({ provider: 'linear' }),
		});
		expect(html).toContain('data-envvarkey="LINEAR_WEBHOOK_SECRET"');
		expect(html).toContain('Webhook Signing Secret (optional)');
	});

	it('surfaces the masked credential value when one is threaded through', () => {
		const html = render({
			state: makeState({ provider: 'linear' }),
			linearWebhookSecretCredential: {
				envVarKey: 'LINEAR_WEBHOOK_SECRET',
				name: 'Webhook Signing Secret (optional)',
				isConfigured: true,
				maskedValue: '...abcd',
			},
		});
		expect(html).toContain('...abcd');
	});

	it('renders the three-item events list on the Linear step', () => {
		const html = render({ state: makeState({ provider: 'linear' }) });
		expect(html).toMatch(/<strong>Issues<\/strong>/);
		expect(html).toMatch(/<strong>Comments<\/strong>/);
		expect(html).toMatch(/<strong>Issue Labels<\/strong>/);
	});
});

describe('WebhookStep — Trello non-regression', () => {
	it('does not render the Linear secret field for Trello', () => {
		const html = render({ state: makeState({ provider: 'trello' }) });
		expect(html).not.toContain('LINEAR_WEBHOOK_SECRET');
		expect(html).not.toContain('Webhook Signing Secret');
	});

	it('still renders the Trello curl command block', () => {
		const html = render({
			state: makeState({ provider: 'trello', trelloBoardId: 'b1' }),
		});
		expect(html).toContain('curl -X POST');
		expect(html).toContain('api.trello.com');
	});

	it('still renders the Create Webhook button', () => {
		const html = render({ state: makeState({ provider: 'trello' }) });
		expect(html).toContain('Create Webhook');
	});
});

describe('WebhookStep — JIRA non-regression', () => {
	it('does not render the Linear secret field for JIRA', () => {
		const html = render({ state: makeState({ provider: 'jira' }) });
		expect(html).not.toContain('LINEAR_WEBHOOK_SECRET');
		expect(html).not.toContain('Webhook Signing Secret');
	});

	it('still renders the JIRA curl command block', () => {
		const html = render({
			state: makeState({ provider: 'jira', jiraBaseUrl: 'https://example.atlassian.net' }),
		});
		expect(html).toContain('curl -X POST');
		expect(html).toContain('/rest/webhooks/1.0/webhook');
	});
});
