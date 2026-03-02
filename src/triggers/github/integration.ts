/**
 * GitHubWebhookIntegration — adapts GitHub webhooks to the PMIntegration interface.
 *
 * Allows the GitHub webhook handler to delegate to the generic `processPMWebhook()`
 * the same way Trello and Jira do, while encapsulating GitHub-specific concerns:
 * - Project lookup by repository full name
 * - Persona token credential scoping
 * - GitHub-specific AgentExecutionConfig overrides
 * - Ack comment operations on PRs
 */

import { loadProjectConfigByRepo } from '../../config/provider.js';
import { withGitHubToken } from '../../github/client.js';
import { getPersonaToken } from '../../github/personas.js';
import type { PMIntegration, PMWebhookEvent } from '../../pm/integration.js';
import type { ProjectPMConfig } from '../../pm/lifecycle.js';
import type { PMProvider } from '../../pm/types.js';
import type { CascadeConfig, ProjectConfig } from '../../types/index.js';
import type { AgentExecutionConfig } from '../shared/agent-execution.js';
import { deleteProgressCommentOnSuccess, updateInitialCommentWithError } from './ack-comments.js';

export class GitHubWebhookIntegration implements PMIntegration {
	readonly type = 'github';

	createProvider(_project: ProjectConfig): PMProvider {
		// GitHub doesn't use a PM provider — returning a minimal no-op.
		// The PMIntegration interface requires this method, but GitHub's
		// agent execution doesn't go through PM lifecycle operations.
		throw new Error(
			'GitHubWebhookIntegration does not use a PM provider. ' +
				'Use integration.withCredentials() and runAgentExecutionPipeline() directly.',
		);
	}

	/**
	 * Scopes the execution to a GitHub persona token for the relevant agent type.
	 *
	 * The agentType is extracted from the trigger result and passed via context.
	 * For simplicity we use the 'implementation' persona at credential-scope time;
	 * the actual per-agent persona is resolved inside executeGitHubAgent.
	 */
	async withCredentials<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
		const githubToken = await getPersonaToken(projectId, 'implementation');
		return withGitHubToken(githubToken, fn);
	}

	resolveLifecycleConfig(_project: ProjectConfig): ProjectPMConfig {
		// GitHub webhooks do not use PM-style labels or statuses.
		return {
			labels: {},
			statuses: {},
		};
	}

	parseWebhookPayload(raw: unknown): PMWebhookEvent | null {
		if (!raw || typeof raw !== 'object') return null;
		const p = raw as Record<string, unknown>;
		const repository = p.repository as Record<string, unknown> | undefined;
		const repoFullName = repository?.full_name as string | undefined;

		if (!repoFullName) {
			return null;
		}

		// Determine the event type from the payload shape
		const eventType = this.detectEventType(p);

		return {
			eventType,
			projectIdentifier: repoFullName,
			// GitHub doesn't embed a PM work item ID in the webhook payload
			workItemId: undefined,
			raw,
		};
	}

	async isSelfAuthored(_event: PMWebhookEvent, _projectId: string): Promise<boolean> {
		// Self-authored check is handled upstream in the GitHub router layer.
		// By the time we reach this integration, self-authored events are already filtered.
		return false;
	}

	async postAckComment(
		_projectId: string,
		_workItemId: string,
		_message: string,
	): Promise<string | null> {
		// GitHub ack comments are posted via postAcknowledgmentComment() in ack-comments.ts,
		// which has access to the full TriggerResult (needed for prNumber and repoFullName).
		// This method is part of the interface but not used for GitHub.
		return null;
	}

	async deleteAckComment(
		_projectId: string,
		_workItemId: string,
		_commentId: string,
	): Promise<void> {
		// No-op — GitHub ack comments are managed via the ack-comments module.
	}

	async sendReaction(_projectId: string, _event: PMWebhookEvent): Promise<void> {
		// No-op — GitHub reactions are not part of the PM webhook flow.
	}

	async lookupProject(
		identifier: string,
	): Promise<{ project: ProjectConfig; config: CascadeConfig } | null> {
		const result = await loadProjectConfigByRepo(identifier);
		return result ?? null;
	}

	extractWorkItemId(_text: string): string | null {
		// GitHub webhooks don't embed PM work item IDs in text.
		// PR-to-card linking is handled by the trigger registry.
		return null;
	}

	/**
	 * Returns the GitHub-specific AgentExecutionConfig.
	 *
	 * GitHub agents skip PM lifecycle prepare/failure steps because:
	 * - They are triggered from GitHub PRs, not PM cards
	 * - handleSuccess is only called for 'implementation' (PR merge tracking)
	 * - Failure feedback goes to the PR comment, not the PM card
	 */
	resolveExecutionConfig(): AgentExecutionConfig {
		return {
			skipPrepareForAgent: true,
			skipHandleFailure: true,
			handleSuccessOnlyForAgentType: 'implementation',
			onSuccess: deleteProgressCommentOnSuccess,
			onFailure: updateInitialCommentWithError,
			logLabel: 'GitHub agent',
		};
	}

	// ---------------------------------------------------------------------------
	// Private helpers
	// ---------------------------------------------------------------------------

	private detectEventType(p: Record<string, unknown>): string {
		if (p.pull_request) {
			const action = p.action as string | undefined;
			return action ? `pull_request.${action}` : 'pull_request';
		}
		if (p.review) return 'pull_request_review';
		if (p.comment) return 'pull_request_review_comment';
		if (p.check_suite) return 'check_suite';
		if (p.check_run) return 'check_run';
		return 'unknown';
	}
}
