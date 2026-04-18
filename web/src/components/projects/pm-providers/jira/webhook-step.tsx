/**
 * JIRA webhook step adapter (plan 012/2; styling restored post-spec-012
 * follow-up).
 *
 * Fragment composing the shared `WebhookUrlDisplayStep` (URL + copy) with
 * JIRA-specific UX: active-webhooks list, programmatic "Create Webhook"
 * button, delete buttons, curl fallback.
 *
 * The `jiraEnsureLabels` side-effect (adds + removes CASCADE labels to
 * seed autocomplete on first webhook creation) runs server-side inside
 * `webhooks.create({ jiraOnly: true })`. No frontend change needed to
 * preserve it.
 */

import { Loader2, Trash2 } from 'lucide-react';
import { createElement, Fragment, type ReactElement } from 'react';
import { Button } from '@/components/ui/button.js';
import { CopyButton } from '@/components/ui/copy-button.js';
import type { DataProps } from '@/lib/data-props.js';
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
	const curlCommand = buildJiraCurl(state.jiraBaseUrl ?? '', h.callbackBaseUrl);

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
			{
				className: 'space-y-2',
				'data-section': 'active-webhooks',
			},
			h.webhooksLoading
				? createElement(
						'p',
						{
							'data-state': 'loading',
							className: 'flex items-center gap-2 text-sm text-muted-foreground',
						},
						createElement(Loader2, { className: 'h-4 w-4 animate-spin' }),
						'Loading webhooks…',
					)
				: h.activeJiraWebhooks.length === 0
					? createElement(
							'p',
							{ className: 'text-sm text-amber-600 dark:text-amber-400' },
							'No JIRA webhooks configured for this project.',
						)
					: createElement(
							'ul',
							{ className: 'space-y-1' },
							...h.activeJiraWebhooks.map((wh) =>
								createElement(
									'li',
									{
										key: wh.id,
										className: 'flex items-center justify-between rounded-md border px-3 py-2',
										'data-webhook-id': wh.id,
									},
									createElement(
										'div',
										{ className: 'flex items-center gap-2 text-sm' },
										createElement('span', {
											className: `inline-block h-2 w-2 rounded-full ${wh.active ? 'bg-green-500 dark:bg-green-400' : 'bg-amber-500 dark:bg-amber-400'}`,
											'data-active': wh.active ? 'true' : 'false',
										}),
										createElement('code', { className: 'font-mono text-xs break-all' }, wh.url),
									),
									createElement(
										Button,
										{
											type: 'button',
											variant: 'ghost',
											size: 'icon-sm',
											'data-action': 'delete-webhook',
											'data-webhook-id': wh.id,
											disabled: h.deleteLoading,
											onClick: () => {
												const base = wh.url.replace(/\/jira\/webhook$/, '');
												h.deleteJiraWebhook(base);
											},
											title: 'Delete webhook',
										} as React.ComponentProps<typeof Button> & DataProps,
										createElement(Trash2, { className: 'h-4 w-4' }),
									),
								),
							),
						),
		),

		// Create button.
		createElement(
			'div',
			{ className: 'space-y-2' },
			createElement(
				Button,
				{
					type: 'button',
					variant: 'default',
					'data-action': 'create-webhook',
					disabled: createDisabled,
					onClick: () => h.createJiraWebhook(),
				} as React.ComponentProps<typeof Button> & DataProps,
				h.createLoading ? createElement(Loader2, { className: 'h-4 w-4 animate-spin' }) : null,
				h.createLoading ? 'Creating…' : 'Create Webhook',
			),
			h.createError
				? createElement(
						'p',
						{ className: 'text-sm text-destructive', 'data-state': 'error' },
						h.createError,
					)
				: null,
		),

		// Curl fallback.
		createElement(
			'details',
			{
				className:
					'rounded-md border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-900/50 dark:bg-blue-900/20',
			},
			createElement(
				'summary',
				{
					className:
						'cursor-pointer select-none text-xs text-blue-700 dark:text-blue-300 font-medium',
				},
				"Manual webhook creation (alternative: if the button above doesn't work)",
			),
			createElement(
				'div',
				{ className: 'mt-2 relative rounded-md bg-muted border' },
				createElement(
					'div',
					{ className: 'absolute top-2 right-2' },
					createElement(CopyButton, { text: curlCommand }),
				),
				createElement(
					'pre',
					{
						className: 'text-xs font-mono whitespace-pre-wrap break-all p-3 pr-16 overflow-x-auto',
					},
					curlCommand,
				),
			),
		),
	);
}
