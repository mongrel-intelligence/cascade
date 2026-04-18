/**
 * Tests for JiraWebhookAdapter (plan 012/2).
 *
 * JIRA-provider webhook step adapter. Fragment composing shared
 * `WebhookUrlDisplayStep` + JIRA-specific UX: active-webhooks list,
 * programmatic "Create Webhook" button (wired to webhooks.create with
 * jiraOnly: true — the backend-side `jiraEnsureLabels` side-effect
 * fires there unchanged), delete buttons, curl fallback template.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JiraWebhookAdapter } from '../../../web/src/components/projects/pm-providers/jira/webhook-step.js';
import type { WizardState } from '../../../web/src/components/projects/pm-wizard-state.js';

function makeState(overrides: Partial<WizardState> = {}): WizardState {
	return {
		jiraBaseUrl: '',
		...overrides,
	} as WizardState;
}

function makeProviderHooks(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		webhookUrl: 'https://router.example.com/jira/webhook',
		callbackBaseUrl: 'https://router.example.com',
		activeJiraWebhooks: [],
		webhooksLoading: false,
		createJiraWebhook: () => {},
		createLoading: false,
		createError: undefined,
		deleteJiraWebhook: (_id: string) => {},
		deleteLoading: false,
		...overrides,
	};
}

describe('JiraWebhookAdapter', () => {
	it('renders the shared WebhookUrlDisplayStep (URL + copy button)', () => {
		const html = renderToStaticMarkup(
			createElement(JiraWebhookAdapter, {
				state: makeState(),
				dispatch: () => {},
				providerHooks: makeProviderHooks(),
			}),
		);
		expect(html).toContain('data-step-component="webhook-url-display"');
		expect(html).toContain('https://router.example.com/jira/webhook');
	});

	it('renders active-webhooks list when provided', () => {
		const html = renderToStaticMarkup(
			createElement(JiraWebhookAdapter, {
				state: makeState(),
				dispatch: () => {},
				providerHooks: makeProviderHooks({
					activeJiraWebhooks: [
						{ id: 'wh-1', url: 'https://router.example.com/jira/webhook', active: true },
						{ id: 'wh-2', url: 'https://other.example.com/jira/webhook', active: false },
					],
				}),
			}),
		);
		expect(html).toContain('https://router.example.com/jira/webhook');
		expect(html).toContain('https://other.example.com/jira/webhook');
	});

	it('renders a "No JIRA webhooks configured" fallback when active list is empty', () => {
		const html = renderToStaticMarkup(
			createElement(JiraWebhookAdapter, {
				state: makeState(),
				dispatch: () => {},
				providerHooks: makeProviderHooks({ activeJiraWebhooks: [] }),
			}),
		);
		expect(html).toContain('No JIRA webhooks configured');
	});

	it('renders the Create Webhook button with data-action="create-webhook"', () => {
		const html = renderToStaticMarkup(
			createElement(JiraWebhookAdapter, {
				state: makeState(),
				dispatch: () => {},
				providerHooks: makeProviderHooks(),
			}),
		);
		expect(html).toContain('data-action="create-webhook"');
	});

	it('disables the Create button when callbackBaseUrl is empty', () => {
		const html = renderToStaticMarkup(
			createElement(JiraWebhookAdapter, {
				state: makeState(),
				dispatch: () => {},
				providerHooks: makeProviderHooks({ callbackBaseUrl: '' }),
			}),
		);
		const buttonTag = html.match(/<button[^>]*data-action="create-webhook"[^>]*>/)?.[0];
		expect(buttonTag).toBeDefined();
		expect(buttonTag).toMatch(/\sdisabled=""/);
	});

	it('enables the Create button when callbackBaseUrl is populated', () => {
		const html = renderToStaticMarkup(
			createElement(JiraWebhookAdapter, {
				state: makeState(),
				dispatch: () => {},
				providerHooks: makeProviderHooks({ callbackBaseUrl: 'https://router.example.com' }),
			}),
		);
		const buttonTag = html.match(/<button[^>]*data-action="create-webhook"[^>]*>/)?.[0];
		expect(buttonTag).toBeDefined();
		expect(buttonTag).not.toMatch(/\sdisabled=""/);
	});

	it('interpolates jiraBaseUrl into the curl fallback template', () => {
		const html = renderToStaticMarkup(
			createElement(JiraWebhookAdapter, {
				state: makeState({ jiraBaseUrl: 'https://acme.atlassian.net' }),
				dispatch: () => {},
				providerHooks: makeProviderHooks(),
			}),
		);
		expect(html).toContain('https://acme.atlassian.net/rest/webhooks/1.0/webhook');
	});

	it('falls back to <YOUR_JIRA_BASE_URL> placeholder when jiraBaseUrl is empty', () => {
		const html = renderToStaticMarkup(
			createElement(JiraWebhookAdapter, {
				state: makeState({ jiraBaseUrl: '' }),
				dispatch: () => {},
				providerHooks: makeProviderHooks(),
			}),
		);
		expect(html).toContain('YOUR_JIRA_BASE_URL');
	});

	it('renders delete buttons with data-action="delete-webhook" per active webhook', () => {
		const html = renderToStaticMarkup(
			createElement(JiraWebhookAdapter, {
				state: makeState(),
				dispatch: () => {},
				providerHooks: makeProviderHooks({
					activeJiraWebhooks: [
						{ id: 'wh-1', url: 'https://router.example.com/jira/webhook', active: true },
						{ id: 'wh-2', url: 'https://other.example.com/jira/webhook', active: false },
					],
				}),
			}),
		);
		const deleteButtons = html.match(/data-action="delete-webhook"/g) ?? [];
		expect(deleteButtons.length).toBe(2);
	});

	it('does not render Linear signing-secret field (regression guard)', () => {
		const html = renderToStaticMarkup(
			createElement(JiraWebhookAdapter, {
				state: makeState(),
				dispatch: () => {},
				providerHooks: makeProviderHooks(),
			}),
		);
		expect(html).not.toMatch(/data-role="webhook_secret"/);
		expect(html).not.toContain('LINEAR_WEBHOOK_SECRET');
	});
});
