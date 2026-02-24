import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { getAllProjectCredentials } from '../../config/provider.js';
import { findProjectByIdFromDb } from '../../db/repositories/configRepository.js';
import { getJiraConfig, getTrelloConfig } from '../../pm/config.js';
import { protectedProcedure, router } from '../trpc.js';
import { verifyProjectOrgAccess } from './_shared/orgAccess.js';
import { GitHubWebhookAdapter } from './webhooks/github.js';
import { JiraWebhookAdapter, jiraEnsureLabels } from './webhooks/jira.js';
import { TrelloWebhookAdapter } from './webhooks/trello.js';
import type {
	GitHubWebhook,
	JiraWebhookInfo,
	ProjectContext,
	TrelloWebhook,
} from './webhooks/types.js';

// Re-export webhook types for CLI and other consumers
export type { TrelloWebhook, GitHubWebhook, JiraWebhookInfo } from './webhooks/types.js';

// --- Adapter instances ---

const trelloAdapter = new TrelloWebhookAdapter();
const githubAdapter = new GitHubWebhookAdapter();
const jiraAdapter = new JiraWebhookAdapter();

// --- Project context resolution ---

async function resolveProjectContext(
	projectId: string,
	userOrgId: string,
): Promise<ProjectContext> {
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
			]
		: undefined;

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
	};
}

// --- One-time token schema (shared by list/create/delete) ---

const oneTimeTokensSchema = z
	.object({
		github: z.string().optional(),
		trelloApiKey: z.string().optional(),
		trelloToken: z.string().optional(),
		jiraEmail: z.string().optional(),
		jiraApiToken: z.string().optional(),
	})
	.optional();

function applyOneTimeTokens(
	pctx: ProjectContext,
	tokens: z.infer<typeof oneTimeTokensSchema>,
): void {
	if (!tokens) return;
	if (tokens.github) pctx.githubToken = tokens.github;
	if (tokens.trelloApiKey) pctx.trelloApiKey = tokens.trelloApiKey;
	if (tokens.trelloToken) pctx.trelloToken = tokens.trelloToken;
	if (tokens.jiraEmail) pctx.jiraEmail = tokens.jiraEmail;
	if (tokens.jiraApiToken) pctx.jiraApiToken = tokens.jiraApiToken;
}

// --- Router ---

export const webhooksRouter = router({
	list: protectedProcedure
		.input(
			z.object({
				projectId: z.string(),
				oneTimeTokens: oneTimeTokensSchema,
			}),
		)
		.query(async ({ ctx, input }) => {
			const pctx = await resolveProjectContext(input.projectId, ctx.effectiveOrgId);
			applyOneTimeTokens(pctx, input.oneTimeTokens);

			const [trelloResult, githubResult, jiraResult] = await Promise.allSettled([
				trelloAdapter.list(pctx),
				githubAdapter.list(pctx),
				jiraAdapter.list(pctx),
			]);

			return {
				trello: trelloResult.status === 'fulfilled' ? trelloResult.value : [],
				github: githubResult.status === 'fulfilled' ? githubResult.value : [],
				jira: jiraResult.status === 'fulfilled' ? jiraResult.value : [],
				errors: {
					trello: trelloResult.status === 'rejected' ? String(trelloResult.reason) : null,
					github: githubResult.status === 'rejected' ? String(githubResult.reason) : null,
					jira: jiraResult.status === 'rejected' ? String(jiraResult.reason) : null,
				},
			};
		}),

	create: protectedProcedure
		.input(
			z.object({
				projectId: z.string(),
				callbackBaseUrl: z.string().url(),
				trelloOnly: z.boolean().optional(),
				githubOnly: z.boolean().optional(),
				jiraOnly: z.boolean().optional(),
				oneTimeTokens: oneTimeTokensSchema,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const pctx = await resolveProjectContext(input.projectId, ctx.effectiveOrgId);
			applyOneTimeTokens(pctx, input.oneTimeTokens);
			const baseUrl = input.callbackBaseUrl.replace(/\/$/, '');

			const results: {
				trello?: TrelloWebhook | string;
				github?: GitHubWebhook | string;
				jira?: JiraWebhookInfo | string;
				labelsEnsured?: string[];
			} = {};

			// Trello webhook (skip for JIRA-only or GitHub-only)
			if (!input.githubOnly && !input.jiraOnly) {
				results.trello = await trelloAdapter.create(pctx, baseUrl);
			}

			// JIRA webhook (skip for Trello-only or GitHub-only)
			if (!input.trelloOnly && !input.githubOnly) {
				results.jira = await jiraAdapter.create(pctx, baseUrl);
				if (results.jira !== undefined) {
					// Seed CASCADE labels in JIRA autocomplete whenever JIRA is processed
					results.labelsEnsured = await jiraEnsureLabels(pctx);
				}
			}

			// GitHub webhook (skip for Trello-only or JIRA-only)
			if (!input.trelloOnly && !input.jiraOnly) {
				results.github = await githubAdapter.create(pctx, baseUrl);
			}

			return results;
		}),

	delete: protectedProcedure
		.input(
			z.object({
				projectId: z.string(),
				callbackBaseUrl: z.string().url(),
				trelloOnly: z.boolean().optional(),
				githubOnly: z.boolean().optional(),
				jiraOnly: z.boolean().optional(),
				oneTimeTokens: oneTimeTokensSchema,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const pctx = await resolveProjectContext(input.projectId, ctx.effectiveOrgId);
			applyOneTimeTokens(pctx, input.oneTimeTokens);
			const baseUrl = input.callbackBaseUrl.replace(/\/$/, '');

			const [trelloDeleted, jiraDeleted, githubDeleted] = await Promise.all([
				!input.githubOnly && !input.jiraOnly
					? trelloAdapter.delete(pctx, baseUrl)
					: Promise.resolve([]),
				!input.trelloOnly && !input.githubOnly
					? jiraAdapter.delete(pctx, baseUrl)
					: Promise.resolve([]),
				!input.trelloOnly && !input.jiraOnly
					? githubAdapter.delete(pctx, baseUrl)
					: Promise.resolve([]),
			]);

			return {
				trello: trelloDeleted as string[],
				github: githubDeleted as number[],
				jira: jiraDeleted as number[],
			};
		}),
});
