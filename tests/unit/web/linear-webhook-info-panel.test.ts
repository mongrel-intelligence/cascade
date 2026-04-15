/**
 * Unit tests for LinearWebhookInfoPanel — Node SSR via react-dom/server.
 *
 * `web/` ships no jsdom + testing-library. These tests render the component
 * to a static HTML string and assert copy/structure against that string.
 * Interactive behavior (submit, mutation invocation) is out of scope — see
 * the plan-divergence note in docs/plans/002-linear-webhook-setup-ux/2-*.md.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// ProjectSecretField pulls in React Query + tRPC client. For copy/structure
// assertions we only need to know it was rendered with the expected props.
vi.mock('../../../web/src/components/projects/project-secret-field.js', () => ({
	ProjectSecretField: ({
		projectId,
		envVarKey,
		label,
		placeholder,
		credential,
	}: {
		projectId: string;
		envVarKey: string;
		label: string;
		placeholder?: string;
		credential?: { isConfigured: boolean; maskedValue: string };
	}) =>
		createElement(
			'div',
			{
				'data-testid': 'project-secret-field',
				'data-envvarkey': envVarKey,
				'data-projectid': projectId,
			},
			createElement('label', null, label),
			createElement('input', { placeholder, type: 'password' }),
			credential?.isConfigured
				? createElement('span', null, credential.maskedValue)
				: createElement('span', null, 'not configured'),
		),
}));

import { LinearWebhookInfoPanel } from '../../../web/src/components/projects/pm-wizard-common-steps.js';

function render(props: Parameters<typeof LinearWebhookInfoPanel>[0]): string {
	return renderToStaticMarkup(createElement(LinearWebhookInfoPanel, props));
}

const baseProps = {
	webhookUrl: 'https://dev.api.ca.sca.de.com/linear/webhook',
	projectId: 'test-project',
	webhookSecretCredential: undefined,
} as const;

describe('LinearWebhookInfoPanel — events list', () => {
	it('renders a three-item events list: Issues, Comments, Issue Labels', () => {
		const html = render(baseProps);
		expect(html).toMatch(/<strong>Issues<\/strong>/);
		expect(html).toMatch(/<strong>Comments<\/strong>/);
		expect(html).toMatch(/<strong>Issue Labels<\/strong>/);
	});

	it('each events-list item has a rationale tracing back to a registered trigger', () => {
		const html = render(baseProps);
		expect(html.toLowerCase()).toContain('status transitions');
		expect(html.toLowerCase()).toMatch(/mention/);
		expect(html).toContain('Ready to Process');
	});

	it('does not mention event families CASCADE does not consume', () => {
		const html = render(baseProps);
		for (const forbidden of [
			'Documents',
			'Emoji reactions',
			'Customer requests',
			'Cycles',
			'Users',
			'Initiatives',
			'Project updates',
			'Projects',
			'Issue SLA',
			'Issue attachments',
		]) {
			expect(html).not.toContain(forbidden);
		}
	});

	it('preserves the manual-setup-required blue info block', () => {
		const html = render(baseProps);
		expect(html).toContain('Manual Webhook Setup Required');
	});

	it('drops the deprecated "store as LINEAR_WEBHOOK_SECRET in project credentials" bullet', () => {
		const html = render(baseProps);
		expect(html).not.toContain('in project credentials');
	});

	it('still shows the webhook URL and copy affordance', () => {
		const html = render(baseProps);
		expect(html).toContain('https://dev.api.ca.sca.de.com/linear/webhook');
	});
});

describe('LinearWebhookInfoPanel — inline signing-secret field', () => {
	it('renders a signing-secret input labelled "Webhook Signing Secret (optional)" with a lin_wh placeholder', () => {
		const html = render(baseProps);
		expect(html).toContain('Webhook Signing Secret (optional)');
		expect(html).toMatch(/placeholder="lin_wh_/);
	});

	it('shows masked-configured state when the LINEAR_WEBHOOK_SECRET credential is already set', () => {
		const html = render({
			...baseProps,
			webhookSecretCredential: {
				envVarKey: 'LINEAR_WEBHOOK_SECRET',
				name: 'Webhook Signing Secret (optional)',
				isConfigured: true,
				maskedValue: '...abcd',
			},
		});
		expect(html).toContain('...abcd');
	});

	it('shows "not configured" indicator when no credential is present', () => {
		const html = render(baseProps);
		expect(html).toContain('not configured');
	});
});
