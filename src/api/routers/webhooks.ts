import { Octokit } from '@octokit/rest';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../db/client.js';
import { findProjectByIdFromDb } from '../../db/repositories/configRepository.js';
import { resolveAllCredentials } from '../../db/repositories/credentialsRepository.js';
import { projects } from '../../db/schema/index.js';
import { protectedProcedure, router } from '../trpc.js';

const GITHUB_WEBHOOK_EVENTS = [
	'pull_request',
	'pull_request_review',
	'check_suite',
	'issue_comment',
];

export interface TrelloWebhook {
	id: string;
	description: string;
	idModel: string;
	callbackURL: string;
	active: boolean;
}

export interface GitHubWebhook {
	id: number;
	name: string;
	active: boolean;
	events: string[];
	config: { url?: string; content_type?: string };
}

interface ProjectContext {
	projectId: string;
	orgId: string;
	repo: string;
	boardId: string;
	trelloApiKey: string;
	trelloToken: string;
	githubToken: string;
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

	const creds = await resolveAllCredentials(projectId, project.orgId);

	return {
		projectId,
		orgId: project.orgId,
		repo: project.repo,
		boardId: project.trello.boardId,
		trelloApiKey: creds.TRELLO_API_KEY ?? '',
		trelloToken: creds.TRELLO_TOKEN ?? '',
		githubToken: creds.GITHUB_TOKEN ?? '',
	};
}

// --- Trello helpers ---

async function trelloListWebhooks(ctx: ProjectContext): Promise<TrelloWebhook[]> {
	if (!ctx.trelloApiKey || !ctx.trelloToken) return [];
	const response = await fetch(
		`https://api.trello.com/1/tokens/${ctx.trelloToken}/webhooks?key=${ctx.trelloApiKey}`,
	);
	if (!response.ok) {
		throw new TRPCError({
			code: 'INTERNAL_SERVER_ERROR',
			message: `Failed to list Trello webhooks: ${response.status}`,
		});
	}
	const webhooks = (await response.json()) as TrelloWebhook[];
	return webhooks.filter((w) => w.idModel === ctx.boardId);
}

async function trelloCreateWebhook(
	ctx: ProjectContext,
	callbackURL: string,
): Promise<TrelloWebhook> {
	const response = await fetch(
		`https://api.trello.com/1/webhooks/?key=${ctx.trelloApiKey}&token=${ctx.trelloToken}`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				callbackURL,
				idModel: ctx.boardId,
				description: `CASCADE webhook for project ${ctx.projectId}`,
			}),
		},
	);
	if (!response.ok) {
		throw new TRPCError({
			code: 'INTERNAL_SERVER_ERROR',
			message: `Failed to create Trello webhook: ${response.status}`,
		});
	}
	return (await response.json()) as TrelloWebhook;
}

async function trelloDeleteWebhook(ctx: ProjectContext, webhookId: string): Promise<void> {
	const response = await fetch(
		`https://api.trello.com/1/webhooks/${webhookId}?key=${ctx.trelloApiKey}&token=${ctx.trelloToken}`,
		{ method: 'DELETE' },
	);
	if (!response.ok) {
		throw new TRPCError({
			code: 'INTERNAL_SERVER_ERROR',
			message: `Failed to delete Trello webhook ${webhookId}: ${response.status}`,
		});
	}
}

// --- GitHub helpers ---

function parseRepo(repo: string): { owner: string; repo: string } {
	const [owner, name] = repo.split('/');
	return { owner, repo: name };
}

async function githubListWebhooks(ctx: ProjectContext): Promise<GitHubWebhook[]> {
	if (!ctx.githubToken) return [];
	const octokit = new Octokit({ auth: ctx.githubToken });
	const { owner, repo } = parseRepo(ctx.repo);
	const { data } = await octokit.repos.listWebhooks({ owner, repo });
	return data as GitHubWebhook[];
}

async function githubCreateWebhook(
	ctx: ProjectContext,
	callbackURL: string,
): Promise<GitHubWebhook> {
	const octokit = new Octokit({ auth: ctx.githubToken });
	const { owner, repo } = parseRepo(ctx.repo);
	const { data } = await octokit.repos.createWebhook({
		owner,
		repo,
		config: { url: callbackURL, content_type: 'json' },
		events: GITHUB_WEBHOOK_EVENTS,
		active: true,
	});
	return data as GitHubWebhook;
}

async function githubDeleteWebhook(ctx: ProjectContext, hookId: number): Promise<void> {
	const octokit = new Octokit({ auth: ctx.githubToken });
	const { owner, repo } = parseRepo(ctx.repo);
	await octokit.repos.deleteWebhook({ owner, repo, hook_id: hookId });
}

// --- Router ---

export const webhooksRouter = router({
	list: protectedProcedure
		.input(z.object({ projectId: z.string() }))
		.query(async ({ ctx, input }) => {
			const pctx = await resolveProjectContext(input.projectId, ctx.user.orgId);

			const [trello, github] = await Promise.all([
				trelloListWebhooks(pctx),
				githubListWebhooks(pctx),
			]);

			return { trello, github };
		}),

	create: protectedProcedure
		.input(
			z.object({
				projectId: z.string(),
				callbackBaseUrl: z.string().url(),
				trelloOnly: z.boolean().optional(),
				githubOnly: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const pctx = await resolveProjectContext(input.projectId, ctx.user.orgId);
			const baseUrl = input.callbackBaseUrl.replace(/\/$/, '');
			const results: { trello?: TrelloWebhook | string; github?: GitHubWebhook | string } = {};

			// Trello webhook
			if (!input.githubOnly && pctx.trelloApiKey && pctx.trelloToken) {
				const trelloCallbackUrl = `${baseUrl}/webhook/trello`;
				const existing = await trelloListWebhooks(pctx);
				const duplicate = existing.find((w) => w.callbackURL === trelloCallbackUrl);

				if (duplicate) {
					results.trello = `Already exists: ${duplicate.id}`;
				} else {
					results.trello = await trelloCreateWebhook(pctx, trelloCallbackUrl);
				}
			}

			// GitHub webhook
			if (!input.trelloOnly && pctx.githubToken) {
				const githubCallbackUrl = `${baseUrl}/webhook/github`;
				const existing = await githubListWebhooks(pctx);
				const duplicate = existing.find((w) => w.config.url === githubCallbackUrl);

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
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const pctx = await resolveProjectContext(input.projectId, ctx.user.orgId);
			const baseUrl = input.callbackBaseUrl.replace(/\/$/, '');
			const deleted: { trello: string[]; github: number[] } = { trello: [], github: [] };

			// Trello
			if (!input.githubOnly && pctx.trelloApiKey && pctx.trelloToken) {
				const trelloCallbackUrl = `${baseUrl}/webhook/trello`;
				const existing = await trelloListWebhooks(pctx);
				const matching = existing.filter((w) => w.callbackURL === trelloCallbackUrl);
				for (const w of matching) {
					await trelloDeleteWebhook(pctx, w.id);
					deleted.trello.push(w.id);
				}
			}

			// GitHub
			if (!input.trelloOnly && pctx.githubToken) {
				const githubCallbackUrl = `${baseUrl}/webhook/github`;
				const existing = await githubListWebhooks(pctx);
				const matching = existing.filter((w) => w.config.url === githubCallbackUrl);
				for (const w of matching) {
					await githubDeleteWebhook(pctx, w.id);
					deleted.github.push(w.id);
				}
			}

			return deleted;
		}),
});
