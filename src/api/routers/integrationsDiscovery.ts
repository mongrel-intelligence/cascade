import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { ImapFlow } from 'imapflow';
import twilio from 'twilio';
import { z } from 'zod';
import { getDb } from '../../db/client.js';
import { decryptCredential } from '../../db/crypto.js';
import {
	upsertCredentialByEnvVarKey,
	upsertGmailIntegrationWithCredentials,
} from '../../db/repositories/credentialsRepository.js';
import { credentials } from '../../db/schema/index.js';
import { exchangeGmailCode, getGmailAuthUrl, getGmailUserInfo } from '../../email/gmail/oauth.js';
import { jiraClient, withJiraCredentials } from '../../jira/client.js';
import { trelloClient, withTrelloCredentials } from '../../trello/client.js';
import { logger } from '../../utils/logging.js';
import { protectedProcedure, router } from '../trpc.js';
import { verifyProjectOrgAccess } from './_shared/projectAccess.js';

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

	// ============================================================================
	// Gmail OAuth endpoints
	// ============================================================================

	/**
	 * Generate a Gmail OAuth consent URL.
	 * The state parameter includes projectId for callback routing.
	 */
	gmailOAuthUrl: protectedProcedure
		.input(
			z.object({
				clientIdCredentialId: z.number(),
				redirectUri: z.string().url(),
				projectId: z.string(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			logger.debug('integrationsDiscovery.gmailOAuthUrl called', {
				orgId: ctx.effectiveOrgId,
				projectId: input.projectId,
			});

			// Verify project ownership
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);

			const clientId = await resolveCredentialValue(input.clientIdCredentialId, ctx.effectiveOrgId);

			// Encode projectId, orgId, and timestamp in state for CSRF protection
			const state = Buffer.from(
				JSON.stringify({
					projectId: input.projectId,
					orgId: ctx.effectiveOrgId,
					timestamp: Date.now(),
				}),
			).toString('base64url');

			const url = getGmailAuthUrl(clientId, input.redirectUri, state);
			return { url, state };
		}),

	/**
	 * Exchange Gmail OAuth code for tokens and store credentials.
	 * Creates or updates gmail_email and gmail_refresh_token credentials.
	 */
	gmailOAuthCallback: protectedProcedure
		.input(
			z.object({
				clientIdCredentialId: z.number(),
				clientSecretCredentialId: z.number(),
				code: z.string(),
				redirectUri: z.string().url(),
				state: z.string(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			// Decode and validate state parameter for CSRF protection
			let stateData: { projectId: string; orgId: string; timestamp: number };
			try {
				stateData = JSON.parse(
					Buffer.from(input.state.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
				);
			} catch {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid state parameter' });
			}

			// Validate timestamp (within 10 minutes)
			const STATE_EXPIRY_MS = 10 * 60 * 1000;
			if (Date.now() - stateData.timestamp > STATE_EXPIRY_MS) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'OAuth state expired' });
			}

			// Validate orgId matches the current user's org
			if (stateData.orgId !== ctx.effectiveOrgId) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid state parameter' });
			}

			const projectId = stateData.projectId;

			// Verify project ownership
			await verifyProjectOrgAccess(projectId, ctx.effectiveOrgId);

			logger.debug('integrationsDiscovery.gmailOAuthCallback called', {
				orgId: ctx.effectiveOrgId,
				projectId,
			});

			const [clientId, clientSecret] = await Promise.all([
				resolveCredentialValue(input.clientIdCredentialId, ctx.effectiveOrgId),
				resolveCredentialValue(input.clientSecretCredentialId, ctx.effectiveOrgId),
			]);

			// Exchange code for tokens
			const tokens = await exchangeGmailCode(clientId, clientSecret, input.code, input.redirectUri);

			if (!tokens.refresh_token) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'No refresh token received. User may need to revoke access and re-authorize.',
				});
			}

			// Get user email
			const userInfo = await getGmailUserInfo(tokens.access_token);

			// Upsert gmail_email and gmail_refresh_token credentials
			const [emailCredId, refreshCredId] = await Promise.all([
				upsertCredentialByEnvVarKey({
					orgId: ctx.effectiveOrgId,
					envVarKey: 'EMAIL_GMAIL_ADDRESS',
					name: `Gmail: ${userInfo.email}`,
					value: userInfo.email,
				}),
				upsertCredentialByEnvVarKey({
					orgId: ctx.effectiveOrgId,
					envVarKey: 'EMAIL_GMAIL_REFRESH_TOKEN',
					name: `Gmail Refresh Token: ${userInfo.email}`,
					value: tokens.refresh_token,
				}),
			]);

			// Upsert the Gmail integration and link credentials
			await upsertGmailIntegrationWithCredentials({
				projectId,
				credentialLinks: [
					{ role: 'gmail_email', credentialId: emailCredId },
					{ role: 'gmail_refresh_token', credentialId: refreshCredId },
				],
			});

			logger.info('Gmail OAuth credentials stored successfully', {
				projectId,
				email: userInfo.email,
			});

			return { email: userInfo.email };
		}),

	/**
	 * Verify Gmail OAuth connection by testing IMAP login.
	 */
	verifyGmail: protectedProcedure
		.input(
			z.object({
				clientIdCredentialId: z.number(),
				clientSecretCredentialId: z.number(),
				refreshTokenCredentialId: z.number(),
				gmailEmailCredentialId: z.number(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			logger.debug('integrationsDiscovery.verifyGmail called', { orgId: ctx.effectiveOrgId });

			const [clientId, clientSecret, refreshToken, email] = await Promise.all([
				resolveCredentialValue(input.clientIdCredentialId, ctx.effectiveOrgId),
				resolveCredentialValue(input.clientSecretCredentialId, ctx.effectiveOrgId),
				resolveCredentialValue(input.refreshTokenCredentialId, ctx.effectiveOrgId),
				resolveCredentialValue(input.gmailEmailCredentialId, ctx.effectiveOrgId),
			]);

			try {
				// Exchange refresh token for access token
				const { exchangeGmailCode: _, refreshGmailAccessToken } = await import(
					'../../email/gmail/oauth.js'
				);
				const { accessToken } = await refreshGmailAccessToken(clientId, clientSecret, refreshToken);

				// Test IMAP connection
				const client = new ImapFlow({
					host: 'imap.gmail.com',
					port: 993,
					secure: true,
					auth: {
						user: email,
						accessToken,
					},
					logger: false,
					connectionTimeout: 15000,
					greetingTimeout: 10000,
				});

				await client.connect();
				await client.logout();

				return { success: true, email };
			} catch (err) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: `Gmail verification failed: ${err instanceof Error ? err.message : String(err)}`,
				});
			}
		}),

	/**
	 * Verify Twilio credentials by fetching the account details.
	 */
	verifyTwilio: protectedProcedure
		.input(
			z.object({
				accountSidCredentialId: z.number(),
				authTokenCredentialId: z.number(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			logger.debug('integrationsDiscovery.verifyTwilio called', { orgId: ctx.effectiveOrgId });

			const [accountSid, authToken] = await Promise.all([
				resolveCredentialValue(input.accountSidCredentialId, ctx.effectiveOrgId),
				resolveCredentialValue(input.authTokenCredentialId, ctx.effectiveOrgId),
			]);

			try {
				const client = twilio(accountSid, authToken);
				const account = await client.api.accounts(accountSid).fetch();
				return { friendlyName: account.friendlyName, status: account.status };
			} catch (err) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: `Failed to verify Twilio credentials: ${err instanceof Error ? err.message : String(err)}`,
				});
			}
		}),

	/**
	 * Verify IMAP connection with password auth.
	 */
	verifyImap: protectedProcedure
		.input(
			z.object({
				hostCredentialId: z.number(),
				portCredentialId: z.number(),
				usernameCredentialId: z.number(),
				passwordCredentialId: z.number(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			logger.debug('integrationsDiscovery.verifyImap called', { orgId: ctx.effectiveOrgId });

			const [host, portStr, username, password] = await Promise.all([
				resolveCredentialValue(input.hostCredentialId, ctx.effectiveOrgId),
				resolveCredentialValue(input.portCredentialId, ctx.effectiveOrgId),
				resolveCredentialValue(input.usernameCredentialId, ctx.effectiveOrgId),
				resolveCredentialValue(input.passwordCredentialId, ctx.effectiveOrgId),
			]);

			const port = Number.parseInt(portStr, 10);
			if (Number.isNaN(port)) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid port number' });
			}

			try {
				const client = new ImapFlow({
					host,
					port,
					secure: true,
					auth: {
						user: username,
						pass: password,
					},
					logger: false,
					connectionTimeout: 15000,
					greetingTimeout: 10000,
				});

				await client.connect();
				await client.logout();

				return { success: true, email: username };
			} catch (err) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: `IMAP verification failed: ${err instanceof Error ? err.message : String(err)}`,
				});
			}
		}),
});
