/**
 * Tests for the shared WebhookUrlDisplayStep (plan 010/3 task 1).
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StandardStep } from '../../../../src/integrations/pm/manifest.js';
import { WebhookUrlDisplayStep } from '../../../../web/src/components/projects/pm-providers/steps/webhook-url-display.js';

const step: StandardStep = { kind: 'webhook-url-display', id: 'wh' };

describe('WebhookUrlDisplayStep', () => {
	it('displays the webhook URL inside a <code> element', () => {
		const html = renderToStaticMarkup(
			createElement(WebhookUrlDisplayStep, {
				step,
				providerId: 'trello',
				webhookUrl: 'https://router.example.com/trello/webhook',
			}),
		);
		expect(html).toContain('<code>https://router.example.com/trello/webhook</code>');
		expect(html).toContain('data-url="https://router.example.com/trello/webhook"');
	});

	it('renders a copy-to-clipboard button', () => {
		const html = renderToStaticMarkup(
			createElement(WebhookUrlDisplayStep, {
				step,
				providerId: 'trello',
				webhookUrl: 'https://example.com/webhook',
			}),
		);
		expect(html).toContain('data-action="copy-webhook-url"');
		expect(html).toContain('Copy');
	});

	it('shows provider-specific instructions from step.config', () => {
		const withInstructions: StandardStep = {
			kind: 'webhook-url-display',
			id: 'wh',
			config: { instructions: 'Add this URL under Trello > Power-Ups > Webhooks.' },
		};
		const html = renderToStaticMarkup(
			createElement(WebhookUrlDisplayStep, {
				step: withInstructions,
				providerId: 'trello',
				webhookUrl: 'https://example.com/webhook',
			}),
		);
		expect(html).toContain('Add this URL under Trello');
	});

	it('falls back to the instructions prop when step.config is missing', () => {
		const html = renderToStaticMarkup(
			createElement(WebhookUrlDisplayStep, {
				step,
				providerId: 'linear',
				webhookUrl: 'https://example.com/webhook',
				instructions: 'Fallback instructions',
			}),
		);
		expect(html).toContain('Fallback instructions');
	});

	// ── Plan 011/1: optional inline signing-secret input ───────────────

	it('does not render a secret input when secretFieldRole is omitted (backward compat)', () => {
		const html = renderToStaticMarkup(
			createElement(WebhookUrlDisplayStep, {
				step,
				providerId: 'linear',
				webhookUrl: 'https://example.com/webhook',
			}),
		);
		expect(html).not.toMatch(/<input[^>]*type="password"/);
	});

	it('renders a password input with data-role when secretFieldRole + onSecretChange are supplied', () => {
		const html = renderToStaticMarkup(
			createElement(WebhookUrlDisplayStep, {
				step,
				providerId: 'linear',
				webhookUrl: 'https://example.com/webhook',
				secretFieldRole: 'webhook_secret',
				secretValue: 'shh',
				onSecretChange: () => {},
			}),
		);
		expect(html).toMatch(/<input[^>]*type="password"/);
		expect(html).toContain('data-role="webhook_secret"');
		expect(html).toContain('value="shh"');
	});

	it('uses secretLabel prop for the field label; falls back to secretFieldRole when absent', () => {
		const withLabel = renderToStaticMarkup(
			createElement(WebhookUrlDisplayStep, {
				step,
				providerId: 'linear',
				webhookUrl: 'https://example.com/webhook',
				secretFieldRole: 'webhook_secret',
				secretLabel: 'Signing secret',
				secretValue: '',
				onSecretChange: () => {},
			}),
		);
		expect(withLabel).toContain('Signing secret');

		const withoutLabel = renderToStaticMarkup(
			createElement(WebhookUrlDisplayStep, {
				step,
				providerId: 'linear',
				webhookUrl: 'https://example.com/webhook',
				secretFieldRole: 'webhook_secret',
				secretValue: '',
				onSecretChange: () => {},
			}),
		);
		expect(withoutLabel).toContain('webhook_secret');
	});

	it('omits the secret input defensively when secretFieldRole is present but onSecretChange is not', () => {
		const html = renderToStaticMarkup(
			createElement(WebhookUrlDisplayStep, {
				step,
				providerId: 'linear',
				webhookUrl: 'https://example.com/webhook',
				secretFieldRole: 'webhook_secret',
				// onSecretChange intentionally omitted
			}),
		);
		expect(html).not.toMatch(/<input[^>]*type="password"/);
	});
});
