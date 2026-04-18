/**
 * Shared webhook-url-display step component (plan 010/3; styling restored
 * post-spec-012 follow-up).
 *
 * Displays the provider's webhook URL constructed from the CASCADE router
 * base URL + the manifest's `webhookRoute`. Includes a copy-to-clipboard
 * button and optional per-provider setup instructions pulled from
 * `step.config?.instructions`.
 *
 * Copy button uses `Button` + inline clipboard handler rather than the
 * shared `CopyButton` primitive because it emits a wizard-specific
 * `data-action="copy-webhook-url"` that downstream callers may depend on
 * (e.g. operator guides that reference the webhook-url row).
 */

import { Check, Clipboard } from 'lucide-react';
import { createElement, useState } from 'react';
import { Button } from '@/components/ui/button.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import type { DataProps } from '@/lib/data-props.js';
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
			className: 'space-y-3',
		},
		createElement('h4', { className: 'text-sm font-medium' }, 'Webhook URL'),
		createElement(
			'div',
			{
				className: 'flex items-center gap-2 rounded-md border bg-muted px-3 py-2',
				'data-url': webhookUrl,
			},
			createElement('code', { className: 'flex-1 font-mono text-xs break-all' }, webhookUrl),
			createElement(
				Button,
				{
					type: 'button',
					variant: 'outline',
					size: 'sm',
					'data-action': 'copy-webhook-url',
					onClick: () => {
						if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
							void navigator.clipboard.writeText(webhookUrl).then(() => {
								setCopied(true);
								setTimeout(() => setCopied(false), 2000);
							});
						}
					},
				} as React.ComponentProps<typeof Button> & DataProps,
				copied
					? createElement(Check, { className: 'h-3 w-3 text-green-600' })
					: createElement(Clipboard, { className: 'h-3 w-3' }),
				copied ? 'Copied!' : 'Copy',
			),
		),
		cfgInstructions
			? createElement('p', { className: 'text-xs text-muted-foreground' }, cfgInstructions)
			: null,
		showSecretField
			? createElement(
					'div',
					{
						className: 'space-y-2',
						'data-secret-role': secretFieldRole,
					} as React.ComponentProps<'div'> & DataProps,
					createElement(
						Label,
						{ htmlFor: `webhook-secret-${step.id}` },
						secretLabel ?? secretFieldRole,
					),
					createElement(Input, {
						id: `webhook-secret-${step.id}`,
						type: 'password',
						'data-role': secretFieldRole,
						value: secretValue ?? '',
						onChange: (e: React.ChangeEvent<HTMLInputElement>) => onSecretChange?.(e.target.value),
						autoComplete: 'off',
					} as React.ComponentProps<typeof Input> & DataProps),
				)
			: null,
	);
}
