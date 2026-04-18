/**
 * Linear webhook step adapter (plan 012/3; styling restored post-spec-012
 * follow-up).
 *
 * Linear has no programmatic webhook registration — Linear's API forbids
 * it. Fragment composition: shared `WebhookUrlDisplayStep` (URL + copy) +
 * info banner + 5-step manual setup instructions + `ProjectSecretField`
 * bound to `LINEAR_WEBHOOK_SECRET`.
 *
 * The secret field is NOT a controlled input — `ProjectSecretField`
 * manages its own server round-trip via the project-credentials API.
 * That's why the webhook step is a Fragment composition rather than
 * a widening of the shared `WebhookUrlDisplayStep` (which would require
 * a controlled secretValue + onSecretChange pattern).
 */

import { Info } from 'lucide-react';
import { createElement, Fragment, type ReactElement } from 'react';
import { type ProjectCredentialMeta, ProjectSecretField } from '../../project-secret-field.js';
import { WebhookUrlDisplayStep } from '../steps/webhook-url-display.js';
import type { ProviderWizardStepProps } from '../types.js';

interface LinearWebhookProviderHooks {
	readonly webhookUrl: string;
	readonly projectIdForSecret: string;
	readonly webhookSecretCredential: ProjectCredentialMeta | undefined;
}

function asLinearWebhookHooks(
	providerHooks: Record<string, unknown> | undefined,
): LinearWebhookProviderHooks {
	return (providerHooks ?? {}) as unknown as LinearWebhookProviderHooks;
}

export function LinearWebhookAdapter({ providerHooks }: ProviderWizardStepProps): ReactElement {
	const h = asLinearWebhookHooks(providerHooks);

	return createElement(
		Fragment,
		null,
		// Info banner — manual setup required.
		createElement(
			'div',
			{
				className:
					'rounded-md border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-900/50 dark:bg-blue-900/20',
				'data-section': 'info-banner',
			},
			createElement(
				'div',
				{ className: 'flex items-start gap-2' },
				createElement(Info, {
					className: 'h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5',
				}),
				createElement(
					'div',
					{ className: 'space-y-1' },
					createElement(
						'p',
						{ className: 'text-sm font-medium text-blue-700 dark:text-blue-300' },
						'Manual Webhook Setup Required',
					),
					createElement(
						'p',
						{ className: 'text-xs text-blue-600 dark:text-blue-400' },
						'Linear webhooks must be configured manually in your Linear team settings. CASCADE cannot create them programmatically.',
					),
				),
			),
		),

		// Shared URL display + copy button.
		WebhookUrlDisplayStep({
			step: {
				kind: 'webhook-url-display',
				id: 'linear-webhook',
				config: {
					instructions:
						'Configure this webhook URL manually in Linear → Settings → API → Webhooks.',
				},
			},
			providerId: 'linear',
			webhookUrl: h.webhookUrl,
		}),

		// Signing-secret field (self-managing persistence via project-credentials
		// API). Hidden when no projectId is available (e.g. wizard before save).
		h.projectIdForSecret
			? createElement(ProjectSecretField, {
					projectId: h.projectIdForSecret,
					envVarKey: 'LINEAR_WEBHOOK_SECRET',
					label: 'Webhook Signing Secret (optional)',
					description:
						'Paste the signing secret from your Linear webhook. CASCADE verifies HMAC-SHA256 on every incoming Linear webhook request when this is set; verification is skipped if left blank.',
					placeholder: 'lin_wh_...',
					credential: h.webhookSecretCredential,
				})
			: null,

		// 5-step setup instructions (copy lifted from the retiring
		// LinearWebhookInfoPanel).
		createElement(
			'div',
			{ className: 'space-y-2' },
			createElement(
				'p',
				{ className: 'text-xs text-muted-foreground font-medium' },
				'Setup instructions:',
			),
			createElement(
				'ol',
				{
					className: 'list-decimal list-inside space-y-1 text-xs text-muted-foreground pl-1',
				},
				createElement(
					'li',
					null,
					'Go to ',
					createElement(
						'a',
						{
							href: 'https://linear.app/settings/api',
							target: '_blank',
							rel: 'noopener noreferrer',
							className: 'underline hover:text-foreground',
						},
						'linear.app/settings/api',
					),
					' and navigate to ',
					createElement('strong', null, 'Webhooks'),
				),
				createElement('li', null, 'Click "New webhook" and enter the URL above'),
				createElement(
					'li',
					null,
					'Enable these events (each maps to a CASCADE trigger handler):',
					createElement(
						'ul',
						{ className: 'list-disc list-inside ml-4 mt-1 space-y-0.5' },
						createElement(
							'li',
							null,
							createElement('strong', null, 'Issues'),
							' — status transitions drive CASCADE\u2019s splitting, planning, and implementation agents',
						),
						createElement(
							'li',
							null,
							createElement('strong', null, 'Comments'),
							' — @mentions of the CASCADE bot trigger a response agent',
						),
						createElement(
							'li',
							null,
							createElement('strong', null, 'Issue Labels'),
							' — adding the "Ready to Process" label starts an agent on the issue',
						),
					),
				),
				createElement('li', null, 'Select your team and save — webhooks are team-scoped in Linear'),
				createElement(
					'li',
					null,
					'If you set a signing secret in Linear, paste it into the field above so CASCADE can verify webhook authenticity',
				),
			),
		),

		// Project-scope cross-reference (identical copy to legacy).
		createElement(
			'p',
			{ className: 'text-xs text-muted-foreground' },
			'If you also set a Linear ',
			createElement('strong', null, 'project scope'),
			' in the Board / Project Selection step, CASCADE applies that filter on its side after receiving each webhook — your Linear webhook configuration stays team-scoped and unchanged.',
		),
	);
}
