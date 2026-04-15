/**
 * Provider-agnostic step renderer components for PMWizard:
 * WebhookStep and SaveStep.
 */

import type { UseMutationResult } from '@tanstack/react-query';
import {
	AlertCircle,
	AlertTriangle,
	Check,
	Clipboard,
	ExternalLink,
	Info,
	Loader2,
	RefreshCw,
	Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { Label } from '@/components/ui/label.js';
import type { WizardState } from './pm-wizard-state.js';
import { type ProjectCredentialMeta, ProjectSecretField } from './project-secret-field.js';

// ============================================================================
// WebhookStep
// ============================================================================

interface ActiveWebhook {
	id: string;
	url: string;
	active: boolean;
}

interface WebhooksQueryProps {
	isLoading: boolean;
	data?: {
		errors?: Record<string, unknown>;
	};
	refetch: () => void;
}

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	const handleCopy = async () => {
		await navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};
	return (
		<button
			type="button"
			onClick={handleCopy}
			className="inline-flex items-center gap-1 shrink-0 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
			title="Copy to clipboard"
		>
			{copied ? (
				<Check className="h-3 w-3 text-green-600 dark:text-green-400" />
			) : (
				<Clipboard className="h-3 w-3" />
			)}
			{copied ? 'Copied' : 'Copy'}
		</button>
	);
}

// ============================================================================
// LinearWebhookInfoPanel
// ============================================================================

export function LinearWebhookInfoPanel({
	webhookUrl,
	projectId,
	webhookSecretCredential,
}: {
	webhookUrl: string;
	projectId: string;
	webhookSecretCredential?: ProjectCredentialMeta;
}) {
	return (
		<div className="space-y-4">
			<div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-900/50 dark:bg-blue-900/20">
				<div className="flex items-start gap-2">
					<Info className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
					<div className="space-y-2">
						<p className="text-sm font-medium text-blue-700 dark:text-blue-300">
							Manual Webhook Setup Required
						</p>
						<p className="text-xs text-blue-600 dark:text-blue-400">
							Linear webhooks must be configured manually in your Linear team settings. CASCADE
							cannot create them programmatically.
						</p>
					</div>
				</div>
			</div>

			<div className="space-y-2">
				<Label>Your CASCADE Webhook URL</Label>
				<div className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2">
					<span className="flex-1 font-mono text-xs break-all">{webhookUrl}</span>
					<CopyButton text={webhookUrl} />
				</div>
			</div>

			<ProjectSecretField
				projectId={projectId}
				envVarKey="LINEAR_WEBHOOK_SECRET"
				label="Webhook Signing Secret (optional)"
				description="Paste the signing secret from your Linear webhook. CASCADE verifies HMAC-SHA256 on every incoming Linear webhook request when this is set; verification is skipped if left blank."
				placeholder="lin_wh_..."
				credential={webhookSecretCredential}
			/>

			<div className="space-y-2">
				<p className="text-xs text-muted-foreground font-medium">Setup instructions:</p>
				<ol className="list-decimal list-inside space-y-1 text-xs text-muted-foreground pl-1">
					<li>
						Go to{' '}
						<a
							href="https://linear.app/settings/api"
							target="_blank"
							rel="noopener noreferrer"
							className="underline hover:text-foreground"
						>
							linear.app/settings/api
						</a>{' '}
						and navigate to <strong>Webhooks</strong>
					</li>
					<li>Click &quot;New webhook&quot; and enter the URL above</li>
					<li>
						Enable these events (each maps to a CASCADE trigger handler):
						<ul className="list-disc list-inside ml-4 mt-1 space-y-0.5">
							<li>
								<strong>Issues</strong> — status transitions drive CASCADE&apos;s splitting,
								planning, and implementation agents
							</li>
							<li>
								<strong>Comments</strong> — @mentions of the CASCADE bot trigger a response agent
							</li>
							<li>
								<strong>Issue Labels</strong> — adding the &quot;Ready to Process&quot; label starts
								an agent on the issue
							</li>
						</ul>
					</li>
					<li>Select your team and save — webhooks are team-scoped in Linear</li>
					<li>
						If you set a signing secret in Linear, paste it into the field above so CASCADE can
						verify webhook authenticity
					</li>
				</ol>
			</div>
		</div>
	);
}

// ============================================================================
// WebhookStep
// ============================================================================

export function WebhookStep({
	state,
	webhooksQuery,
	activeWebhooks,
	callbackBaseUrl,
	createWebhookMutation,
	deleteWebhookMutation,
	linearWebhookUrl,
	projectId,
	linearWebhookSecretCredential,
}: {
	state: WizardState;
	webhooksQuery: WebhooksQueryProps;
	activeWebhooks: ActiveWebhook[];
	callbackBaseUrl: string;
	createWebhookMutation: UseMutationResult<unknown, Error, void, unknown>;
	deleteWebhookMutation: UseMutationResult<unknown, Error, string, unknown>;
	linearWebhookUrl?: string;
	projectId: string;
	linearWebhookSecretCredential?: ProjectCredentialMeta;
}) {
	// Linear uses a display-only panel — no create/delete buttons
	if (state.provider === 'linear') {
		return (
			<LinearWebhookInfoPanel
				webhookUrl={linearWebhookUrl ?? `${callbackBaseUrl}/linear/webhook`}
				projectId={projectId}
				webhookSecretCredential={linearWebhookSecretCredential}
			/>
		);
	}

	const isTrello = state.provider === 'trello';
	const providerName = isTrello ? 'Trello' : 'JIRA';

	// Build curl commands for manual webhook creation
	const buildTrelloCurl = () => {
		const boardId = state.trelloBoardId || '<YOUR_BOARD_ID>';
		const callbackUrl = callbackBaseUrl
			? `${callbackBaseUrl}/trello/webhook`
			: '<YOUR_CALLBACK_URL>/trello/webhook';
		return `curl -X POST "https://api.trello.com/1/webhooks" \\
  -H "Content-Type: application/json" \\
  -d '{
    "key": "<YOUR_TRELLO_API_KEY>",
    "token": "<YOUR_TRELLO_TOKEN>",
    "callbackURL": "${callbackUrl}",
    "idModel": "${boardId}",
    "description": "CASCADE webhook"
  }'`;
	};

	const buildJiraCurl = () => {
		const baseUrl = state.jiraBaseUrl || '<YOUR_JIRA_BASE_URL>';
		const callbackUrl = callbackBaseUrl
			? `${callbackBaseUrl}/jira/webhook`
			: '<YOUR_CALLBACK_URL>/jira/webhook';
		return `curl -X POST "${baseUrl}/rest/webhooks/1.0/webhook" \\
  -H "Content-Type: application/json" \\
  -u "<YOUR_JIRA_EMAIL>:<YOUR_JIRA_API_TOKEN>" \\
  -d '{
    "name": "CASCADE webhook",
    "url": "${callbackUrl}",
    "events": ["jira:issue_updated", "jira:issue_created"],
    "filters": {},
    "excludeBody": false
  }'`;
	};

	const curlCommand = isTrello ? buildTrelloCurl() : buildJiraCurl();

	return (
		<div className="space-y-4">
			{/* Per-provider errors */}
			{webhooksQuery.data?.errors &&
				Object.entries(webhooksQuery.data.errors)
					.filter(([provider, err]) => err != null && provider !== 'github')
					.map(([provider, err]) => (
						<div
							key={provider}
							className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-900/20"
						>
							<AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
							<div className="flex-1 text-sm">
								<span className="font-medium capitalize text-amber-700 dark:text-amber-400">
									{provider}
								</span>
								<span className="text-amber-600 dark:text-amber-500">: {String(err)}</span>
							</div>
							<button
								type="button"
								onClick={() => webhooksQuery.refetch()}
								className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 shrink-0"
							>
								<RefreshCw className="h-3 w-3" /> Retry
							</button>
						</div>
					))}

			{webhooksQuery.isLoading ? (
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 className="h-4 w-4 animate-spin" /> Loading webhooks...
				</div>
			) : activeWebhooks.length > 0 ? (
				<div className="space-y-2">
					<Label>Active Webhooks</Label>
					{activeWebhooks.map((w) => (
						<div
							key={w.id}
							className="flex items-center justify-between rounded-md border px-3 py-2"
						>
							<div className="flex items-center gap-2 text-sm">
								<span
									className={`inline-block h-2 w-2 rounded-full ${w.active ? 'bg-green-500 dark:bg-green-400' : 'bg-amber-500 dark:bg-amber-400'}`}
								/>
								<span className="font-mono text-xs">{w.url}</span>
							</div>
							<button
								type="button"
								onClick={() => {
									// Extract base URL from callback URL
									const base = w.url.replace(/\/(trello|jira)\/webhook$/, '');
									deleteWebhookMutation.mutate(base);
								}}
								disabled={deleteWebhookMutation.isPending}
								className="p-1 text-muted-foreground hover:text-destructive"
							>
								<Trash2 className="h-4 w-4" />
							</button>
						</div>
					))}
				</div>
			) : (
				<div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
					<AlertCircle className="h-4 w-4" />
					No {providerName} webhooks configured for this project.
				</div>
			)}

			{/* curl instructions for manual webhook creation (collapsible) */}
			<details className="rounded-md border border-blue-200 bg-blue-50 px-3 py-3 dark:border-blue-900/50 dark:bg-blue-900/20">
				<summary className="flex items-start gap-2 cursor-pointer list-none">
					<Info className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
					<p className="text-xs text-blue-700 dark:text-blue-300 font-medium">
						Manual webhook creation (alternative: if the button below doesn't work)
					</p>
				</summary>
				<div className="space-y-2 mt-2">
					<p className="text-xs text-blue-600 dark:text-blue-400 pl-6">
						Use the following curl command to create the {providerName} webhook manually with your
						own credentials:
					</p>
					<div className="relative rounded-md bg-muted border pl-6">
						<div className="absolute top-2 right-2">
							<CopyButton text={curlCommand} />
						</div>
						<pre className="text-xs font-mono whitespace-pre-wrap break-all py-2 pr-16 overflow-x-auto">
							{curlCommand}
						</pre>
					</div>
				</div>
			</details>

			<div className="space-y-2">
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => createWebhookMutation.mutate()}
						disabled={!callbackBaseUrl || createWebhookMutation.isPending}
						className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 shrink-0"
					>
						{createWebhookMutation.isPending ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<ExternalLink className="h-4 w-4" />
						)}
						Create Webhook
					</button>
				</div>
				{createWebhookMutation.isError && (
					<p className="text-sm text-destructive">
						{(createWebhookMutation.error as Error).message}
					</p>
				)}
				{createWebhookMutation.isSuccess && (
					<p className="text-sm text-green-600 dark:text-green-400">
						{webhooksQuery.data?.errors &&
						Object.entries(webhooksQuery.data.errors)
							.filter(([provider]) => provider !== 'github')
							.some(([, e]) => e != null)
							? 'Webhook created, but some providers failed to load — see warnings above.'
							: 'Webhook created successfully.'}
					</p>
				)}
			</div>
		</div>
	);
}

// ============================================================================
// SaveStep
// ============================================================================

export function SaveStep({
	state,
	saveMutation,
}: {
	state: WizardState;
	saveMutation: UseMutationResult<unknown, Error, void, unknown>;
}) {
	return (
		<div className="space-y-4">
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={() => saveMutation.mutate()}
					disabled={saveMutation.isPending}
					className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
				>
					{saveMutation.isPending
						? 'Saving...'
						: state.isEditing
							? 'Update Integration'
							: 'Save Integration'}
				</button>
				{saveMutation.isSuccess && (
					<span className="text-sm text-green-600 dark:text-green-400">
						Integration saved successfully.
					</span>
				)}
				{saveMutation.isError && (
					<span className="text-sm text-destructive">{(saveMutation.error as Error).message}</span>
				)}
			</div>
		</div>
	);
}
