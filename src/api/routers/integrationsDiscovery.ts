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

export const integrationsDiscoveryRouter = router({
	verifyTrello: protectedProcedure.input(trelloCredsInput).mutation(async ({ ctx, input }) => {
		logger.debug('integrationsDiscovery.verifyTrello called', { orgId: ctx.effectiveOrgId });
		const creds = await resolveTrelloCreds(input, ctx.effectiveOrgId);

		try {
			const me = await withTrelloCredentials(creds, () => trelloClient.getMe());
			return { id: me.id, fullName: me.fullName, username: me.username };
		} catch (err) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: `Failed to verify Trello credentials: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
	}),

	verifyJira: protectedProcedure.input(jiraCredsInput).mutation(async ({ ctx, input }) => {
		logger.debug('integrationsDiscovery.verifyJira called', { orgId: ctx.effectiveOrgId });
		const creds = await resolveJiraCreds(input, ctx.effectiveOrgId);

		try {
			const me = await withJiraCredentials(creds, () => jiraClient.getMyself());
			return {
				displayName: (me as { displayName?: string }).displayName ?? '',
				emailAddress: (me as { emailAddress?: string }).emailAddress ?? '',
				accountId: (me as { accountId?: string }).accountId ?? '',
			};
		} catch (err) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: `Failed to verify JIRA credentials: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
	}),

	trelloBoards: protectedProcedure.input(trelloCredsInput).mutation(async ({ ctx, input }) => {
		logger.debug('integrationsDiscovery.trelloBoards called', { orgId: ctx.effectiveOrgId });
		const creds = await resolveTrelloCreds(input, ctx.effectiveOrgId);

		try {
			return await withTrelloCredentials(creds, () => trelloClient.getBoards());
		} catch (err) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: `Failed to fetch Trello boards: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
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
			const creds = await resolveTrelloCreds(input, ctx.effectiveOrgId);

			try {
				const [lists, labels, customFields] = await withTrelloCredentials(creds, () =>
					Promise.all([
						trelloClient.getBoardLists(input.boardId),
						trelloClient.getBoardLabels(input.boardId),
						trelloClient.getBoardCustomFields(input.boardId),
					]),
				);
				return { lists, labels, customFields };
			} catch (err) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: `Failed to fetch Trello board details: ${err instanceof Error ? err.message : String(err)}`,
				});
			}
		}),

	jiraProjects: protectedProcedure.input(jiraCredsInput).mutation(async ({ ctx, input }) => {
		logger.debug('integrationsDiscovery.jiraProjects called', { orgId: ctx.effectiveOrgId });
		const creds = await resolveJiraCreds(input, ctx.effectiveOrgId);

		try {
			return await withJiraCredentials(creds, () => jiraClient.searchProjects());
		} catch (err) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: `Failed to fetch JIRA projects: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
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
			const creds = await resolveJiraCreds(input, ctx.effectiveOrgId);

			try {
				const [statuses, issueTypes, fields] = await withJiraCredentials(creds, () =>
					Promise.all([
						jiraClient.getProjectStatuses(input.projectKey),
						jiraClient.getIssueTypesForProject(input.projectKey),
						jiraClient.getFields(),
					]),
				);
				return {
					statuses,
					issueTypes,
					fields: fields.filter((f) => f.custom),
				};
			} catch (err) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: `Failed to fetch JIRA project details: ${err instanceof Error ? err.message : String(err)}`,
				});
			}
		}),
});
