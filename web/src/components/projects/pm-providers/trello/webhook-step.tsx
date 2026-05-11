/**
 * Trello webhook step adapter (plan 012/1; styling restored post-spec-012
 * follow-up).
 *
 * Fragment composing the shared `WebhookUrlDisplayStep` (URL + copy) with
 * Trello-specific UX: active-webhooks list, programmatic "Create Webhook"
 * button, delete buttons, curl fallback.
 *
 * Rendered as the Trello wizard's `trello-webhook` step Component via the
 * manifest path. All tRPC wiring (webhooks.list/create/delete with
 * trelloOnly:true) lives in the Trello wizard's `useProviderHooks`; this
 * component just renders what it receives.
 */

import { Loader2, Trash2 } from 'lucide-react';
import { createElement, Fragment, type ReactElement } from 'react';
import { Button } from '@/components/ui/button.js';
import { CopyButton } from '@/components/ui/copy-button.js';
import type { DataProps } from '@/lib/data-props.js';
import { WebhookUrlDisplayStep } from '../steps/webhook-url-display.js';
import type { ProviderWizardStepProps } from '../types.js';

export interface ActiveWebhook {
	readonly id: string;
	readonly url: string;
	readonly active: boolean;
}

export interface TrelloWebhookListData {
	readonly trello?: ReadonlyArray<{
		readonly id: string | number;
		readonly callbackURL: string;
		readonly active: boolean;
	}>;
}

export function normalizeTrelloActiveWebhooks(
	webhooksData: TrelloWebhookListData | undefined,
): ActiveWebhook[] {
	return (webhooksData?.trello ?? []).map((webhook) => ({
		id: String(webhook.id),
		url: webhook.callbackURL,
		active: webhook.active,
	}));
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
	const curlCommand = buildTrelloCurl(state.trelloBoardId ?? '', h.callbackBaseUrl);

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
				: h.activeTrelloWebhooks.length === 0
					? createElement(
							'p',
							{ className: 'text-sm text-amber-600 dark:text-amber-400' },
							'No Trello webhooks configured for this project.',
						)
					: createElement(
							'ul',
							{ className: 'space-y-1' },
							...h.activeTrelloWebhooks.map((wh) =>
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
												// Extract base URL by stripping the trailing /trello/webhook
												// path (matches the legacy WebhookStep delete behavior).
												const base = wh.url.replace(/\/trello\/webhook$/, '');
												h.deleteTrelloWebhook(base);
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
					onClick: () => h.createTrelloWebhook(),
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
