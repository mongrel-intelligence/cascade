import { z } from 'zod';
import { logger } from '../../utils/logging.js';
import { adminProcedure, router } from '../trpc.js';
import {
	applyOneTimeTokens,
	oneTimeTokensSchema,
	resolveProjectContext,
} from './webhooks/context.js';
import { githubCreateWebhook, githubDeleteWebhook, githubListWebhooks } from './webhooks/github.js';
import {
	githubProjectsCreateWebhook,
	githubProjectsDeleteWebhook,
	githubProjectsListWebhooks,
} from './webhooks/github-projects.js';
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
	githubProjectsOnly?: boolean;
};

/** True when any *other* provider's `…Only` toggle is set (so this one must skip). */
function skipForOtherOnly(input: CreateInput, self: keyof CreateInput): boolean {
	return (['trelloOnly', 'githubOnly', 'jiraOnly', 'githubProjectsOnly'] as const).some(
		(k) => k !== self && input[k],
	);
}
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
	if (skipForOtherOnly(input, 'trelloOnly')) return undefined;
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
	if (skipForOtherOnly(input, 'jiraOnly')) return {};
	if (!pctx.jiraEmail || !pctx.jiraApiToken || !pctx.jiraBaseUrl) return {};

	const callbackUrl = `${baseUrl}/jira/webhook`;
	// Best-effort dedup: a scope-restricted token can reject GET /webhook (401/403).
	// If the list fails we skip the router-level duplicate check and let
	// jiraCreateWebhook run so its actionable scope / manual-registration error
	// surfaces instead of a generic "Failed to list JIRA webhooks" failure.
	// jiraCreateWebhook performs its own (also best-effort) dedup listing.
	let existing: JiraWebhookInfo[] = [];
	try {
		existing = await jiraListWebhooks(pctx);
	} catch (err) {
		logger.warn('[JiraWebhook] Could not list existing webhooks for dedup (continuing)', {
			projectId: pctx.projectId,
			jiraProjectKey: pctx.jiraProjectKey,
			error: String(err),
		});
	}
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
	if (skipForOtherOnly(input, 'githubOnly')) return undefined;
	if (!pctx.githubToken) return undefined;

	const callbackUrl = `${baseUrl}/github/webhook`;
	const existing = await githubListWebhooks(pctx);
	const duplicate = existing.find(
		(w) => w.config.url === callbackUrl || w.config.url === `${baseUrl}/webhook/github`,
	);
	if (duplicate) return `Already exists: ${duplicate.id}`;
	return githubCreateWebhook(pctx, callbackUrl);
}

async function maybeCreateGitHubProjectsWebhook(
	pctx: ProjectContext,
	input: CreateInput,
	baseUrl: string,
): Promise<GitHubWebhook | string | undefined> {
	if (skipForOtherOnly(input, 'githubProjectsOnly')) return undefined;
	// Programmatic creation is org-owned only; user-owned projects list [] and skip.
	if (pctx.githubProjectsOwnerType !== 'organization' || !pctx.githubProjectsOwner)
		return undefined;
	if (!pctx.githubProjectsToken) return undefined;

	const callbackUrl = `${baseUrl}/github-projects/webhook`;
	const existing = await githubProjectsListWebhooks(pctx);
	const duplicate = existing.find((w) => w.config?.url === callbackUrl);
	if (duplicate) return `Already exists: ${duplicate.id}`;
	return githubProjectsCreateWebhook(pctx, callbackUrl);
}

function buildSentryDisplayInfo(
	pctx: ProjectContext,
	projectId: string,
	baseUrl: string,
): SentryWebhookInfo | undefined {
	if (!pctx.sentryConfigured || !pctx.sentryOrganizationSlug || !pctx.sentryProjectSlug) {
		return undefined;
	}
	return {
		url: `${baseUrl}/sentry/webhook/${projectId}`,
		webhookSecretSet: pctx.sentryWebhookSecretSet ?? false,
		organizationSlug: pctx.sentryOrganizationSlug,
		projectSlug: pctx.sentryProjectSlug,
		note: `Configure this URL manually in your Sentry Internal Integration webhook settings for ${pctx.sentryOrganizationSlug}/${pctx.sentryProjectSlug}. Cascade dispatches only payloads whose Sentry project matches the configured project slug "${pctx.sentryProjectSlug}".`,
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

			const [trelloResult, githubResult, jiraResult, githubProjectsResult] =
				await Promise.allSettled([
					trelloListWebhooks(pctx),
					githubListWebhooks(pctx),
					jiraListWebhooks(pctx),
					githubProjectsListWebhooks(pctx),
				]);

			const sentry = input.callbackBaseUrl
				? (buildSentryDisplayInfo(
						pctx,
						input.projectId,
						input.callbackBaseUrl.replace(/\/$/, ''),
					) ?? null)
				: null;

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
				githubProjects:
					githubProjectsResult.status === 'fulfilled' ? githubProjectsResult.value : [],
				sentry,
				linear,
				errors: {
					trello: trelloResult.status === 'rejected' ? String(trelloResult.reason) : null,
					github: githubResult.status === 'rejected' ? String(githubResult.reason) : null,
					jira: jiraResult.status === 'rejected' ? String(jiraResult.reason) : null,
					githubProjects:
						githubProjectsResult.status === 'rejected' ? String(githubProjectsResult.reason) : null,
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
				githubProjectsOnly: z.boolean().optional(),
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
				githubProjects?: GitHubWebhook | string;
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

			const githubProjects = await maybeCreateGitHubProjectsWebhook(pctx, input, baseUrl);
			if (githubProjects !== undefined) results.githubProjects = githubProjects;

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
				githubProjectsOnly: z.boolean().optional(),
				oneTimeTokens: oneTimeTokensSchema,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const pctx = await resolveProjectContext(input.projectId, ctx.effectiveOrgId);
			applyOneTimeTokens(pctx, input.oneTimeTokens);
			const baseUrl = input.callbackBaseUrl.replace(/\/$/, '');
			const deleted: {
				trello: string[];
				github: number[];
				jira: number[];
				githubProjects: number[];
			} = {
				trello: [],
				github: [],
				jira: [],
				githubProjects: [],
			};

			// Trello
			if (!skipForOtherOnly(input, 'trelloOnly') && pctx.trelloApiKey && pctx.trelloToken) {
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
			if (!skipForOtherOnly(input, 'jiraOnly') && pctx.jiraEmail && pctx.jiraApiToken) {
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
			if (!skipForOtherOnly(input, 'githubOnly') && pctx.githubToken) {
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

			// GitHub Projects (org-owned only)
			if (
				!skipForOtherOnly(input, 'githubProjectsOnly') &&
				pctx.githubProjectsOwnerType === 'organization' &&
				pctx.githubProjectsToken
			) {
				const callbackUrl = `${baseUrl}/github-projects/webhook`;
				const existing = await githubProjectsListWebhooks(pctx);
				const matching = existing.filter((w) => w.config?.url === callbackUrl);
				for (const w of matching) {
					await githubProjectsDeleteWebhook(pctx, w.id);
					deleted.githubProjects.push(w.id);
				}
			}

			return deleted;
		}),
});
