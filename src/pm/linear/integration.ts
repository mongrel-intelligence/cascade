/**
 * LinearIntegration — implements PMIntegration for Linear.
 *
 * Encapsulates all Linear-specific concerns: credential resolution,
 * webhook parsing, ack comments, reactions, project lookup, and work item ID
 * extraction.
 *
 * Credential roles are self-registered at module load time via
 * registerCredentialRoles(), so no changes to integrationRoles.ts are needed.
 */

import {
	PROVIDER_CREDENTIAL_ROLES,
	registerCredentialRoles,
} from '../../config/integrationRoles.js';
import {
	getIntegrationCredential,
	getIntegrationCredentialOrNull,
	loadProjectConfigByLinearTeamId,
} from '../../config/provider.js';
import { getIntegrationProvider } from '../../db/repositories/credentialsRepository.js';
import { withLinearCredentials } from '../../linear/client.js';
import type { CascadeConfig, ProjectConfig } from '../../types/index.js';
import { getLinearConfig } from '../config.js';
import type { PMIntegration, PMWebhookEvent } from '../integration.js';
import type { ProjectPMConfig } from '../lifecycle.js';
import type { PMProvider } from '../types.js';
import { LinearPMProvider } from './adapter.js';

// Self-register credential roles at module load time.
// This is idempotent — safe to call multiple times.
registerCredentialRoles('linear', 'pm', [
	{ role: 'api_key', label: 'API Key', envVarKey: 'LINEAR_API_KEY' },
	{
		role: 'webhook_secret',
		label: 'Webhook Secret',
		envVarKey: 'LINEAR_WEBHOOK_SECRET',
		optional: true,
	},
]);

// Linear issue identifier pattern: TEAM-123
const LINEAR_ISSUE_KEY_REGEX = /\b([A-Z][A-Z0-9]+-\d+)\b/;

export class LinearIntegration implements PMIntegration {
	readonly type = 'linear';
	readonly category = 'pm' as const;

	async hasIntegration(projectId: string): Promise<boolean> {
		const provider = await getIntegrationProvider(projectId, 'pm');
		if (provider !== 'linear') return false;

		const roles = PROVIDER_CREDENTIAL_ROLES.linear;
		const requiredRoles = roles.filter((r) => !r.optional);
		const values = await Promise.all(
			requiredRoles.map((roleDef) => getIntegrationCredentialOrNull(projectId, 'pm', roleDef.role)),
		);
		return values.every((v) => v !== null);
	}

	createProvider(project: ProjectConfig): PMProvider {
		const linearConfig = getLinearConfig(project);
		if (!linearConfig?.teamId) {
			throw new Error('Linear integration requires teamId in config');
		}
		return new LinearPMProvider(linearConfig);
	}

	async withCredentials<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
		const apiKey = await getIntegrationCredential(projectId, 'pm', 'api_key');
		return withLinearCredentials({ apiKey }, fn);
	}

	resolveLifecycleConfig(project: ProjectConfig): ProjectPMConfig {
		const linearConfig = getLinearConfig(project);
		const labels = linearConfig?.labels;
		return {
			labels: {
				processing: labels?.processing ?? 'cascade-processing',
				processed: labels?.processed ?? 'cascade-processed',
				error: labels?.error ?? 'cascade-error',
				readyToProcess: labels?.readyToProcess ?? 'cascade-ready',
				auto: labels?.auto ?? 'cascade-auto',
			},
			statuses: {
				backlog: linearConfig?.statuses?.backlog,
				inProgress: linearConfig?.statuses?.inProgress,
				inReview: linearConfig?.statuses?.inReview,
				done: linearConfig?.statuses?.done,
				merged: linearConfig?.statuses?.merged,
			},
		};
	}

	parseWebhookPayload(raw: unknown): PMWebhookEvent | null {
		if (!raw || typeof raw !== 'object') return null;
		const p = raw as Record<string, unknown>;

		// Linear webhook shape: { action, type, data, organizationId, ... }
		const action = p.action as string | undefined;
		const type = p.type as string | undefined;
		if (typeof action !== 'string' || typeof type !== 'string') return null;

		const data = p.data as Record<string, unknown> | undefined;
		if (!data) return null;

		// The event type is "<type>.<action>" e.g. "Issue.create", "Comment.create"
		const eventType = `${type}.${action}`;

		// For Issue events, data.teamId is the project identifier
		// For Comment events, the issue identifier is in data.issue.identifier
		let projectIdentifier: string | undefined;
		let workItemId: string | undefined;

		if (type === 'Issue') {
			projectIdentifier = data.teamId as string | undefined;
			workItemId = (data.identifier as string | undefined) ?? (data.id as string | undefined);
		} else if (type === 'Comment') {
			const issue = data.issue as Record<string, unknown> | undefined;
			projectIdentifier = issue?.teamId as string | undefined;
			workItemId = (issue?.identifier as string | undefined) ?? (issue?.id as string | undefined);
		} else {
			// For other event types, try to find a teamId in data
			projectIdentifier = data.teamId as string | undefined;
		}

		if (!projectIdentifier) return null;

		return {
			eventType,
			projectIdentifier,
			workItemId,
			raw,
		};
	}

	async isSelfAuthored(event: PMWebhookEvent, projectId: string): Promise<boolean> {
		// For comment events, check if the comment was authored by the bot user.
		// Linear comments have a userId in the data.
		if (!event.eventType.startsWith('Comment.')) return false;

		const p = event.raw as Record<string, unknown>;
		const data = p.data as Record<string, unknown> | undefined;
		const commentUserId = data?.userId as string | undefined;
		if (!commentUserId) return false;

		try {
			// Get the authenticated user to compare — credentials must be in scope.
			const apiKey = await getIntegrationCredential(projectId, 'pm', 'api_key');
			const { linearClient } = await import('../../linear/client.js');
			const me = await withLinearCredentials({ apiKey }, () => linearClient.getMe());
			return me.id === commentUserId;
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
			const apiKey = await getIntegrationCredential(projectId, 'pm', 'api_key');
			return await withLinearCredentials({ apiKey }, async () => {
				const { linearClient } = await import('../../linear/client.js');
				const comment = await linearClient.createComment(workItemId, message);
				return comment.id;
			});
		} catch (err) {
			const { logger } = await import('../../utils/logging.js');
			logger.warn('[Linear] Failed to post ack comment', {
				projectId,
				workItemId,
				error: String(err),
			});
			return null;
		}
	}

	async deleteAckComment(projectId: string, _workItemId: string, commentId: string): Promise<void> {
		try {
			const apiKey = await getIntegrationCredential(projectId, 'pm', 'api_key');
			await withLinearCredentials({ apiKey }, async () => {
				const { linearClient } = await import('../../linear/client.js');
				await linearClient.deleteComment(commentId);
			});
		} catch (err) {
			const { logger } = await import('../../utils/logging.js');
			logger.warn('[Linear] Failed to delete ack comment', {
				projectId,
				commentId,
				error: String(err),
			});
		}
	}

	async sendReaction(_projectId: string, _event: PMWebhookEvent): Promise<void> {
		// Linear reactions require a dedicated API call with credentials.
		// Reactions are optional in the PMIntegration interface — no-op for now.
	}

	async lookupProject(
		identifier: string,
	): Promise<{ project: ProjectConfig; config: CascadeConfig } | null> {
		return (await loadProjectConfigByLinearTeamId(identifier)) ?? null;
	}

	extractWorkItemId(text: string): string | null {
		// Linear issue identifiers follow the same TEAM-123 pattern as JIRA.
		// Also check Linear URLs: https://linear.app/org/issue/TEAM-123
		const urlMatch = text.match(/https:\/\/linear\.app\/[^/]+\/issue\/([A-Z][A-Z0-9]+-\d+)/);
		if (urlMatch) return urlMatch[1];

		const match = text.match(LINEAR_ISSUE_KEY_REGEX);
		return match ? match[1] : null;
	}
}
