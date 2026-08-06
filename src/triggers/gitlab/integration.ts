/**
 * GitLabWebhookIntegration — adapts GitLab webhooks to the PMIntegration interface.
 *
 * Mirrors GitHubWebhookIntegration: project lookup by path_with_namespace,
 * persona token credential scoping, and GitLab-specific AgentExecutionConfig.
 */

import { loadProjectConfigByRepo } from '../../config/provider.js';
import { withGitHubToken } from '../../github/client.js';
import { getPersonaToken } from '../../github/personas.js';
import type { PMIntegration, PMWebhookEvent } from '../../pm/integration.js';
import type { ProjectPMConfig } from '../../pm/lifecycle.js';
import type { PMProvider } from '../../pm/types.js';
import type { CascadeConfig, ProjectConfig } from '../../types/index.js';
import type { AgentExecutionConfig } from '../shared/agent-execution.js';
import { deleteProgressNoteOnSuccess, updateInitialNoteWithError } from './ack-comments.js';

export class GitLabWebhookIntegration implements PMIntegration {
	readonly type = 'gitlab';
	readonly category = 'pm' as const;

	async hasIntegration(_projectId: string): Promise<boolean> {
		return false;
	}

	createProvider(_project: ProjectConfig): PMProvider {
		throw new Error(
			'GitLabWebhookIntegration does not use a PM provider. ' +
				'Use integration.withCredentials() and runAgentExecutionPipeline() directly.',
		);
	}

	async withCredentials<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
		const githubToken = await getPersonaToken(projectId, 'implementation');
		return withGitHubToken(githubToken, fn);
	}

	resolveLifecycleConfig(_project: ProjectConfig): ProjectPMConfig {
		return {
			labels: {},
			statuses: {},
		};
	}

	parseWebhookPayload(raw: unknown): PMWebhookEvent | null {
		if (!raw || typeof raw !== 'object') return null;
		const p = raw as Record<string, unknown>;
		const project = p.project as Record<string, unknown> | undefined;
		const pathWithNamespace = project?.path_with_namespace as string | undefined;

		if (!pathWithNamespace) {
			return null;
		}

		const eventType = this.detectEventType(p);

		return {
			eventType,
			projectIdentifier: pathWithNamespace,
			workItemId: undefined,
			raw,
		};
	}

	async isSelfAuthored(_event: PMWebhookEvent, _projectId: string): Promise<boolean> {
		return false;
	}

	async postAckComment(
		_projectId: string,
		_workItemId: string,
		_message: string,
	): Promise<string | null> {
		return null;
	}

	async deleteAckComment(
		_projectId: string,
		_workItemId: string,
		_commentId: string,
	): Promise<void> {
		// No-op
	}

	async sendReaction(_projectId: string, _event: PMWebhookEvent): Promise<void> {
		// No-op
	}

	async lookupProject(
		identifier: string,
	): Promise<{ project: ProjectConfig; config: CascadeConfig } | null> {
		const result = await loadProjectConfigByRepo(identifier);
		return result ?? null;
	}

	extractWorkItemId(_text: string): string | null {
		return null;
	}

	resolveExecutionConfig(): AgentExecutionConfig {
		return {
			skipPrepareForAgent: true,
			skipHandleFailure: true,
			handleSuccessOnlyForAgentType: 'implementation',
			onSuccess: deleteProgressNoteOnSuccess,
			onFailure: updateInitialNoteWithError,
			logLabel: 'GitLab agent',
		};
	}

	// ---------------------------------------------------------------------------
	// Private helpers
	// ---------------------------------------------------------------------------

	private detectEventType(p: Record<string, unknown>): string {
		const objectKind = p.object_kind as string | undefined;
		if (objectKind === 'merge_request') {
			const attrs = p.object_attributes as Record<string, unknown> | undefined;
			const action = attrs?.action as string | undefined;
			return action ? `merge_request.${action}` : 'merge_request';
		}
		if (objectKind === 'pipeline') return 'pipeline';
		if (objectKind === 'note') return 'note';
		return objectKind ?? 'unknown';
	}
}
