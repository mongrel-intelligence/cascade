import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../db/client.js';
import { decryptCredential } from '../../db/crypto.js';
import { credentials } from '../../db/schema/index.js';
import { jiraClient, withJiraCredentials } from '../../jira/client.js';
import { trelloClient, withTrelloCredentials } from '../../trello/client.js';
import { logger } from '../../utils/logging.js';
import { protectedProcedure, router } from '../trpc.js';
import { wrapIntegrationCall } from './_shared/integrationErrors.js';

async function resolveCredentialValue(credentialId: number, orgId: string): Promise<string> {
	const db = getDb();
	const [cred] = await db
		.select({ orgId: credentials.orgId, value: credentials.value })
		.from(credentials)
		.where(eq(credentials.id, credentialId));
	if (!cred || cred.orgId !== orgId) {
		throw new TRPCError({ code: 'NOT_FOUND', message: `Credential ${credentialId} not found` });
	}
	return decryptCredential(cred.value, cred.orgId);
}

const trelloCredsInput = z.object({
	apiKeyCredentialId: z.number(),
	tokenCredentialId: z.number(),
});

const jiraCredsInput = z.object({
	emailCredentialId: z.number(),
	apiTokenCredentialId: z.number(),
	baseUrl: z.string().url(),
});

async function resolveTrelloCreds(input: z.infer<typeof trelloCredsInput>, orgId: string) {
	const [apiKey, token] = await Promise.all([
		resolveCredentialValue(input.apiKeyCredentialId, orgId),
		resolveCredentialValue(input.tokenCredentialId, orgId),
	]);
	return { apiKey, token };
}

async function resolveJiraCreds(input: z.infer<typeof jiraCredsInput>, orgId: string) {
	const [email, apiToken] = await Promise.all([
		resolveCredentialValue(input.emailCredentialId, orgId),
		resolveCredentialValue(input.apiTokenCredentialId, orgId),
	]);
	return { email, apiToken, baseUrl: input.baseUrl };
}

async function withResolvedTrelloCreds<T>(
	input: z.infer<typeof trelloCredsInput>,
	orgId: string,
	label: string,
	fn: (creds: { apiKey: string; token: string }) => Promise<T>,
): Promise<T> {
	const creds = await resolveTrelloCreds(input, orgId);
	return wrapIntegrationCall(label, () => fn(creds));
}

async function withResolvedJiraCreds<T>(
	input: z.infer<typeof jiraCredsInput>,
	orgId: string,
	label: string,
	fn: (creds: { email: string; apiToken: string; baseUrl: string }) => Promise<T>,
): Promise<T> {
	const creds = await resolveJiraCreds(input, orgId);
	return wrapIntegrationCall(label, () => fn(creds));
}

export const integrationsDiscoveryRouter = router({
	verifyTrello: protectedProcedure.input(trelloCredsInput).mutation(async ({ ctx, input }) => {
		logger.debug('integrationsDiscovery.verifyTrello called', { orgId: ctx.effectiveOrgId });
		return withResolvedTrelloCreds(
			input,
			ctx.effectiveOrgId,
			'Failed to verify Trello credentials',
			(creds) =>
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
		return withResolvedJiraCreds(
			input,
			ctx.effectiveOrgId,
			'Failed to verify JIRA credentials',
			(creds) =>
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
		return withResolvedTrelloCreds(
			input,
			ctx.effectiveOrgId,
			'Failed to fetch Trello boards',
			(creds) => withTrelloCredentials(creds, () => trelloClient.getBoards()),
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
			return withResolvedTrelloCreds(
				input,
				ctx.effectiveOrgId,
				'Failed to fetch Trello board details',
				(creds) =>
					withTrelloCredentials(creds, () =>
						Promise.all([
							trelloClient.getBoardLists(input.boardId),
							trelloClient.getBoardLabels(input.boardId),
							trelloClient.getBoardCustomFields(input.boardId),
						]).then(([lists, labels, customFields]) => ({ lists, labels, customFields })),
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
			return withResolvedTrelloCreds(
				input,
				ctx.effectiveOrgId,
				'Failed to create Trello label',
				(creds) =>
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
			const creds = await resolveTrelloCreds(input, ctx.effectiveOrgId);

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
			return withResolvedTrelloCreds(
				input,
				ctx.effectiveOrgId,
				'Failed to create Trello custom field',
				(creds) =>
					withTrelloCredentials(creds, () =>
						trelloClient.createBoardCustomField(input.boardId, input.name, input.type),
					),
			);
		}),

	jiraProjects: protectedProcedure.input(jiraCredsInput).mutation(async ({ ctx, input }) => {
		logger.debug('integrationsDiscovery.jiraProjects called', { orgId: ctx.effectiveOrgId });
		return withResolvedJiraCreds(
			input,
			ctx.effectiveOrgId,
			'Failed to fetch JIRA projects',
			(creds) => withJiraCredentials(creds, () => jiraClient.searchProjects()),
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
			return withResolvedJiraCreds(
				input,
				ctx.effectiveOrgId,
				'Failed to fetch JIRA project details',
				(creds) =>
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
			return withResolvedJiraCreds(
				input,
				ctx.effectiveOrgId,
				'Failed to create JIRA custom field',
				(creds) =>
					withJiraCredentials(creds, () =>
						jiraClient.createCustomField(
							input.name,
							'com.atlassian.jira.plugin.system.customfieldtypes:float',
						),
					),
			);
		}),
});
