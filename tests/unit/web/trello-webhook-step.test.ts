/**
 * Tests for TrelloWebhookAdapter (plan 012/1).
 *
 * The Trello-provider webhook step adapter. Fragment composing the shared
 * WebhookUrlDisplayStep + Trello-specific UX: active-webhooks list,
 * programmatic "Create Webhook" button, per-webhook delete buttons, curl
 * fallback template with trelloBoardId interpolated.
 *
 * Every tRPC call (webhooks.list/create/delete with trelloOnly flag) goes
 * through providerHooks; these tests pin the adapter rendering and wiring,
 * not the tRPC layer.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TrelloWebhookAdapter } from '../../../web/src/components/projects/pm-providers/trello/webhook-step.js';
import type { WizardState } from '../../../web/src/components/projects/pm-wizard-state.js';

function makeState(overrides: Partial<WizardState> = {}): WizardState {
	return {
		trelloBoardId: '',
		...overrides,
	} as WizardState;
}

function makeProviderHooks(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		webhookUrl: 'https://router.example.com/trello/webhook',
		callbackBaseUrl: 'https://router.example.com',
		activeTrelloWebhooks: [],
		webhooksLoading: false,
		createTrelloWebhook: () => {},
		createLoading: false,
		createError: undefined,
		deleteTrelloWebhook: (_id: string) => {},
		deleteLoading: false,
		...overrides,
	};
}

describe('TrelloWebhookAdapter', () => {
	it('renders the shared WebhookUrlDisplayStep (URL + copy button)', () => {
		const html = renderToStaticMarkup(
			createElement(TrelloWebhookAdapter, {
				state: makeState(),
				dispatch: () => {},
				providerHooks: makeProviderHooks(),
			}),
		);
		expect(html).toContain('data-step-component="webhook-url-display"');
		expect(html).toContain('https://router.example.com/trello/webhook');
	});

	it('renders active-webhooks list when provided', () => {
		const html = renderToStaticMarkup(
			createElement(TrelloWebhookAdapter, {
				state: makeState(),
				dispatch: () => {},
				providerHooks: makeProviderHooks({
					activeTrelloWebhooks: [
						{ id: 'wh-1', url: 'https://router.example.com/trello/webhook', active: true },
						{ id: 'wh-2', url: 'https://other.example.com/trello/webhook', active: false },
					],
				}),
			}),
		);
		expect(html).toContain('https://router.example.com/trello/webhook');
		expect(html).toContain('https://other.example.com/trello/webhook');
	});

	it('renders a "No Trello webhooks configured" fallback when active list is empty', () => {
		const html = renderToStaticMarkup(
			createElement(TrelloWebhookAdapter, {
				state: makeState(),
				dispatch: () => {},
				providerHooks: makeProviderHooks({ activeTrelloWebhooks: [] }),
			}),
		);
		expect(html).toContain('No Trello webhooks configured');
	});

	it('renders the Create Webhook button with data-action="create-webhook"', () => {
		const html = renderToStaticMarkup(
			createElement(TrelloWebhookAdapter, {
				state: makeState(),
				dispatch: () => {},
				providerHooks: makeProviderHooks(),
			}),
		);
		expect(html).toContain('data-action="create-webhook"');
	});

	it('disables the Create button when callbackBaseUrl is empty', () => {
		const html = renderToStaticMarkup(
			createElement(TrelloWebhookAdapter, {
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
			createElement(TrelloWebhookAdapter, {
				state: makeState(),
				dispatch: () => {},
				providerHooks: makeProviderHooks({ callbackBaseUrl: 'https://router.example.com' }),
			}),
		);
		const buttonTag = html.match(/<button[^>]*data-action="create-webhook"[^>]*>/)?.[0];
		expect(buttonTag).toBeDefined();
		expect(buttonTag).not.toMatch(/\sdisabled=""/);
	});

	it('interpolates trelloBoardId into the curl fallback template', () => {
		const html = renderToStaticMarkup(
			createElement(TrelloWebhookAdapter, {
				state: makeState({ trelloBoardId: 'board-xyz' }),
				dispatch: () => {},
				providerHooks: makeProviderHooks(),
			}),
		);
		expect(html).toContain('&quot;idModel&quot;: &quot;board-xyz&quot;');
	});

	it('falls back to <YOUR_BOARD_ID> placeholder when trelloBoardId is empty', () => {
		const html = renderToStaticMarkup(
			createElement(TrelloWebhookAdapter, {
				state: makeState({ trelloBoardId: '' }),
				dispatch: () => {},
				providerHooks: makeProviderHooks(),
			}),
		);
		expect(html).toContain('YOUR_BOARD_ID');
	});

	it('renders delete buttons with data-action="delete-webhook" per active webhook', () => {
		const html = renderToStaticMarkup(
			createElement(TrelloWebhookAdapter, {
				state: makeState(),
				dispatch: () => {},
				providerHooks: makeProviderHooks({
					activeTrelloWebhooks: [
						{ id: 'wh-1', url: 'https://router.example.com/trello/webhook', active: true },
						{ id: 'wh-2', url: 'https://other.example.com/trello/webhook', active: false },
					],
				}),
			}),
		);
		const deleteButtons = html.match(/data-action="delete-webhook"/g) ?? [];
		expect(deleteButtons.length).toBe(2);
	});

	it('does not render Linear signing-secret field (regression guard)', () => {
		const html = renderToStaticMarkup(
			createElement(TrelloWebhookAdapter, {
				state: makeState(),
				dispatch: () => {},
				providerHooks: makeProviderHooks(),
			}),
		);
		expect(html).not.toMatch(/data-role="webhook_secret"/);
		expect(html).not.toContain('LINEAR_WEBHOOK_SECRET');
	});
});
