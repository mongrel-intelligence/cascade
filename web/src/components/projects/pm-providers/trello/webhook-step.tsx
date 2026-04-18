/**
 * Trello webhook step adapter (plan 012/1).
 *
 * Replaces the Trello branch of the legacy `WebhookStep` (plan 012/4
 * deletes that). Fragment composing the shared `WebhookUrlDisplayStep`
 * (URL + copy) with Trello-specific UX: active-webhooks list,
 * programmatic "Create Webhook" button, delete buttons, curl fallback.
 *
 * Rendered as the Trello wizard's `trello-webhook` step Component via the
 * manifest path. All tRPC wiring (webhooks.list/create/delete with
 * trelloOnly:true) lives in the Trello wizard's `useProviderHooks`; this
 * component just renders what it receives.
 */

import { createElement, Fragment, type ReactElement } from 'react';
import { WebhookUrlDisplayStep } from '../steps/webhook-url-display.js';
import type { ProviderWizardStepProps } from '../types.js';

interface ActiveWebhook {
	readonly id: string;
	readonly url: string;
	readonly active: boolean;
}

interface TrelloWebhookProviderHooks {
	readonly webhookUrl: string;
	readonly callbackBaseUrl: string;
	readonly activeTrelloWebhooks: ReadonlyArray<ActiveWebhook>;
	readonly webhooksLoading: boolean;
	readonly createTrelloWebhook: () => void;
	readonly createLoading: boolean;
	readonly createError: string | undefined;
	readonly deleteTrelloWebhook: (callbackBaseUrl: string) => void;
	readonly deleteLoading: boolean;
}

function asTrelloWebhookHooks(
	providerHooks: Record<string, unknown> | undefined,
): TrelloWebhookProviderHooks {
	return (providerHooks ?? {}) as unknown as TrelloWebhookProviderHooks;
}

function buildTrelloCurl(boardId: string, callbackBaseUrl: string): string {
	const effectiveBoardId = boardId || '<YOUR_BOARD_ID>';
	const callbackUrl = callbackBaseUrl
		? `${callbackBaseUrl}/trello/webhook`
		: '<YOUR_CALLBACK_URL>/trello/webhook';
	return `curl -X POST "https://api.trello.com/1/webhooks" \\
  -H "Content-Type: application/json" \\
  -d '{
    "key": "<YOUR_TRELLO_API_KEY>",
    "token": "<YOUR_TRELLO_TOKEN>",
    "callbackURL": "${callbackUrl}",
    "idModel": "${effectiveBoardId}",
    "description": "CASCADE webhook"
  }'`;
}

export function TrelloWebhookAdapter({
	state,
	providerHooks,
}: ProviderWizardStepProps): ReactElement {
	const h = asTrelloWebhookHooks(providerHooks);
	const createDisabled = !h.callbackBaseUrl || h.createLoading;

	return createElement(
		Fragment,
		null,
		// Shared URL display + copy button.
		WebhookUrlDisplayStep({
			step: {
				kind: 'webhook-url-display',
				id: 'trello-webhook',
				config: {
					instructions:
						'Click "Create Webhook" below to register automatically, or use the curl command for manual setup.',
				},
			},
			providerId: 'trello',
			webhookUrl: h.webhookUrl,
		}),

		// Active-webhooks list.
		createElement(
			'div',
			{ className: 'pm-wizard-webhook-active-list', 'data-section': 'active-webhooks' },
			h.webhooksLoading
				? createElement('p', { 'data-state': 'loading' }, 'Loading webhooks…')
				: h.activeTrelloWebhooks.length === 0
					? createElement(
							'p',
							{ className: 'pm-wizard-webhook-empty' },
							'No Trello webhooks configured for this project.',
						)
					: createElement(
							'ul',
							{ className: 'pm-wizard-webhook-list' },
							...h.activeTrelloWebhooks.map((wh) =>
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
												// Extract base URL by stripping the trailing /trello/webhook
												// path (matches the legacy WebhookStep delete behavior).
												const base = wh.url.replace(/\/trello\/webhook$/, '');
												h.deleteTrelloWebhook(base);
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
					onClick: () => h.createTrelloWebhook(),
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
				buildTrelloCurl(state.trelloBoardId ?? '', h.callbackBaseUrl),
			),
		),
	);
}
