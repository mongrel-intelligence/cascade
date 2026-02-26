import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { ImapFlow } from 'imapflow';
import { z } from 'zod';
import { getDb } from '../../db/client.js';
import { decryptCredential, encryptCredential } from '../../db/crypto.js';
import { credentials, integrationCredentials, projectIntegrations } from '../../db/schema/index.js';
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

			const db = getDb();

			// Ensure Gmail integration exists for the project
			const [existingIntegration] = await db
				.select({ id: projectIntegrations.id })
				.from(projectIntegrations)
				.where(
					and(
						eq(projectIntegrations.projectId, projectId),
						eq(projectIntegrations.category, 'email'),
					),
				);

			let integrationId: number;
			if (existingIntegration) {
				// Update to gmail provider
				await db
					.update(projectIntegrations)
					.set({ provider: 'gmail', config: {}, updatedAt: new Date() })
					.where(eq(projectIntegrations.id, existingIntegration.id));
				integrationId = existingIntegration.id;
			} else {
				// Create new gmail integration
				const [newIntegration] = await db
					.insert(projectIntegrations)
					.values({
						projectId,
						category: 'email',
						provider: 'gmail',
						config: {},
					})
					.returning({ id: projectIntegrations.id });
				integrationId = newIntegration.id;
			}

			// Create or update gmail_email credential
			const emailCredName = `Gmail: ${userInfo.email}`;
			const [existingEmailCred] = await db
				.select({ id: credentials.id })
				.from(credentials)
				.where(
					and(
						eq(credentials.orgId, ctx.effectiveOrgId),
						eq(credentials.envVarKey, 'EMAIL_GMAIL_ADDRESS'),
						eq(credentials.name, emailCredName),
					),
				);

			let emailCredId: number;
			if (existingEmailCred) {
				await db
					.update(credentials)
					.set({
						value: encryptCredential(userInfo.email, ctx.effectiveOrgId),
						updatedAt: new Date(),
					})
					.where(eq(credentials.id, existingEmailCred.id));
				emailCredId = existingEmailCred.id;
			} else {
				const [newCred] = await db
					.insert(credentials)
					.values({
						orgId: ctx.effectiveOrgId,
						name: emailCredName,
						envVarKey: 'EMAIL_GMAIL_ADDRESS',
						value: encryptCredential(userInfo.email, ctx.effectiveOrgId),
						isDefault: false,
					})
					.returning({ id: credentials.id });
				emailCredId = newCred.id;
			}

			// Create or update gmail_refresh_token credential
			const refreshCredName = `Gmail Refresh Token: ${userInfo.email}`;
			const [existingRefreshCred] = await db
				.select({ id: credentials.id })
				.from(credentials)
				.where(
					and(
						eq(credentials.orgId, ctx.effectiveOrgId),
						eq(credentials.envVarKey, 'EMAIL_GMAIL_REFRESH_TOKEN'),
						eq(credentials.name, refreshCredName),
					),
				);

			let refreshCredId: number;
			if (existingRefreshCred) {
				await db
					.update(credentials)
					.set({
						value: encryptCredential(tokens.refresh_token, ctx.effectiveOrgId),
						updatedAt: new Date(),
					})
					.where(eq(credentials.id, existingRefreshCred.id));
				refreshCredId = existingRefreshCred.id;
			} else {
				const [newCred] = await db
					.insert(credentials)
					.values({
						orgId: ctx.effectiveOrgId,
						name: refreshCredName,
						envVarKey: 'EMAIL_GMAIL_REFRESH_TOKEN',
						value: encryptCredential(tokens.refresh_token, ctx.effectiveOrgId),
						isDefault: false,
					})
					.returning({ id: credentials.id });
				refreshCredId = newCred.id;
			}

			// Link credentials to integration
			// Delete any existing credential links for this integration
			await db
				.delete(integrationCredentials)
				.where(eq(integrationCredentials.integrationId, integrationId));

			// Insert new credential links
			await db.insert(integrationCredentials).values([
				{ integrationId, role: 'gmail_email', credentialId: emailCredId },
				{ integrationId, role: 'gmail_refresh_token', credentialId: refreshCredId },
			]);

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
				email: z.string().email(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			logger.debug('integrationsDiscovery.verifyGmail called', { orgId: ctx.effectiveOrgId });

			const [clientId, clientSecret, refreshToken] = await Promise.all([
				resolveCredentialValue(input.clientIdCredentialId, ctx.effectiveOrgId),
				resolveCredentialValue(input.clientSecretCredentialId, ctx.effectiveOrgId),
				resolveCredentialValue(input.refreshTokenCredentialId, ctx.effectiveOrgId),
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
						user: input.email,
						accessToken,
					},
					logger: false,
					connectionTimeout: 15000,
					greetingTimeout: 10000,
				});

				await client.connect();
				await client.logout();

				return { success: true, email: input.email };
			} catch (err) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: `Gmail verification failed: ${err instanceof Error ? err.message : String(err)}`,
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
