import { z } from 'zod';
import { adminProcedure, router } from '../trpc.js';
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
import type {
	GitHubWebhook,
	JiraWebhookInfo,
	LinearWebhookInfo,
	SentryWebhookInfo,
	TrelloWebhook,
} from './webhooks/types.js';

export type { GitHubWebhook, JiraWebhookInfo, LinearWebhookInfo, SentryWebhookInfo, TrelloWebhook };

type CreateInput = {
	trelloOnly?: boolean;
	githubOnly?: boolean;
	jiraOnly?: boolean;
};
type ProjectContext = Awaited<ReturnType<typeof resolveProjectContext>>;

/**
 * Per-provider create-or-skip helpers. Each:
 *   - Decides whether this provider should run given the input toggles + context.
 *   - Detects existing webhooks at the canonical or legacy callback URL.
 *   - Returns the created webhook, the duplicate marker, or `undefined` to skip.
 *
 * Extracted from the `create` mutation to keep that handler within the cognitive
 * complexity budget — the policy is identical, the per-provider field shapes
 * differ only in detail (callbackURL vs url vs config.url).
 */

async function maybeCreateTrelloWebhook(
	pctx: ProjectContext,
	input: CreateInput,
	baseUrl: string,
): Promise<TrelloWebhook | string | undefined> {
	if (input.githubOnly || input.jiraOnly) return undefined;
	if (!pctx.trelloApiKey || !pctx.trelloToken || !pctx.boardId) return undefined;

	const callbackUrl = `${baseUrl}/trello/webhook`;
	const existing = await trelloListWebhooks(pctx);
	const duplicate = existing.find(
		(w) => w.callbackURL === callbackUrl || w.callbackURL === `${baseUrl}/webhook/trello`,
	);
	if (duplicate) return `Already exists: ${duplicate.id}`;
	return trelloCreateWebhook(pctx, callbackUrl);
}

async function maybeCreateJiraWebhook(
	pctx: ProjectContext,
	input: CreateInput,
	baseUrl: string,
): Promise<{ jira?: JiraWebhookInfo | string; labelsEnsured?: string[] }> {
	if (input.trelloOnly || input.githubOnly) return {};
	if (!pctx.jiraEmail || !pctx.jiraApiToken || !pctx.jiraBaseUrl) return {};

	const callbackUrl = `${baseUrl}/jira/webhook`;
	const existing = await jiraListWebhooks(pctx);
	const duplicate = existing.find(
		(w) => w.url === callbackUrl || w.url === `${baseUrl}/webhook/jira`,
	);
	const jira = duplicate
		? `Already exists: ${duplicate.id}`
		: await jiraCreateWebhook(pctx, callbackUrl);
	const labelsEnsured = await jiraEnsureLabels(pctx);
	return { jira, labelsEnsured };
}

async function maybeCreateGitHubWebhook(
	pctx: ProjectContext,
	input: CreateInput,
	baseUrl: string,
): Promise<GitHubWebhook | string | undefined> {
	if (input.trelloOnly || input.jiraOnly) return undefined;
	if (!pctx.githubToken) return undefined;

	const callbackUrl = `${baseUrl}/github/webhook`;
	const existing = await githubListWebhooks(pctx);
	const duplicate = existing.find(
		(w) => w.config.url === callbackUrl || w.config.url === `${baseUrl}/webhook/github`,
	);
	if (duplicate) return `Already exists: ${duplicate.id}`;
	return githubCreateWebhook(pctx, callbackUrl);
}

function buildSentryDisplayInfo(
	pctx: ProjectContext,
	projectId: string,
	baseUrl: string,
): SentryWebhookInfo | undefined {
	if (!pctx.sentryConfigured) return undefined;
	return {
		url: `${baseUrl}/sentry/webhook/${projectId}`,
		webhookSecretSet: pctx.sentryWebhookSecretSet ?? false,
		note: 'Configure this URL manually in your Sentry Internal Integration webhook settings.',
	};
}

function buildLinearDisplayInfo(
	pctx: ProjectContext,
	baseUrl: string,
): LinearWebhookInfo | undefined {
	if (pctx.pmType !== 'linear' || !pctx.linearApiKey) return undefined;
	return {
		url: `${baseUrl}/linear/webhook`,
		webhookSecretSet: pctx.linearWebhookSecretSet ?? false,
		note: 'Configure this URL manually in your Linear team settings under API > Webhooks.',
	};
}

export const webhooksRouter = router({
	list: adminProcedure
		.input(
			z.object({
				projectId: z.string(),
				callbackBaseUrl: z.string().url().optional(),
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

			// Sentry — informational only (webhooks must be configured in Sentry UI)
			let sentry: SentryWebhookInfo | null = null;
			if (input.callbackBaseUrl && pctx.sentryConfigured) {
				const baseUrl = input.callbackBaseUrl.replace(/\/$/, '');
				sentry = {
					url: `${baseUrl}/sentry/webhook/${input.projectId}`,
					webhookSecretSet: pctx.sentryWebhookSecretSet ?? false,
					note: 'Configure this URL in your Sentry Internal Integration webhook settings.',
				};
			}

			// Linear — informational only (webhooks must be configured in Linear team settings)
			let linear: LinearWebhookInfo | null = null;
			if (input.callbackBaseUrl && pctx.pmType === 'linear' && pctx.linearApiKey) {
				const baseUrl = input.callbackBaseUrl.replace(/\/$/, '');
				linear = {
					url: `${baseUrl}/linear/webhook`,
					webhookSecretSet: pctx.linearWebhookSecretSet ?? false,
					note: 'Configure this URL in your Linear team settings under API > Webhooks.',
				};
			}

			return {
				trello: trelloResult.status === 'fulfilled' ? trelloResult.value : [],
				github: githubResult.status === 'fulfilled' ? githubResult.value : [],
				jira: jiraResult.status === 'fulfilled' ? jiraResult.value : [],
				sentry,
				linear,
				errors: {
					trello: trelloResult.status === 'rejected' ? String(trelloResult.reason) : null,
					github: githubResult.status === 'rejected' ? String(githubResult.reason) : null,
					jira: jiraResult.status === 'rejected' ? String(jiraResult.reason) : null,
					linear: null,
				},
			};
		}),

	create: adminProcedure
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
				sentry?: SentryWebhookInfo;
				linear?: LinearWebhookInfo;
				labelsEnsured?: string[];
			} = {};

			const trello = await maybeCreateTrelloWebhook(pctx, input, baseUrl);
			if (trello !== undefined) results.trello = trello;

			const { jira, labelsEnsured } = await maybeCreateJiraWebhook(pctx, input, baseUrl);
			if (jira !== undefined) results.jira = jira;
			if (labelsEnsured !== undefined) results.labelsEnsured = labelsEnsured;

			const github = await maybeCreateGitHubWebhook(pctx, input, baseUrl);
			if (github !== undefined) results.github = github;

			const sentry = buildSentryDisplayInfo(pctx, input.projectId, baseUrl);
			if (sentry !== undefined) results.sentry = sentry;

			const linear = buildLinearDisplayInfo(pctx, baseUrl);
			if (linear !== undefined) results.linear = linear;

			return results;
		}),

	delete: adminProcedure
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
