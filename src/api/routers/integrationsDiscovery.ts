/**
 * integrations-discovery router — post-spec-010 scope.
 *
 * After spec 010, this router contains:
 *  - GitHub SCM procedures (verifyGithubToken) — SCM is out of the spec-010
 *    PM manifest migration scope.
 *  - Sentry alerting procedures (verifySentry) — alerting is also out of scope.
 *  - The 6 composite `*Details(ByProject)` read procedures (Trello board
 *    details; JIRA project details; Linear team details) — these bundle
 *    multiple reads that would require new `pm.discover` capabilities
 *    (`containers` for Trello lists, `issueTypes` for JIRA) to migrate.
 *    Deferred to a follow-up spec.
 *
 * All simple PM read + write procedures were migrated to `pm.discovery.*`
 * in specs 009/5 and 010/1-2. When this file gets further cleanup, the
 * `spec 010/2 deferred` describe block in
 * `tests/unit/api/pm-discovery-legacy-removed.test.ts` flips from "still
 * defined" to "removed".
 */

import { Octokit } from '@octokit/rest';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { getIntegrationCredentialOrNull } from '../../config/provider.js';
import { getIntegrationByProjectAndCategory } from '../../db/repositories/integrationsRepository.js';
import { jiraClient, withJiraCredentials } from '../../jira/client.js';
import { linearClient, withLinearCredentials } from '../../linear/client.js';
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

const linearCredsInput = z.object({
	apiKey: z.string().min(1),
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

async function withLinearCreds<T>(
	input: z.infer<typeof linearCredsInput>,
	label: string,
	fn: (creds: { apiKey: string }) => Promise<T>,
): Promise<T> {
	return wrapIntegrationCall(label, () => fn({ apiKey: input.apiKey }));
}

export const integrationsDiscoveryRouter = router({
	// verifyTrello / verifyJira were removed by spec 009/5 — callers now
	// use `pm.discover({ providerId: 'trello'|'jira', capability: 'boards'|'projects', ... })`.
	// See web/src/components/projects/pm-wizard-hooks.ts for the migrated caller.
	// verifyLinear was removed in the same commit (see below in this file).

	// Plan 010/2 removed trelloBoards — migrated to pm.discovery.discover({capability: 'boards'}).

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

	// Plan 010/2 removed trelloBoardsByProject — migrated to
	// pm.discovery.discover({capability: 'boards', projectId}).

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
			const integration = await getIntegrationByProjectAndCategory(input.projectId, 'pm');
			if (!integration) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'No PM integration configured for this project yet',
				});
			}
			if (integration.provider !== 'trello') {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'Project is configured with a different PM provider',
				});
			}
			const apiKey = await getIntegrationCredentialOrNull(
				input.projectId,
				'pm',
				'trello',
				'api_key',
			);
			const token = await getIntegrationCredentialOrNull(input.projectId, 'pm', 'trello', 'token');
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

	// Plan 010/2 removed jiraProjectsByProject — migrated to
	// pm.discovery.discover({capability: 'projects', projectId}).

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
			const integration = await getIntegrationByProjectAndCategory(input.projectId, 'pm');
			if (!integration) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'No PM integration configured for this project yet',
				});
			}
			if (integration.provider !== 'jira') {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'Project is configured with a different PM provider',
				});
			}
			const email = await getIntegrationCredentialOrNull(input.projectId, 'pm', 'jira', 'email');
			const apiToken = await getIntegrationCredentialOrNull(
				input.projectId,
				'pm',
				'jira',
				'api_token',
			);
			const baseUrl = (integration.config as Record<string, unknown> | null)?.baseUrl as
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

	// Plan 010/1 removed createTrelloLabel, createTrelloLabels,
	// createTrelloCustomField. Callers migrated to pm.discovery.createLabel
	// and pm.discovery.createCustomField (generic endpoints dispatching
	// through trelloManifest.createLabel / createCustomField hooks).
	// See web/src/components/projects/pm-wizard-hooks.ts.

	// Plan 010/2 removed jiraProjects — migrated to pm.discovery.discover({capability: 'projects'}).

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

	// Plan 010/1 removed createJiraCustomField. Callers migrated to
	// pm.discovery.createCustomField (generic endpoint dispatching through
	// jiraManifest.createCustomField hook).

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

	/**
	 * Verify a Sentry API token and organization slug.
	 * Used by the Integrations tab Alerting credential inputs.
	 * Accepts plaintext credentials from the form and calls the Sentry API to verify.
	 * The token is never stored by this endpoint.
	 */
	verifySentry: protectedProcedure
		.input(
			z.object({
				apiToken: z.string().min(1),
				organizationSlug: z.string().trim().min(1),
				projectSlug: z.string().trim().min(1).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			logger.debug('integrationsDiscovery.verifySentry called', { orgId: ctx.effectiveOrgId });
			return wrapIntegrationCall('Failed to verify Sentry credentials', async () => {
				const organizationSlug = input.organizationSlug;
				const projectSlug = input.projectSlug;
				const url = projectSlug
					? `https://sentry.io/api/0/projects/${encodeURIComponent(organizationSlug)}/${encodeURIComponent(projectSlug)}/`
					: `https://sentry.io/api/0/organizations/${encodeURIComponent(organizationSlug)}/`;
				const response = await fetch(url, {
					headers: { Authorization: `Bearer ${input.apiToken}` },
				});
				if (!response.ok) {
					throw new Error(`Sentry API returned ${response.status}: ${response.statusText}`);
				}
				const data = (await response.json()) as {
					id?: string;
					name?: string;
					slug?: string;
				};
				return {
					id: data.id ?? '',
					name: data.name ?? '',
					slug: data.slug ?? '',
				};
			});
		}),

	// verifyLinear was removed by spec 009/5 — callers migrated to
	// `pm.discover({ providerId: 'linear', capability: 'teams', ... })`.
	// See web/src/components/projects/pm-wizard-hooks.ts.

	// Plan 010/2 removed linearTeams + linearTeamsByProject — migrated
	// to pm.discovery.discover({capability: 'teams', [projectId]}).

	/**
	 * Fetch Linear team workflow states and labels using raw API key credentials.
	 * Returns both states and labels for the given teamId.
	 */
	linearTeamDetails: protectedProcedure
		.input(linearCredsInput.extend({ teamId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			logger.debug('integrationsDiscovery.linearTeamDetails called', {
				orgId: ctx.effectiveOrgId,
				teamId: input.teamId,
			});
			return withLinearCreds(input, 'Failed to fetch Linear team details', (creds) =>
				withLinearCredentials(creds, () =>
					Promise.all([
						linearClient.getTeamWorkflowStates(input.teamId),
						linearClient.getTeamLabels(input.teamId),
					]).then(([states, labels]) => ({ states, labels })),
				),
			);
		}),

	/**
	 * Fetch Linear team workflow states and labels using stored project credentials.
	 * Resolves the API key from stored credentials and returns states and labels for the team.
	 */
	linearTeamDetailsByProject: protectedProcedure
		.input(z.object({ projectId: z.string(), teamId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			logger.debug('integrationsDiscovery.linearTeamDetailsByProject called', {
				orgId: ctx.effectiveOrgId,
				projectId: input.projectId,
				teamId: input.teamId,
			});
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
			const integration = await getIntegrationByProjectAndCategory(input.projectId, 'pm');
			if (!integration) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'No PM integration configured for this project yet',
				});
			}
			if (integration.provider !== 'linear') {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'Project is configured with a different PM provider',
				});
			}
			const apiKey = await getIntegrationCredentialOrNull(
				input.projectId,
				'pm',
				'linear',
				'api_key',
			);
			if (!apiKey) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'Linear credentials not configured',
				});
			}
			return wrapIntegrationCall('Failed to fetch Linear team details', () =>
				withLinearCredentials({ apiKey }, () =>
					Promise.all([
						linearClient.getTeamWorkflowStates(input.teamId),
						linearClient.getTeamLabels(input.teamId),
					]).then(([states, labels]) => ({ states, labels })),
				),
			);
		}),

	/**
	 * Fetch Linear projects scoped to a team using raw API key credentials.
	 * Returns the list of Linear Projects accessible to the given team.
	 */
	// Plan 010/2 removed linearProjects + linearProjectsByProject — migrated
	// to pm.discovery.discover({capability: 'projects', args: {containerId: teamId}, [projectId]}).

	// Plan 010/1 removed createLinearLabel + createLinearLabels. Callers
	// migrated to pm.discovery.createLabel (generic endpoint dispatching
	// through linearManifest.createLabel hook; the batch variant is now
	// implemented client-side as an iteration over the single-item endpoint).
});
