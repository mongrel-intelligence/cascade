/**
 * Provider-agnostic step renderer components for PMWizard:
 * WebhookStep and SaveStep.
 */
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import type { UseMutationResult } from '@tanstack/react-query';
import {
	AlertCircle,
	AlertTriangle,
	ChevronDown,
	ChevronRight,
	ExternalLink,
	KeyRound,
	Loader2,
	RefreshCw,
	Trash2,
} from 'lucide-react';
import type { WizardState } from './pm-wizard-state.js';

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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: webhook step UI with provider-specific admin credential fields
export function WebhookStep({
	state,
	webhooksQuery,
	activeWebhooks,
	callbackBaseUrl,
	adminTokensOpen,
	setAdminTokensOpen,
	oneTimeTrelloApiKey,
	setOneTimeTrelloApiKey,
	oneTimeTrelloToken,
	setOneTimeTrelloToken,
	oneTimeJiraEmail,
	setOneTimeJiraEmail,
	oneTimeJiraApiToken,
	setOneTimeJiraApiToken,
	createWebhookMutation,
	deleteWebhookMutation,
}: {
	state: WizardState;
	webhooksQuery: WebhooksQueryProps;
	activeWebhooks: ActiveWebhook[];
	callbackBaseUrl: string;
	adminTokensOpen: boolean;
	setAdminTokensOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
	oneTimeTrelloApiKey: string;
	setOneTimeTrelloApiKey: (v: string) => void;
	oneTimeTrelloToken: string;
	setOneTimeTrelloToken: (v: string) => void;
	oneTimeJiraEmail: string;
	setOneTimeJiraEmail: (v: string) => void;
	oneTimeJiraApiToken: string;
	setOneTimeJiraApiToken: (v: string) => void;
	createWebhookMutation: UseMutationResult<unknown, Error, void, unknown>;
	deleteWebhookMutation: UseMutationResult<unknown, Error, string, unknown>;
}) {
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
					No {state.provider === 'trello' ? 'Trello' : 'JIRA'} webhooks configured for this project.
				</div>
			)}

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

			{/* One-time admin credentials */}
			<div className="border rounded-md">
				<button
					type="button"
					onClick={() => setAdminTokensOpen((prev) => !prev)}
					className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground hover:text-foreground transition-colors"
				>
					<KeyRound className="h-4 w-4" />
					<span className="flex-1">Use admin credentials (one-time)</span>
					{adminTokensOpen ? (
						<ChevronDown className="h-4 w-4" />
					) : (
						<ChevronRight className="h-4 w-4" />
					)}
				</button>
				{adminTokensOpen && (
					<div className="border-t px-3 py-3 space-y-3">
						<p className="text-xs text-muted-foreground">
							Provide tokens with elevated permissions for webhook management. These are used once
							and never saved.
						</p>
						{/* PM-provider-specific fields */}
						{state.provider === 'trello' ? (
							<>
								<div className="space-y-1">
									<Label className="text-xs">Trello API Key</Label>
									<Input
										value={oneTimeTrelloApiKey}
										onChange={(e) => setOneTimeTrelloApiKey(e.target.value)}
										placeholder="One-time API key"
										type="password"
										className="h-8 text-sm"
									/>
								</div>
								<div className="space-y-1">
									<Label className="text-xs">Trello Token</Label>
									<Input
										value={oneTimeTrelloToken}
										onChange={(e) => setOneTimeTrelloToken(e.target.value)}
										placeholder="One-time token"
										type="password"
										className="h-8 text-sm"
									/>
								</div>
							</>
						) : (
							<>
								<div className="space-y-1">
									<Label className="text-xs">JIRA Email</Label>
									<Input
										value={oneTimeJiraEmail}
										onChange={(e) => setOneTimeJiraEmail(e.target.value)}
										placeholder="user@example.com"
										className="h-8 text-sm"
									/>
								</div>
								<div className="space-y-1">
									<Label className="text-xs">JIRA API Token</Label>
									<Input
										value={oneTimeJiraApiToken}
										onChange={(e) => setOneTimeJiraApiToken(e.target.value)}
										placeholder="One-time API token"
										type="password"
										className="h-8 text-sm"
									/>
								</div>
							</>
						)}
					</div>
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
			{/* Summary */}
			<div className="rounded-md bg-muted/50 p-4 space-y-2 text-sm">
				<div className="flex justify-between">
					<span className="text-muted-foreground">Provider</span>
					<span className="font-medium">{state.provider === 'trello' ? 'Trello' : 'JIRA'}</span>
				</div>
				{state.verificationResult && (
					<div className="flex justify-between">
						<span className="text-muted-foreground">Identity</span>
						<span className="font-medium">{state.verificationResult.display}</span>
					</div>
				)}
				<div className="flex justify-between">
					<span className="text-muted-foreground">
						{state.provider === 'trello' ? 'Board' : 'Project'}
					</span>
					<span className="font-medium">
						{state.provider === 'trello'
							? state.trelloBoards.find((b) => b.id === state.trelloBoardId)?.name ||
								state.trelloBoardId
							: state.jiraProjects.find((p) => p.key === state.jiraProjectKey)?.name ||
								state.jiraProjectKey}
					</span>
				</div>
				<div className="flex justify-between">
					<span className="text-muted-foreground">
						{state.provider === 'trello' ? 'Lists mapped' : 'Statuses mapped'}
					</span>
					<span className="font-medium">
						{state.provider === 'trello'
							? Object.keys(state.trelloListMappings).filter((k) => state.trelloListMappings[k])
									.length
							: Object.keys(state.jiraStatusMappings).filter((k) => state.jiraStatusMappings[k])
									.length}
					</span>
				</div>
			</div>

			<p className="text-xs text-muted-foreground">
				Trigger configuration is managed separately in the <strong>Agent Configs</strong> tab.
			</p>

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
