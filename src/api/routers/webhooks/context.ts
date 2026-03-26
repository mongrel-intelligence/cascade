import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { getAllProjectCredentials } from '../../../config/provider.js';
import { findProjectByIdFromDb } from '../../../db/repositories/configRepository.js';
import { getIntegrationByProjectAndCategory } from '../../../db/repositories/integrationsRepository.js';
import { getJiraConfig, getTrelloConfig } from '../../../pm/config.js';
import { verifyProjectOrgAccess } from '../_shared/projectAccess.js';
import type { ProjectContext } from './types.js';

export async function resolveProjectContext(
	projectId: string,
	userOrgId: string,
): Promise<ProjectContext> {
	// Verify ownership
	await verifyProjectOrgAccess(projectId, userOrgId);

	const project = await findProjectByIdFromDb(projectId);
	if (!project) {
		throw new TRPCError({ code: 'NOT_FOUND' });
	}

	const creds = await getAllProjectCredentials(projectId);

	// Resolve JIRA label names from config (with defaults)
	const jiraConfig = getJiraConfig(project);
	const trelloConfig = getTrelloConfig(project);
	const jiraLabels = jiraConfig
		? [
				jiraConfig.labels?.processing ?? 'cascade-processing',
				jiraConfig.labels?.processed ?? 'cascade-processed',
				jiraConfig.labels?.error ?? 'cascade-error',
				jiraConfig.labels?.readyToProcess ?? 'cascade-ready',
				jiraConfig.labels?.auto ?? 'cascade-auto',
			]
		: undefined;

	// Check if Sentry alerting integration is configured
	const alertingIntegration = await getIntegrationByProjectAndCategory(projectId, 'alerting');
	const sentryConfigured = alertingIntegration?.provider === 'sentry' && !!creds.SENTRY_API_TOKEN;

	return {
		projectId,
		orgId: project.orgId,
		repo: project.repo,
		pmType: project.pm?.type ?? 'trello',
		boardId: trelloConfig?.boardId,
		jiraBaseUrl: jiraConfig?.baseUrl,
		jiraProjectKey: jiraConfig?.projectKey,
		jiraLabels,
		trelloApiKey: creds.TRELLO_API_KEY ?? '',
		trelloToken: creds.TRELLO_TOKEN ?? '',
		githubToken: creds.GITHUB_TOKEN_IMPLEMENTER ?? '',
		jiraEmail: creds.JIRA_EMAIL ?? '',
		jiraApiToken: creds.JIRA_API_TOKEN ?? '',
		webhookSecret: creds.GITHUB_WEBHOOK_SECRET ?? undefined,
		sentryConfigured,
		sentryWebhookSecretSet: !!creds.SENTRY_WEBHOOK_SECRET,
	};
}

export const oneTimeTokensSchema = z
	.object({
		github: z.string().optional(),
		trelloApiKey: z.string().optional(),
		trelloToken: z.string().optional(),
		jiraEmail: z.string().optional(),
		jiraApiToken: z.string().optional(),
	})
	.optional();

export type OneTimeTokens = z.infer<typeof oneTimeTokensSchema>;

export function applyOneTimeTokens(pctx: ProjectContext, tokens: OneTimeTokens): void {
	if (!tokens) return;
	if (tokens.github) pctx.githubToken = tokens.github;
	if (tokens.trelloApiKey) pctx.trelloApiKey = tokens.trelloApiKey;
	if (tokens.trelloToken) pctx.trelloToken = tokens.trelloToken;
	if (tokens.jiraEmail) pctx.jiraEmail = tokens.jiraEmail;
	if (tokens.jiraApiToken) pctx.jiraApiToken = tokens.jiraApiToken;
}
