/**
 * JIRA webhook step adapter (plan 012/2).
 *
 * Replaces the JIRA branch of the legacy `WebhookStep` (plan 012/4
 * deletes that). Fragment composing the shared `WebhookUrlDisplayStep`
 * (URL + copy) with JIRA-specific UX: active-webhooks list,
 * programmatic "Create Webhook" button, delete buttons, curl fallback.
 *
 * The `jiraEnsureLabels` side-effect (adds + removes CASCADE labels to
 * seed autocomplete on first webhook creation) runs server-side inside
 * `webhooks.create({ jiraOnly: true })`. No frontend change needed to
 * preserve it.
 */

import { createElement, Fragment, type ReactElement } from 'react';
import { WebhookUrlDisplayStep } from '../steps/webhook-url-display.js';
import type { ProviderWizardStepProps } from '../types.js';

interface ActiveWebhook {
	readonly id: string;
	readonly url: string;
	readonly active: boolean;
}

interface JiraWebhookProviderHooks {
	readonly webhookUrl: string;
	readonly callbackBaseUrl: string;
	readonly activeJiraWebhooks: ReadonlyArray<ActiveWebhook>;
	readonly webhooksLoading: boolean;
	readonly createJiraWebhook: () => void;
	readonly createLoading: boolean;
	readonly createError: string | undefined;
	readonly deleteJiraWebhook: (callbackBaseUrl: string) => void;
	readonly deleteLoading: boolean;
}

function asJiraWebhookHooks(
	providerHooks: Record<string, unknown> | undefined,
): JiraWebhookProviderHooks {
	return (providerHooks ?? {}) as unknown as JiraWebhookProviderHooks;
}

// Legacy endpoint path preserved (v1) — matches what operators currently
// copy-paste. JIRA v3 `/rest/api/3/webhook` has a different payload shape
// and changing it would require a coordinated docs update. Out of scope.
function buildJiraCurl(baseUrl: string, callbackBaseUrl: string): string {
	const effectiveBaseUrl = baseUrl || '<YOUR_JIRA_BASE_URL>';
	const callbackUrl = callbackBaseUrl
		? `${callbackBaseUrl}/jira/webhook`
		: '<YOUR_CALLBACK_URL>/jira/webhook';
	return `curl -X POST "${effectiveBaseUrl}/rest/webhooks/1.0/webhook" \\
  -H "Content-Type: application/json" \\
  -u "<YOUR_JIRA_EMAIL>:<YOUR_JIRA_API_TOKEN>" \\
  -d '{
    "name": "CASCADE webhook",
    "url": "${callbackUrl}",
    "events": ["jira:issue_updated", "jira:issue_created"],
    "filters": {},
    "excludeBody": false
  }'`;
}

export function JiraWebhookAdapter({
	state,
	providerHooks,
}: ProviderWizardStepProps): ReactElement {
	const h = asJiraWebhookHooks(providerHooks);
	const createDisabled = !h.callbackBaseUrl || h.createLoading;

	return createElement(
		Fragment,
		null,
		// Shared URL display + copy button.
		WebhookUrlDisplayStep({
			step: {
				kind: 'webhook-url-display',
				id: 'jira-webhook',
				config: {
					instructions:
						'Click "Create Webhook" below to register automatically, or use the curl command for manual setup.',
				},
			},
			providerId: 'jira',
			webhookUrl: h.webhookUrl,
		}),

		// Active-webhooks list.
		createElement(
			'div',
			{ className: 'pm-wizard-webhook-active-list', 'data-section': 'active-webhooks' },
			h.webhooksLoading
				? createElement('p', { 'data-state': 'loading' }, 'Loading webhooks…')
				: h.activeJiraWebhooks.length === 0
					? createElement(
							'p',
							{ className: 'pm-wizard-webhook-empty' },
							'No JIRA webhooks configured for this project.',
						)
					: createElement(
							'ul',
							{ className: 'pm-wizard-webhook-list' },
							...h.activeJiraWebhooks.map((wh) =>
								createElement(
									'li',
									{ key: wh.id, className: 'pm-wizard-webhook-row', 'data-webhook-id': wh.id },
									createElement(
										'span',
										{
											className: 'pm-wizard-webhook-status',
											'data-active': wh.active ? 'true' : 'false',
										},
										wh.active ? '●' : '○',
									),
									createElement('code', { className: 'pm-wizard-webhook-url' }, wh.url),
									createElement(
										'button',
										{
											type: 'button',
											'data-action': 'delete-webhook',
											'data-webhook-id': wh.id,
											disabled: h.deleteLoading,
											onClick: () => {
												const base = wh.url.replace(/\/jira\/webhook$/, '');
												h.deleteJiraWebhook(base);
											},
										},
										'Delete',
									),
								),
							),
						),
		),

		// Create button.
		createElement(
			'div',
			{ className: 'pm-wizard-webhook-create' },
			createElement(
				'button',
				{
					type: 'button',
					'data-action': 'create-webhook',
					disabled: createDisabled,
					onClick: () => h.createJiraWebhook(),
				},
				h.createLoading ? 'Creating…' : 'Create Webhook',
			),
			h.createError
				? createElement(
						'p',
						{ className: 'pm-wizard-webhook-error', 'data-state': 'error' },
						h.createError,
					)
				: null,
		),

		// Curl fallback.
		createElement(
			'details',
			{ className: 'pm-wizard-webhook-curl' },
			createElement(
				'summary',
				null,
				'Manual webhook creation (alternative: if the button above doesn\u0027t work)',
			),
			createElement(
				'pre',
				{ className: 'pm-wizard-webhook-curl-command' },
				buildJiraCurl(state.jiraBaseUrl ?? '', h.callbackBaseUrl),
			),
		),
	);
}
