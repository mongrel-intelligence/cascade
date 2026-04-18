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
});
