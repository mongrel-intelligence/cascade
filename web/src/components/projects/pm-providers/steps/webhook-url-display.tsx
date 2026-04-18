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
	/** Fully-qualified webhook URL (e.g. "https://router.example/trello/webhook"). */
	readonly webhookUrl: string;
	readonly instructions?: string;
	/**
	 * Plan 011/1: optional inline signing-secret field. When both
	 * `secretFieldRole` and `onSecretChange` are supplied, the step renders
	 * an additional <input type="password"> below the URL. Used by Linear
	 * (`LINEAR_WEBHOOK_SECRET`) and any other provider that requires HMAC-
	 * signed webhooks. Omitting either prop preserves the spec-010 output
	 * byte-for-byte.
	 */
	readonly secretFieldRole?: string;
	readonly secretLabel?: string;
	readonly secretValue?: string;
	readonly onSecretChange?: (value: string) => void;
}

export function WebhookUrlDisplayStep({
	step,
	providerId,
	webhookUrl,
	instructions,
	secretFieldRole,
	secretLabel,
	secretValue,
	onSecretChange,
}: WebhookUrlDisplayStepProps) {
	const [copied, setCopied] = useState(false);
	const cfgInstructions = (step.config?.instructions as string | undefined) ?? instructions;

	// Plan 011/1: render the secret field only when BOTH role and callback are
	// supplied — a role without a callback would be an uncontrolled input,
	// silently dropping user input.
	const showSecretField = Boolean(secretFieldRole && onSecretChange);

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
		showSecretField
			? createElement(
					'div',
					{
						className: 'pm-wizard-webhook-secret',
						'data-secret-role': secretFieldRole,
					},
					createElement(
						'label',
						{ htmlFor: `webhook-secret-${step.id}` },
						secretLabel ?? secretFieldRole,
					),
					createElement('input', {
						id: `webhook-secret-${step.id}`,
						type: 'password',
						'data-role': secretFieldRole,
						value: secretValue ?? '',
						onChange: (e: React.ChangeEvent<HTMLInputElement>) => onSecretChange?.(e.target.value),
					}),
				)
			: null,
	);
}
