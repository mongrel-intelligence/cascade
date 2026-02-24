import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getAllProjectCredentials } from '../../config/provider.js';
import { getDb } from '../../db/client.js';
import { findProjectByIdFromDb } from '../../db/repositories/configRepository.js';
import { projects } from '../../db/schema/index.js';
import { getJiraConfig, getTrelloConfig } from '../../pm/config.js';
import {
	GitHubWebhookManager,
	JiraWebhookManager,
	TrelloWebhookManager,
} from '../services/index.js';
import { protectedProcedure, router } from '../trpc.js';

// Re-export types for consumers (CLI, frontend) that previously imported from here
export type { GitHubWebhook, JiraWebhookInfo, TrelloWebhook } from '../services/index.js';

interface ProjectContext {
	projectId: string;
	orgId: string;
	repo: string;
	pmType: 'trello' | 'jira';
	boardId?: string;
	jiraBaseUrl?: string;
	jiraProjectKey?: string;
	jiraLabels?: string[];
	trelloApiKey: string;
	trelloToken: string;
	githubToken: string;
	jiraEmail?: string;
	jiraApiToken?: string;
}

async function resolveProjectContext(
	projectId: string,
	userOrgId: string,
): Promise<ProjectContext> {
	// Verify ownership
	const db = getDb();
	const [proj] = await db
		.select({ orgId: projects.orgId })
		.from(projects)
		.where(eq(projects.id, projectId));
	if (!proj || proj.orgId !== userOrgId) {
		throw new TRPCError({ code: 'NOT_FOUND' });
	}

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

			const trelloMgr = new TrelloWebhookManager(pctx);
			const githubMgr = pctx.githubToken ? new GitHubWebhookManager(pctx) : null;
			const jiraMgr = new JiraWebhookManager(pctx);

			const [trelloResult, githubResult, jiraResult] = await Promise.allSettled([
				trelloMgr.list(),
				githubMgr ? githubMgr.list() : Promise.resolve([]),
				jiraMgr.list(),
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
				trello?: import('../services/index.js').TrelloWebhook | string;
				github?: import('../services/index.js').GitHubWebhook | string;
				jira?: import('../services/index.js').JiraWebhookInfo | string;
				labelsEnsured?: string[];
			} = {};

			// Trello webhook (skip for JIRA-only projects)
			if (
				!input.githubOnly &&
				!input.jiraOnly &&
				pctx.trelloApiKey &&
				pctx.trelloToken &&
				pctx.boardId
			) {
				const trelloCallbackUrl = `${baseUrl}/trello/webhook`;
				const mgr = new TrelloWebhookManager(pctx);
				const existing = await mgr.list();
				const duplicate = existing.find(
					(w) =>
						w.callbackURL === trelloCallbackUrl || w.callbackURL === `${baseUrl}/webhook/trello`,
				);
				results.trello = duplicate
					? `Already exists: ${duplicate.id}`
					: await mgr.create(trelloCallbackUrl);
			}

			// JIRA webhook (skip for Trello-only projects)
			if (
				!input.trelloOnly &&
				!input.githubOnly &&
				pctx.jiraEmail &&
				pctx.jiraApiToken &&
				pctx.jiraBaseUrl
			) {
				const jiraCallbackUrl = `${baseUrl}/jira/webhook`;
				const mgr = new JiraWebhookManager(pctx);
				const existing = await mgr.list();
				const duplicate = existing.find(
					(w) => w.url === jiraCallbackUrl || w.url === `${baseUrl}/webhook/jira`,
				);
				results.jira = duplicate
					? `Already exists: ${duplicate.id}`
					: await mgr.create(jiraCallbackUrl);

				// Seed CASCADE labels in JIRA autocomplete
				results.labelsEnsured = await mgr.ensureLabels();
			}

			// GitHub webhook
			if (!input.trelloOnly && !input.jiraOnly && pctx.githubToken) {
				const githubCallbackUrl = `${baseUrl}/github/webhook`;
				const mgr = new GitHubWebhookManager(pctx);
				const existing = await mgr.list();
				const duplicate = existing.find(
					(w) => w.config.url === githubCallbackUrl || w.config.url === `${baseUrl}/webhook/github`,
				);
				results.github = duplicate
					? `Already exists: ${duplicate.id}`
					: await mgr.create(githubCallbackUrl);
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
			const deleted: { trello: string[]; github: number[]; jira: number[] } = {
				trello: [],
				github: [],
				jira: [],
			};

			// Trello
			if (!input.githubOnly && !input.jiraOnly && pctx.trelloApiKey && pctx.trelloToken) {
				const trelloCallbackUrl = `${baseUrl}/trello/webhook`;
				const mgr = new TrelloWebhookManager(pctx);
				const existing = await mgr.list();
				const matching = existing.filter(
					(w) =>
						w.callbackURL === trelloCallbackUrl || w.callbackURL === `${baseUrl}/webhook/trello`,
				);
				for (const w of matching) {
					await mgr.delete(w.id);
					deleted.trello.push(w.id);
				}
			}

			// JIRA
			if (!input.trelloOnly && !input.githubOnly && pctx.jiraEmail && pctx.jiraApiToken) {
				const jiraCallbackUrl = `${baseUrl}/jira/webhook`;
				const mgr = new JiraWebhookManager(pctx);
				const existing = await mgr.list();
				const matching = existing.filter(
					(w) => w.url === jiraCallbackUrl || w.url === `${baseUrl}/webhook/jira`,
				);
				for (const w of matching) {
					await mgr.delete(w.id);
					deleted.jira.push(w.id);
				}
			}

			// GitHub
			if (!input.trelloOnly && !input.jiraOnly && pctx.githubToken) {
				const githubCallbackUrl = `${baseUrl}/github/webhook`;
				const mgr = new GitHubWebhookManager(pctx);
				const existing = await mgr.list();
				const matching = existing.filter(
					(w) => w.config.url === githubCallbackUrl || w.config.url === `${baseUrl}/webhook/github`,
				);
				for (const w of matching) {
					await mgr.delete(w.id);
					deleted.github.push(w.id);
				}
			}

			return deleted;
		}),
});
