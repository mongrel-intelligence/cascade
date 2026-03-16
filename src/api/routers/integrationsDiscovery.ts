import { Octokit } from '@octokit/rest';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { getIntegrationCredentialOrNull } from '../../config/provider.js';
import { getIntegrationByProjectAndCategory } from '../../db/repositories/integrationsRepository.js';
import { jiraClient, withJiraCredentials } from '../../jira/client.js';
import { trelloClient, withTrelloCredentials } from '../../trello/client.js';
import { logger } from '../../utils/logging.js';
import { protectedProcedure, router } from '../trpc.js';
import { wrapIntegrationCall } from './_shared/integrationErrors.js';
import { verifyProjectOrgAccess } from './_shared/projectAccess.js';

/**
 * Raw-value credential schemas.
 * Verification endpoints now accept plaintext credential values directly from the form
 * instead of credential IDs. This enables the PM wizard to verify credentials inline
 * before persisting them.
 */
const trelloCredsInput = z.object({
	apiKey: z.string().min(1),
	token: z.string().min(1),
});

const jiraCredsInput = z.object({
	email: z.string().min(1),
	apiToken: z.string().min(1),
	baseUrl: z.string().url(),
});

async function withTrelloCreds<T>(
	input: z.infer<typeof trelloCredsInput>,
	label: string,
	fn: (creds: { apiKey: string; token: string }) => Promise<T>,
): Promise<T> {
	return wrapIntegrationCall(label, () => fn({ apiKey: input.apiKey, token: input.token }));
}

async function withJiraCreds<T>(
	input: z.infer<typeof jiraCredsInput>,
	label: string,
	fn: (creds: { email: string; apiToken: string; baseUrl: string }) => Promise<T>,
): Promise<T> {
	return wrapIntegrationCall(label, () =>
		fn({ email: input.email, apiToken: input.apiToken, baseUrl: input.baseUrl }),
	);
}

export const integrationsDiscoveryRouter = router({
	verifyTrello: protectedProcedure.input(trelloCredsInput).mutation(async ({ ctx, input }) => {
		logger.debug('integrationsDiscovery.verifyTrello called', { orgId: ctx.effectiveOrgId });
		return withTrelloCreds(input, 'Failed to verify Trello credentials', (creds) =>
			withTrelloCredentials(creds, () =>
				trelloClient.getMe().then((me) => ({
					id: me.id,
					fullName: me.fullName,
					username: me.username,
				})),
			),
		);
	}),

	verifyJira: protectedProcedure.input(jiraCredsInput).mutation(async ({ ctx, input }) => {
		logger.debug('integrationsDiscovery.verifyJira called', { orgId: ctx.effectiveOrgId });
		return withJiraCreds(input, 'Failed to verify JIRA credentials', (creds) =>
			withJiraCredentials(creds, () =>
				jiraClient.getMyself().then((me) => ({
					displayName: (me as { displayName?: string }).displayName ?? '',
					emailAddress: (me as { emailAddress?: string }).emailAddress ?? '',
					accountId: (me as { accountId?: string }).accountId ?? '',
				})),
			),
		);
	}),

	trelloBoards: protectedProcedure.input(trelloCredsInput).mutation(async ({ ctx, input }) => {
		logger.debug('integrationsDiscovery.trelloBoards called', { orgId: ctx.effectiveOrgId });
		return withTrelloCreds(input, 'Failed to fetch Trello boards', (creds) =>
			withTrelloCredentials(creds, () => trelloClient.getBoards()),
		);
	}),

	trelloBoardDetails: protectedProcedure
		.input(
			trelloCredsInput.extend({
				boardId: z
					.string()
					.regex(/^[a-zA-Z0-9]+$/)
					.max(32),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			logger.debug('integrationsDiscovery.trelloBoardDetails called', {
				orgId: ctx.effectiveOrgId,
				boardId: input.boardId,
			});
			return withTrelloCreds(input, 'Failed to fetch Trello board details', (creds) =>
				withTrelloCredentials(creds, () =>
					Promise.all([
						trelloClient.getBoardLists(input.boardId),
						trelloClient.getBoardLabels(input.boardId),
						trelloClient.getBoardCustomFields(input.boardId),
					]).then(([lists, labels, customFields]) => ({ lists, labels, customFields })),
				),
			);
		}),

	trelloBoardsByProject: protectedProcedure
		.input(z.object({ projectId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			logger.debug('integrationsDiscovery.trelloBoardsByProject called', {
				orgId: ctx.effectiveOrgId,
				projectId: input.projectId,
			});
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
			const apiKey = await getIntegrationCredentialOrNull(input.projectId, 'pm', 'api_key');
			const token = await getIntegrationCredentialOrNull(input.projectId, 'pm', 'token');
			if (!apiKey || !token) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Trello credentials not configured' });
			}
			return wrapIntegrationCall('Failed to fetch Trello boards', () =>
				withTrelloCredentials({ apiKey, token }, () => trelloClient.getBoards()),
			);
		}),

	trelloBoardDetailsByProject: protectedProcedure
		.input(
			z.object({
				projectId: z.string(),
				boardId: z
					.string()
					.regex(/^[a-zA-Z0-9]+$/)
					.max(32),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			logger.debug('integrationsDiscovery.trelloBoardDetailsByProject called', {
				orgId: ctx.effectiveOrgId,
				projectId: input.projectId,
				boardId: input.boardId,
			});
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
			const apiKey = await getIntegrationCredentialOrNull(input.projectId, 'pm', 'api_key');
			const token = await getIntegrationCredentialOrNull(input.projectId, 'pm', 'token');
			if (!apiKey || !token) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Trello credentials not configured' });
			}
			return wrapIntegrationCall('Failed to fetch Trello board details', () =>
				withTrelloCredentials({ apiKey, token }, () =>
					Promise.all([
						trelloClient.getBoardLists(input.boardId),
						trelloClient.getBoardLabels(input.boardId),
						trelloClient.getBoardCustomFields(input.boardId),
					]).then(([lists, labels, customFields]) => ({ lists, labels, customFields })),
				),
			);
		}),

	jiraProjectsByProject: protectedProcedure
		.input(z.object({ projectId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			logger.debug('integrationsDiscovery.jiraProjectsByProject called', {
				orgId: ctx.effectiveOrgId,
				projectId: input.projectId,
			});
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
			const email = await getIntegrationCredentialOrNull(input.projectId, 'pm', 'email');
			const apiToken = await getIntegrationCredentialOrNull(input.projectId, 'pm', 'api_token');
			const integration = await getIntegrationByProjectAndCategory(input.projectId, 'pm');
			const baseUrl = (integration?.config as Record<string, unknown> | null)?.baseUrl as
				| string
				| undefined;
			if (!email || !apiToken || !baseUrl) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'JIRA credentials not configured' });
			}
			return wrapIntegrationCall('Failed to fetch JIRA projects', () =>
				withJiraCredentials({ email, apiToken, baseUrl }, () => jiraClient.searchProjects()),
			);
		}),

	jiraProjectDetailsByProject: protectedProcedure
		.input(
			z.object({
				projectId: z.string(),
				projectKey: z
					.string()
					.regex(/^[A-Z][A-Z0-9_]+$/)
					.max(10),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			logger.debug('integrationsDiscovery.jiraProjectDetailsByProject called', {
				orgId: ctx.effectiveOrgId,
				projectId: input.projectId,
				projectKey: input.projectKey,
			});
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
			const email = await getIntegrationCredentialOrNull(input.projectId, 'pm', 'email');
			const apiToken = await getIntegrationCredentialOrNull(input.projectId, 'pm', 'api_token');
			const integration = await getIntegrationByProjectAndCategory(input.projectId, 'pm');
			const baseUrl = (integration?.config as Record<string, unknown> | null)?.baseUrl as
				| string
				| undefined;
			if (!email || !apiToken || !baseUrl) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'JIRA credentials not configured' });
			}
			return wrapIntegrationCall('Failed to fetch JIRA project details', () =>
				withJiraCredentials({ email, apiToken, baseUrl }, () =>
					Promise.all([
						jiraClient.getProjectStatuses(input.projectKey),
						jiraClient.getIssueTypesForProject(input.projectKey),
						jiraClient.getFields(),
					]).then(([statuses, issueTypes, fields]) => ({
						statuses,
						issueTypes,
						fields: fields.filter((f) => f.custom),
					})),
				),
			);
		}),

	createTrelloLabel: protectedProcedure
		.input(
			trelloCredsInput.extend({
				boardId: z
					.string()
					.regex(/^[a-zA-Z0-9]+$/)
					.max(32),
				name: z.string().min(1).max(100),
				color: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			logger.debug('integrationsDiscovery.createTrelloLabel called', {
				orgId: ctx.effectiveOrgId,
				boardId: input.boardId,
				name: input.name,
			});
			return withTrelloCreds(input, 'Failed to create Trello label', (creds) =>
				withTrelloCredentials(creds, () =>
					trelloClient.createBoardLabel(input.boardId, input.name, input.color),
				),
			);
		}),

	createTrelloLabels: protectedProcedure
		.input(
			trelloCredsInput.extend({
				boardId: z
					.string()
					.regex(/^[a-zA-Z0-9]+$/)
					.max(32),
				labels: z
					.array(
						z.object({
							name: z.string().min(1).max(100),
							color: z.string().optional(),
						}),
					)
					.min(1)
					.max(10),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			logger.debug('integrationsDiscovery.createTrelloLabels called', {
				orgId: ctx.effectiveOrgId,
				boardId: input.boardId,
				count: input.labels.length,
			});
			const creds = { apiKey: input.apiKey, token: input.token };

			const results = await Promise.allSettled(
				input.labels.map((label) =>
					withTrelloCredentials(creds, () =>
						trelloClient.createBoardLabel(input.boardId, label.name, label.color),
					),
				),
			);

			const successes: Array<{ id: string; name: string; color: string }> = [];
			const errors: Array<{ name: string; error: string }> = [];

			for (let i = 0; i < results.length; i++) {
				const result = results[i];
				if (result.status === 'fulfilled') {
					successes.push(result.value);
				} else {
					errors.push({
						name: input.labels[i].name,
						error: result.reason instanceof Error ? result.reason.message : String(result.reason),
					});
				}
			}

			return { successes, errors };
		}),

	createTrelloCustomField: protectedProcedure
		.input(
			trelloCredsInput.extend({
				boardId: z
					.string()
					.regex(/^[a-zA-Z0-9]+$/)
					.max(32),
				name: z.string().min(1).max(100),
				type: z.enum(['number', 'text', 'checkbox', 'date', 'list']),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			logger.debug('integrationsDiscovery.createTrelloCustomField called', {
				orgId: ctx.effectiveOrgId,
				boardId: input.boardId,
				name: input.name,
				type: input.type,
			});
			return withTrelloCreds(input, 'Failed to create Trello custom field', (creds) =>
				withTrelloCredentials(creds, () =>
					trelloClient.createBoardCustomField(input.boardId, input.name, input.type),
				),
			);
		}),

	jiraProjects: protectedProcedure.input(jiraCredsInput).mutation(async ({ ctx, input }) => {
		logger.debug('integrationsDiscovery.jiraProjects called', { orgId: ctx.effectiveOrgId });
		return withJiraCreds(input, 'Failed to fetch JIRA projects', (creds) =>
			withJiraCredentials(creds, () => jiraClient.searchProjects()),
		);
	}),

	jiraProjectDetails: protectedProcedure
		.input(
			jiraCredsInput.extend({
				projectKey: z
					.string()
					.regex(/^[A-Z][A-Z0-9_]+$/)
					.max(10),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			logger.debug('integrationsDiscovery.jiraProjectDetails called', {
				orgId: ctx.effectiveOrgId,
				projectKey: input.projectKey,
			});
			return withJiraCreds(input, 'Failed to fetch JIRA project details', (creds) =>
				withJiraCredentials(creds, () =>
					Promise.all([
						jiraClient.getProjectStatuses(input.projectKey),
						jiraClient.getIssueTypesForProject(input.projectKey),
						jiraClient.getFields(),
					]).then(([statuses, issueTypes, fields]) => ({
						statuses,
						issueTypes,
						fields: fields.filter((f) => f.custom),
					})),
				),
			);
		}),

	createJiraCustomField: protectedProcedure
		.input(
			jiraCredsInput.extend({
				name: z.string().min(1).max(100),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			logger.debug('integrationsDiscovery.createJiraCustomField called', {
				orgId: ctx.effectiveOrgId,
				name: input.name,
			});
			return withJiraCreds(input, 'Failed to create JIRA custom field', (creds) =>
				withJiraCredentials(creds, () =>
					jiraClient.createCustomField(
						input.name,
						'com.atlassian.jira.plugin.system.customfieldtypes:float',
						// exactnumber searcher enables JQL queries like `"Cost" > 100`
						'com.atlassian.jira.plugin.system.customfieldtypes:exactnumber',
					),
				),
			);
		}),

	/**
	 * Verify a raw GitHub token (not a stored credential ID).
	 * Used by the Integrations tab SCM credential inputs.
	 * Accepts a plaintext token from the form and calls the GitHub API to resolve the login.
	 * The token is never stored by this endpoint.
	 */
	verifyGithubToken: protectedProcedure
		.input(z.object({ token: z.string().min(1) }))
		.mutation(async ({ input }) => {
			try {
				const octokit = new Octokit({ auth: input.token });
				const { data } = await octokit.users.getAuthenticated();
				return { login: data.login, avatarUrl: data.avatar_url };
			} catch (err) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: `Failed to verify GitHub token: ${err instanceof Error ? err.message : String(err)}`,
				});
			}
		}),
});
