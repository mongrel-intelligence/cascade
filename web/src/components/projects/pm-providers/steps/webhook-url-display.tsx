/**
 * Shared webhook-url-display step component (plan 010/3).
 *
 * Displays the provider's webhook URL constructed from the CASCADE router
 * base URL + the manifest's `webhookRoute`. Includes a copy-to-clipboard
 * button and optional per-provider setup instructions pulled from
 * `step.config?.instructions`.
 */

import { createElement, useState } from 'react';
import type { StandardStep } from '../../../../../../src/integrations/pm/manifest.js';

export interface WebhookUrlDisplayStepProps {
	readonly step: StandardStep;
	readonly providerId: string;
	readonly /** Fully-qualified webhook URL (e.g. "https://router.example/trello/webhook"). */
	webhookUrl: string;
	readonly instructions?: string;
}

export function WebhookUrlDisplayStep({
	step,
	providerId,
	webhookUrl,
	instructions,
}: WebhookUrlDisplayStepProps) {
	const [copied, setCopied] = useState(false);
	const cfgInstructions = (step.config?.instructions as string | undefined) ?? instructions;

	return createElement(
		'div',
		{
			'data-step-component': 'webhook-url-display',
			'data-provider-id': providerId,
			'data-step-id': step.id,
			className: 'pm-wizard-step pm-wizard-step-webhook-url-display',
		},
		createElement('h4', null, 'Webhook URL'),
		createElement(
			'div',
			{ className: 'pm-wizard-webhook-url', 'data-url': webhookUrl },
			createElement('code', null, webhookUrl),
			createElement(
				'button',
				{
					type: 'button',
					'data-action': 'copy-webhook-url',
					onClick: () => {
						if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
							void navigator.clipboard.writeText(webhookUrl).then(() => {
								setCopied(true);
								setTimeout(() => setCopied(false), 2000);
							});
						}
					},
				},
				copied ? 'Copied!' : 'Copy',
			),
		),
		cfgInstructions
			? createElement('p', { className: 'pm-wizard-webhook-instructions' }, cfgInstructions)
			: null,
	);
}
