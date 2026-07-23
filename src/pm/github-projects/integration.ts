/**
 * GitHubProjectsIntegration — implements PMIntegration for GitHub Projects v2.
 */

import { getCredentialRoles, registerCredentialRoles } from '../../config/integrationRoles.js';
import {
	getIntegrationCredential,
	getIntegrationCredentialOrNull,
	loadProjectConfigByGitHubProjectsProjectId,
} from '../../config/provider.js';
import { getIntegrationProvider } from '../../db/repositories/credentialsRepository.js';
import { addCommentToIssue, withGitHubProjectsCredentials } from '../../github-projects/client.js';
import type { CascadeConfig, ProjectConfig } from '../../types/index.js';
import { getGitHubProjectsConfig } from '../config.js';
import type { PMIntegration, PMWebhookEvent } from '../integration.js';
import type { ProjectPMConfig } from '../lifecycle.js';
import type { PMProvider } from '../types.js';
import { GitHubProjectsPMProvider } from './adapter.js';

// Self-register credential roles at module load time.
//
// The `token` role uses a provider-specific env-var key (GITHUB_PROJECTS_TOKEN)
// rather than the SCM `GITHUB_TOKEN` for two reasons:
//   1. The worker's `secretOrchestrator` overwrites `GITHUB_TOKEN` with the SCM
//      persona token (implementer/reviewer) for every agent whose profile
//      `needsGitHubToken`. Sharing the key would clobber the configured PM PAT,
//      so agent-invoked `cascade-tools pm` calls would run as the SCM identity
//      (GitHub Projects v2 has a permission model separate from repo scope, so
//      that silently 403s). A dedicated key survives the persona override.
//   2. Credential rows are keyed only by (projectId, envVarKey), so `GITHUB_TOKEN`
//      / `GITHUB_WEBHOOK_SECRET` would collide with a co-configured GitHub SCM
//      integration. Provider-specific keys keep the two integrations distinct.
registerCredentialRoles('github-projects', 'pm', [
	{ role: 'token', label: 'Personal Access Token', envVarKey: 'GITHUB_PROJECTS_TOKEN' },
	{
		role: 'webhook_secret',
		label: 'Webhook Secret',
		envVarKey: 'GITHUB_PROJECTS_WEBHOOK_SECRET',
		optional: true,
	},
]);

export class GitHubProjectsIntegration implements PMIntegration {
	readonly type = 'github-projects';
	readonly category = 'pm' as const;

	async hasIntegration(projectId: string): Promise<boolean> {
		const provider = await getIntegrationProvider(projectId, 'pm');
		if (provider !== 'github-projects') return false;

		const roles = getCredentialRoles('github-projects');
		const requiredRoles = roles.filter((r) => !r.optional);
		const values = await Promise.all(
			requiredRoles.map((roleDef) =>
				getIntegrationCredentialOrNull(projectId, 'pm', 'github-projects', roleDef.role),
			),
		);
		return values.every((v) => v !== null);
	}

	createProvider(project: ProjectConfig): PMProvider {
		const config = getGitHubProjectsConfig(project);
		if (!config?.projectId) {
			throw new Error('GitHub Projects integration requires projectId in config');
		}
		// Pass the project's SCM repo (owner/repo) so createWorkItem can create the
		// backing Issue there — a GitHub Project has no repo of its own in PM config.
		return new GitHubProjectsPMProvider(config, project.repo);
	}

	async withCredentials<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
		const token = await getIntegrationCredential(projectId, 'pm', 'github-projects', 'token');
		return withGitHubProjectsCredentials({ token }, fn);
	}

	resolveLifecycleConfig(project: ProjectConfig): ProjectPMConfig {
		const config = getGitHubProjectsConfig(project);
		const labels = config?.labels;
		return {
			labels: {
				processing: labels?.processing,
				processed: undefined,
				error: undefined,
				readyToProcess: labels?.readyToProcess,
				auto: undefined,
			},
			statuses: { ...(config?.statuses ?? {}) },
		};
	}

	parseWebhookPayload(raw: unknown): PMWebhookEvent | null {
		if (!raw || typeof raw !== 'object') return null;
		const p = raw as Record<string, unknown>;

		// GitHub Projects v2 webhooks: action + projects_v2_item
		const action = p.action as string | undefined;
		const projectsV2Item = p.projects_v2_item as Record<string, unknown> | undefined;
		if (typeof action !== 'string' || !projectsV2Item) return null;

		const projectNodeId = projectsV2Item.project_node_id as string | undefined;
		const contentNodeId = projectsV2Item.content_node_id as string | undefined;
		if (!projectNodeId) return null;

		return {
			eventType: `projects_v2_item.${action}`,
			projectIdentifier: projectNodeId,
			workItemId: contentNodeId,
			raw,
		};
	}

	async isSelfAuthored(event: PMWebhookEvent, projectId: string): Promise<boolean> {
		// Only comment events can be self-authored; GitHub Projects item events are not.
		if (!event.eventType.startsWith('projects_v2_item.')) return false;

		const p = event.raw as Record<string, unknown>;
		const sender = p.sender as Record<string, unknown> | undefined;
		const senderLogin = sender?.login as string | undefined;
		if (!senderLogin) return false;

		try {
			const token = await getIntegrationCredential(projectId, 'pm', 'github-projects', 'token');
			const { getViewer } = await import('../../github-projects/client.js');
			const me = await withGitHubProjectsCredentials({ token }, () => getViewer());
			return me.login === senderLogin;
		} catch {
			return false;
		}
	}

	async postAckComment(
		projectId: string,
		workItemId: string,
		message: string,
	): Promise<string | null> {
		try {
			const token = await getIntegrationCredential(projectId, 'pm', 'github-projects', 'token');
			return await withGitHubProjectsCredentials({ token }, () =>
				addCommentToIssue(workItemId, message),
			);
		} catch (err) {
			const { logger } = await import('../../utils/logging.js');
			logger.warn('[GitHubProjects] Failed to post ack comment', {
				projectId,
				workItemId,
				error: String(err),
			});
			return null;
		}
	}

	async deleteAckComment(projectId: string, _workItemId: string, commentId: string): Promise<void> {
		try {
			const token = await getIntegrationCredential(projectId, 'pm', 'github-projects', 'token');
			await withGitHubProjectsCredentials({ token }, async () => {
				const { deleteComment } = await import('../../github-projects/client.js');
				await deleteComment(commentId);
			});
		} catch (err) {
			const { logger } = await import('../../utils/logging.js');
			logger.warn('[GitHubProjects] Failed to delete ack comment', {
				projectId,
				commentId,
				error: String(err),
			});
		}
	}

	async sendReaction(_projectId: string, _event: PMWebhookEvent): Promise<void> {
		// GitHub Projects item webhooks do not support reactions; no-op.
	}

	async lookupProject(
		identifier: string,
	): Promise<{ project: ProjectConfig; config: CascadeConfig } | null> {
		return (await loadProjectConfigByGitHubProjectsProjectId(identifier)) ?? null;
	}

	extractWorkItemId(text: string): string | null {
		// GitHub issue/PR URLs: https://github.com/owner/repo/issues/123 or /pull/123
		const issueMatch = text.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/);
		if (issueMatch) return issueMatch[1];
		const prMatch = text.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
		if (prMatch) return prMatch[1];
		return null;
	}
}
