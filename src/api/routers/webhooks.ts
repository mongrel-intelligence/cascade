import { z } from 'zod';
import { protectedProcedure, router } from '../trpc.js';
import {
	applyOneTimeTokens,
	oneTimeTokensSchema,
	resolveProjectContext,
} from './webhooks/context.js';
import { githubCreateWebhook, githubDeleteWebhook, githubListWebhooks } from './webhooks/github.js';
import {
	jiraCreateWebhook,
	jiraDeleteWebhook,
	jiraEnsureLabels,
	jiraListWebhooks,
} from './webhooks/jira.js';
import { trelloCreateWebhook, trelloDeleteWebhook, trelloListWebhooks } from './webhooks/trello.js';
import type { GitHubWebhook, JiraWebhookInfo, TrelloWebhook } from './webhooks/types.js';

export type { GitHubWebhook, JiraWebhookInfo, TrelloWebhook };

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
				trelloListWebhooks(pctx),
				githubListWebhooks(pctx),
				jiraListWebhooks(pctx),
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

			// Trello webhook (skip for JIRA-only projects)
			if (
				!input.githubOnly &&
				!input.jiraOnly &&
				pctx.trelloApiKey &&
				pctx.trelloToken &&
				pctx.boardId
			) {
				const trelloCallbackUrl = `${baseUrl}/trello/webhook`;
				const existing = await trelloListWebhooks(pctx);
				const duplicate = existing.find(
					(w) =>
						w.callbackURL === trelloCallbackUrl || w.callbackURL === `${baseUrl}/webhook/trello`,
				);

				if (duplicate) {
					results.trello = `Already exists: ${duplicate.id}`;
				} else {
					results.trello = await trelloCreateWebhook(pctx, trelloCallbackUrl);
				}
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
				const existing = await jiraListWebhooks(pctx);
				const duplicate = existing.find(
					(w) => w.url === jiraCallbackUrl || w.url === `${baseUrl}/webhook/jira`,
				);

				if (duplicate) {
					results.jira = `Already exists: ${duplicate.id}`;
				} else {
					results.jira = await jiraCreateWebhook(pctx, jiraCallbackUrl);
				}

				// Seed CASCADE labels in JIRA autocomplete
				results.labelsEnsured = await jiraEnsureLabels(pctx);
			}

			// GitHub webhook
			if (!input.trelloOnly && !input.jiraOnly && pctx.githubToken) {
				const githubCallbackUrl = `${baseUrl}/github/webhook`;
				const existing = await githubListWebhooks(pctx);
				const duplicate = existing.find(
					(w) => w.config.url === githubCallbackUrl || w.config.url === `${baseUrl}/webhook/github`,
				);

				if (duplicate) {
					results.github = `Already exists: ${duplicate.id}`;
				} else {
					results.github = await githubCreateWebhook(pctx, githubCallbackUrl);
				}
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
				const existing = await trelloListWebhooks(pctx);
				const matching = existing.filter(
					(w) =>
						w.callbackURL === trelloCallbackUrl || w.callbackURL === `${baseUrl}/webhook/trello`,
				);
				for (const w of matching) {
					await trelloDeleteWebhook(pctx, w.id);
					deleted.trello.push(w.id);
				}
			}

			// JIRA
			if (!input.trelloOnly && !input.githubOnly && pctx.jiraEmail && pctx.jiraApiToken) {
				const jiraCallbackUrl = `${baseUrl}/jira/webhook`;
				const existing = await jiraListWebhooks(pctx);
				const matching = existing.filter(
					(w) => w.url === jiraCallbackUrl || w.url === `${baseUrl}/webhook/jira`,
				);
				for (const w of matching) {
					await jiraDeleteWebhook(pctx, w.id);
					deleted.jira.push(w.id);
				}
			}

			// GitHub
			if (!input.trelloOnly && !input.jiraOnly && pctx.githubToken) {
				const githubCallbackUrl = `${baseUrl}/github/webhook`;
				const existing = await githubListWebhooks(pctx);
				const matching = existing.filter(
					(w) => w.config.url === githubCallbackUrl || w.config.url === `${baseUrl}/webhook/github`,
				);
				for (const w of matching) {
					await githubDeleteWebhook(pctx, w.id);
					deleted.github.push(w.id);
				}
			}

			return deleted;
		}),
});
