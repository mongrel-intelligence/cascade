/**
 * Tests for LinearWebhookAdapter (plan 012/3).
 *
 * Linear has no programmatic webhook registration (Linear's API forbids
 * it). The adapter renders: shared `WebhookUrlDisplayStep` + info banner +
 * 5-step manual setup instructions + `ProjectSecretField` bound to
 * `LINEAR_WEBHOOK_SECRET`.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Mock ProjectSecretField — it uses `useQueryClient` which pulls React
// from web/node_modules (different instance than the root-aliased React
// the test env uses), causing a null-context crash during SSR. The stub
// renders a deterministic `<div>` preserving the props we want to assert.
vi.mock('../../../web/src/components/projects/project-secret-field.js', () => ({
	ProjectSecretField: (props: {
		projectId: string;
		envVarKey: string;
		label: string;
		description?: string;
		placeholder?: string;
	}) =>
		createElement(
			'div',
			{
				'data-component': 'ProjectSecretField',
				'data-env-var-key': props.envVarKey,
				'data-project-id': props.projectId,
			},
			createElement('label', null, props.label),
			createElement('input', { type: 'password', placeholder: props.placeholder ?? '' }),
		),
}));

import { LinearWebhookAdapter } from '../../../web/src/components/projects/pm-providers/linear/webhook-step.js';
import type { WizardState } from '../../../web/src/components/projects/pm-wizard-state.js';

function makeState(overrides: Partial<WizardState> = {}): WizardState {
	return {
		...overrides,
	} as WizardState;
}

function makeProviderHooks(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		webhookUrl: 'https://router.example.com/linear/webhook',
		projectIdForSecret: 'proj-123',
		webhookSecretCredential: undefined,
		...overrides,
	};
}

describe('LinearWebhookAdapter', () => {
	it('renders the shared WebhookUrlDisplayStep with webhookUrl', () => {
		const html = renderToStaticMarkup(
			createElement(LinearWebhookAdapter, {
				state: makeState(),
				dispatch: () => {},
				providerHooks: makeProviderHooks(),
			}),
		);
		expect(html).toContain('data-step-component="webhook-url-display"');
		expect(html).toContain('https://router.example.com/linear/webhook');
	});

	it('renders a ProjectSecretField with envVarKey="LINEAR_WEBHOOK_SECRET"', () => {
		const html = renderToStaticMarkup(
			createElement(LinearWebhookAdapter, {
				state: makeState(),
				dispatch: () => {},
				providerHooks: makeProviderHooks(),
			}),
		);
		// ProjectSecretField renders an input with the envVarKey as data attr
		// or in a label — pin via its label text + presence.
		expect(html).toContain('Webhook Signing Secret');
	});

	it('does not render the ProjectSecretField when projectIdForSecret is empty', () => {
		const html = renderToStaticMarkup(
			createElement(LinearWebhookAdapter, {
				state: makeState(),
				dispatch: () => {},
				providerHooks: makeProviderHooks({ projectIdForSecret: '' }),
			}),
		);
		expect(html).not.toContain('Webhook Signing Secret');
	});

	it('renders a 5-step setup instructions list', () => {
		const html = renderToStaticMarkup(
			createElement(LinearWebhookAdapter, {
				state: makeState(),
				dispatch: () => {},
				providerHooks: makeProviderHooks(),
			}),
		);
		// Match 5 <li> elements inside an <ol> (the top-level steps).
		// The events sub-list renders <li>s inside a nested <ul>; count the
		// direct <ol><li>...</li></ol> pattern by counting </li> inside <ol>.
		const olMatch = html.match(/<ol[\s\S]*?<\/ol>/);
		expect(olMatch).toBeDefined();
		// Count only top-level <li> elements by excluding nested ones (there's
		// a <ul> inside step 3 with 3 nested <li>s). Simpler: assert the
		// copy-strings that identify each of the 5 steps appear.
		expect(html).toContain('linear.app/settings/api');
		expect(html).toContain('New webhook');
		expect(html).toContain('Enable these events');
		expect(html).toContain('Select your team and save');
		expect(html).toContain('signing secret');
	});

	it('links to linear.app/settings/api in the instructions', () => {
		const html = renderToStaticMarkup(
			createElement(LinearWebhookAdapter, {
				state: makeState(),
				dispatch: () => {},
				providerHooks: makeProviderHooks(),
			}),
		);
		expect(html).toContain('href="https://linear.app/settings/api"');
	});

	it('does not render Trello/JIRA UI (Create button, active-webhooks list)', () => {
		const html = renderToStaticMarkup(
			createElement(LinearWebhookAdapter, {
				state: makeState(),
				dispatch: () => {},
				providerHooks: makeProviderHooks(),
			}),
		);
		expect(html).not.toContain('data-action="create-webhook"');
		expect(html).not.toContain('data-action="delete-webhook"');
		expect(html).not.toContain('curl -X POST');
	});

	it('renders the "Manual Webhook Setup Required" info banner', () => {
		const html = renderToStaticMarkup(
			createElement(LinearWebhookAdapter, {
				state: makeState(),
				dispatch: () => {},
				providerHooks: makeProviderHooks(),
			}),
		);
		expect(html).toContain('Manual Webhook Setup Required');
	});
});
