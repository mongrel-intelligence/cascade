/**
 * GitHub Projects webhook step adapter.
 *
 * The setup story differs by owner type:
 *
 *  - **organization** — `projects_v2_item` is a valid org-hook event, so the
 *    webhook can be created **programmatically** (`POST /orgs/{org}/hooks`) — the
 *    step renders a "Create Webhook" button + active-webhooks list + delete
 *    (mirroring Trello/JIRA), with manual Organization Settings → Webhooks
 *    instructions as a fallback.
 *  - **user** — user-owned Projects have no webhook settings page and no
 *    create-webhook API; events can only reach CASCADE via an org-owned project
 *    or a GitHub App subscribed to `projects_v2_item`. Manual setup only.
 *
 * All tRPC wiring (webhooks.list/create/delete with githubProjectsOnly:true)
 * lives in the wizard's `useProviderHooks`; this component renders what it gets.
 */

import { Info, Loader2, Trash2 } from 'lucide-react';
import { createElement, Fragment, type ReactElement } from 'react';
import { Button } from '@/components/ui/button.js';
import type { DataProps } from '@/lib/data-props.js';
import { type ProjectCredentialMeta, ProjectSecretField } from '../../project-secret-field.js';
import { WebhookUrlDisplayStep } from '../steps/webhook-url-display.js';
import type { ProviderWizardStepProps } from '../types.js';

export interface ActiveWebhook {
	readonly id: string;
	readonly url: string;
	readonly active: boolean;
}

export interface GitHubProjectsWebhookListData {
	readonly githubProjects?: ReadonlyArray<{
		readonly id: string | number;
		readonly active?: boolean;
		readonly config?: { readonly url?: string };
	}>;
}

/**
 * Normalize the `webhooks.list` payload's github-projects org hooks for the UI.
 * Org webhooks can include hooks from other integrations, so we show only
 * CASCADE's own (`…/github-projects/webhook`) — the delete path matches the same
 * callback URL, so unrelated org hooks are neither listed nor deletable here.
 */
export function normalizeGitHubProjectsActiveWebhooks(
	webhooksData: GitHubProjectsWebhookListData | undefined,
): ActiveWebhook[] {
	return (webhooksData?.githubProjects ?? [])
		.filter((webhook) => (webhook.config?.url ?? '').endsWith('/github-projects/webhook'))
		.map((webhook) => ({
			id: String(webhook.id),
			url: webhook.config?.url ?? '',
			active: webhook.active ?? true,
		}));
}

interface GitHubProjectsWebhookProviderHooks {
	readonly webhookUrl: string;
	readonly projectIdForSecret: string;
	readonly webhookSecretCredential: ProjectCredentialMeta | undefined;
	// Org-owned programmatic webhook management (undefined for user-owned).
	readonly callbackBaseUrl?: string;
	readonly activeGithubProjectsWebhooks?: ReadonlyArray<ActiveWebhook>;
	readonly webhooksLoading?: boolean;
	readonly createGithubProjectsWebhook?: () => void;
	readonly createLoading?: boolean;
	readonly createError?: string | undefined;
	readonly deleteGithubProjectsWebhook?: (callbackBaseUrl: string) => void;
	readonly deleteLoading?: boolean;
}

function asGitHubProjectsWebhookHooks(
	providerHooks: Record<string, unknown> | undefined,
): GitHubProjectsWebhookProviderHooks {
	return (providerHooks ?? {}) as unknown as GitHubProjectsWebhookProviderHooks;
}

/** Body copy for the info banner, scoped to owner type (see file header). */
function bannerBody(isOrg: boolean): string {
	return isOrg
		? 'Organization webhooks can be created via the GitHub API — use the "Create Webhook" button ' +
				'below, or add it manually in your organization settings and enable the Projects v2 events.'
		: "User-owned GitHub Projects have no webhook settings page and no create-webhook API. To receive Projects v2 events, move the project under an organization (Organization Settings → Webhooks) or use a GitHub App subscribed to 'projects_v2_item'.";
}

/** The shared WebhookUrlDisplayStep's inline instruction line. */
function urlDisplayInstructions(isOrg: boolean): string {
	return isOrg
		? 'Click "Create Webhook" to register automatically, or configure this URL in your GitHub organization settings.'
		: 'Configure this webhook URL in the organization or GitHub App that receives your project events.';
}

/** Owner-aware "where to add the webhook" first step; the rest are shared. */
function locationStep(isOrg: boolean): ReactElement {
	return isOrg
		? createElement(
				'li',
				{ key: 'loc' },
				'Go to your GitHub ',
				createElement('strong', null, 'organization'),
				' Settings → Webhooks.',
			)
		: createElement(
				'li',
				{ key: 'loc' },
				'User-owned projects have no webhook settings — receive events through the ',
				createElement('strong', null, 'organization'),
				' that owns the project (Organization Settings → Webhooks) or a GitHub App subscribed to ',
				createElement('code', null, 'projects_v2_item'),
				'.',
			);
}

function instructionSteps(isOrg: boolean): ReactElement[] {
	return [
		locationStep(isOrg),
		createElement('li', { key: 'add' }, 'Click "Add webhook" and enter the URL above.'),
		createElement(
			'li',
			{ key: 'content-type' },
			'Set Content type to ',
			createElement('code', null, 'application/json'),
			'.',
		),
		createElement(
			'li',
			{ key: 'events' },
			'Select "Let me select individual events" and enable ',
			createElement('strong', null, 'Projects v2'),
			' events.',
		),
		createElement(
			'li',
			{ key: 'secret' },
			'If you set a secret in GitHub, paste it into the field above so CASCADE can verify webhook authenticity.',
		),
	];
}

function infoBanner(isOrg: boolean): ReactElement {
	return createElement(
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
					isOrg ? 'Webhook Setup' : 'Manual Webhook Setup Required',
				),
				createElement(
					'p',
					{ className: 'text-xs text-blue-600 dark:text-blue-400' },
					bannerBody(isOrg),
				),
			),
		),
	);
}

/** Active-webhooks list (org-owned only). */
function activeWebhookList(h: GitHubProjectsWebhookProviderHooks): ReactElement {
	const active = h.activeGithubProjectsWebhooks ?? [];
	return createElement(
		'div',
		{ className: 'space-y-2', 'data-section': 'active-webhooks' },
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
			: active.length === 0
				? createElement(
						'p',
						{ className: 'text-sm text-amber-600 dark:text-amber-400' },
						'No GitHub Projects webhooks configured for this organization.',
					)
				: createElement(
						'ul',
						{ className: 'space-y-1' },
						...active.map((wh) =>
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
											// Strip the trailing /github-projects/webhook to recover the base URL.
											const base = wh.url.replace(/\/github-projects\/webhook$/, '');
											h.deleteGithubProjectsWebhook?.(base);
										},
										title: 'Delete webhook',
									} as React.ComponentProps<typeof Button> & DataProps,
									createElement(Trash2, { className: 'h-4 w-4' }),
								),
							),
						),
					),
	);
}

/** "Create Webhook" button (org-owned only). */
function createButton(h: GitHubProjectsWebhookProviderHooks): ReactElement {
	const createDisabled = !h.callbackBaseUrl || h.createLoading;
	return createElement(
		'div',
		{ className: 'space-y-2' },
		createElement(
			Button,
			{
				type: 'button',
				variant: 'default',
				'data-action': 'create-webhook',
				disabled: createDisabled,
				onClick: () => h.createGithubProjectsWebhook?.(),
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
	);
}

export function GitHubProjectsWebhookAdapter({
	state,
	providerHooks,
}: ProviderWizardStepProps): ReactElement {
	const h = asGitHubProjectsWebhookHooks(providerHooks);
	const isOrg = state.githubProjectsOwnerType === 'organization';

	return createElement(
		Fragment,
		null,
		infoBanner(isOrg),
		WebhookUrlDisplayStep({
			step: {
				kind: 'webhook-url-display',
				id: 'github-projects-webhook',
				config: { instructions: urlDisplayInstructions(isOrg) },
			},
			providerId: 'github-projects',
			webhookUrl: h.webhookUrl,
		}),
		// Programmatic create/list/delete — organization-owned projects only.
		isOrg ? activeWebhookList(h) : null,
		isOrg ? createButton(h) : null,
		h.projectIdForSecret
			? createElement(ProjectSecretField, {
					projectId: h.projectIdForSecret,
					envVarKey: 'GITHUB_PROJECTS_WEBHOOK_SECRET',
					label: 'Webhook Signing Secret (optional)',
					description:
						'Paste the signing secret from your GitHub webhook. CASCADE verifies HMAC-SHA256 on every incoming GitHub Projects webhook request when this is set; verification is skipped if left blank.',
					placeholder: 'ghp_...',
					credential: h.webhookSecretCredential,
				})
			: null,
		createElement(
			'div',
			{ className: 'space-y-2' },
			createElement(
				'p',
				{ className: 'text-xs text-muted-foreground font-medium' },
				isOrg ? 'Manual setup (alternative):' : 'Setup instructions:',
			),
			createElement(
				'ol',
				{
					className: 'list-decimal list-inside space-y-1 text-xs text-muted-foreground pl-1',
				},
				...instructionSteps(isOrg),
			),
		),
	);
}
