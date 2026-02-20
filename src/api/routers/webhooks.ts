import { Octokit } from '@octokit/rest';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { PROVIDER_CREDENTIAL_ROLES } from '../../config/integrationRoles.js';
import type { IntegrationProvider } from '../../config/integrationRoles.js';
import { getDb } from '../../db/client.js';
import { findProjectByIdFromDb } from '../../db/repositories/configRepository.js';
import {
	resolveAllIntegrationCredentials,
	resolveAllOrgCredentials,
} from '../../db/repositories/credentialsRepository.js';
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

export interface JiraWebhookInfo {
	id: number;
	name: string;
	url: string;
	events: string[];
	enabled: boolean;
}

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

async function buildCredentialMap(
	projectId: string,
	orgId: string,
): Promise<Record<string, string>> {
	const [integrationCreds, orgCreds] = await Promise.all([
		resolveAllIntegrationCredentials(projectId),
		resolveAllOrgCredentials(orgId),
	]);

	const creds: Record<string, string> = { ...orgCreds };
	for (const cred of integrationCreds) {
		const roles = PROVIDER_CREDENTIAL_ROLES[cred.provider as IntegrationProvider];
		if (!roles) continue;
		const roleDef = roles.find((r) => r.role === cred.role);
		if (roleDef) {
			creds[roleDef.envVarKey] = cred.value;
		}
	}
	return creds;
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

	const creds = await buildCredentialMap(projectId, project.orgId);

	// Resolve JIRA label names from config (with defaults)
	const jiraLabels = project.jira
		? [
				project.jira.labels?.processing ?? 'cascade-processing',
				project.jira.labels?.processed ?? 'cascade-processed',
				project.jira.labels?.error ?? 'cascade-error',
				project.jira.labels?.readyToProcess ?? 'cascade-ready',
			]
		: undefined;

	return {
		projectId,
		orgId: project.orgId,
		repo: project.repo,
		pmType: project.pm?.type ?? 'trello',
		boardId: project.trello?.boardId,
		jiraBaseUrl: project.jira?.baseUrl,
		jiraProjectKey: project.jira?.projectKey,
		jiraLabels,
		trelloApiKey: creds.TRELLO_API_KEY ?? '',
		trelloToken: creds.TRELLO_TOKEN ?? '',
		githubToken: creds.GITHUB_TOKEN_IMPLEMENTER ?? '',
		jiraEmail: creds.JIRA_EMAIL ?? '',
		jiraApiToken: creds.JIRA_API_TOKEN ?? '',
	};
}

// --- Trello helpers ---

async function trelloListWebhooks(ctx: ProjectContext): Promise<TrelloWebhook[]> {
	if (!ctx.trelloApiKey || !ctx.trelloToken || !ctx.boardId) return [];
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

// --- JIRA helpers ---

function jiraAuthHeader(ctx: ProjectContext): string {
	return `Basic ${Buffer.from(`${ctx.jiraEmail}:${ctx.jiraApiToken}`).toString('base64')}`;
}

async function jiraListWebhooks(ctx: ProjectContext): Promise<JiraWebhookInfo[]> {
	if (!ctx.jiraBaseUrl || !ctx.jiraEmail || !ctx.jiraApiToken) return [];
	const response = await fetch(`${ctx.jiraBaseUrl}/rest/api/3/webhook`, {
		headers: {
			Authorization: jiraAuthHeader(ctx),
			Accept: 'application/json',
		},
	});
	if (!response.ok) {
		throw new TRPCError({
			code: 'INTERNAL_SERVER_ERROR',
			message: `Failed to list JIRA webhooks: ${response.status}`,
		});
	}
	const data = (await response.json()) as { values?: JiraWebhookInfo[] };
	return data.values ?? [];
}

async function jiraCreateWebhook(
	ctx: ProjectContext,
	callbackURL: string,
): Promise<JiraWebhookInfo> {
	if (!ctx.jiraBaseUrl || !ctx.jiraEmail || !ctx.jiraApiToken) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: 'JIRA credentials not configured',
		});
	}
	const response = await fetch(`${ctx.jiraBaseUrl}/rest/api/3/webhook`, {
		method: 'POST',
		headers: {
			Authorization: jiraAuthHeader(ctx),
			'Content-Type': 'application/json',
			Accept: 'application/json',
		},
		body: JSON.stringify({
			url: callbackURL,
			webhooks: [
				{
					jqlFilter: '*',
					events: [
						'jira:issue_created',
						'jira:issue_updated',
						'comment_created',
						'comment_updated',
					],
				},
			],
		}),
	});
	if (!response.ok) {
		const errorText = await response.text().catch(() => '');
		throw new TRPCError({
			code: 'INTERNAL_SERVER_ERROR',
			message: `Failed to create JIRA webhook: ${response.status} ${errorText}`,
		});
	}
	return (await response.json()) as JiraWebhookInfo;
}

async function jiraDeleteWebhook(ctx: ProjectContext, webhookId: number): Promise<void> {
	if (!ctx.jiraBaseUrl || !ctx.jiraEmail || !ctx.jiraApiToken) return;
	const response = await fetch(`${ctx.jiraBaseUrl}/rest/api/3/webhook`, {
		method: 'DELETE',
		headers: {
			Authorization: jiraAuthHeader(ctx),
			'Content-Type': 'application/json',
			Accept: 'application/json',
		},
		body: JSON.stringify({ webhookIds: [webhookId] }),
	});
	if (!response.ok) {
		throw new TRPCError({
			code: 'INTERNAL_SERVER_ERROR',
			message: `Failed to delete JIRA webhook ${webhookId}: ${response.status}`,
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

// --- JIRA label seeding ---

/**
 * Ensure CASCADE labels exist in JIRA's autocomplete by briefly adding them to
 * an issue and immediately removing them. JIRA auto-creates labels when first
 * used, but they won't appear in autocomplete until then.
 *
 * Returns the list of labels that were seeded, or an empty array if the project
 * has no issues yet.
 */
async function jiraEnsureLabels(ctx: ProjectContext): Promise<string[]> {
	if (!ctx.jiraBaseUrl || !ctx.jiraEmail || !ctx.jiraApiToken || !ctx.jiraProjectKey) {
		return [];
	}

	const labelsToSeed = ctx.jiraLabels ?? [];
	if (labelsToSeed.length === 0) return [];

	const auth = jiraAuthHeader(ctx);

	// Find one issue in the project
	const searchResponse = await fetch(
		`${ctx.jiraBaseUrl}/rest/api/3/search?jql=${encodeURIComponent(`project = "${ctx.jiraProjectKey}" ORDER BY created DESC`)}&maxResults=1&fields=labels`,
		{
			headers: { Authorization: auth, Accept: 'application/json' },
		},
	);

	if (!searchResponse.ok) return [];

	const searchData = (await searchResponse.json()) as {
		issues?: Array<{ key: string; fields?: { labels?: string[] } }>;
	};

	const issue = searchData.issues?.[0];
	if (!issue) {
		// No issues in the project yet — labels will be created when first agent runs
		return [];
	}

	const existingLabels = issue.fields?.labels ?? [];
	const newLabels = labelsToSeed.filter((l) => !existingLabels.includes(l));

	if (newLabels.length === 0) {
		// All labels already exist in the project
		return labelsToSeed;
	}

	// Add all CASCADE labels to the issue
	const addResponse = await fetch(`${ctx.jiraBaseUrl}/rest/api/3/issue/${issue.key}`, {
		method: 'PUT',
		headers: {
			Authorization: auth,
			'Content-Type': 'application/json',
			Accept: 'application/json',
		},
		body: JSON.stringify({
			fields: {
				labels: [...existingLabels, ...newLabels],
			},
		}),
	});

	if (!addResponse.ok) return [];

	// Immediately restore original labels
	await fetch(`${ctx.jiraBaseUrl}/rest/api/3/issue/${issue.key}`, {
		method: 'PUT',
		headers: {
			Authorization: auth,
			'Content-Type': 'application/json',
			Accept: 'application/json',
		},
		body: JSON.stringify({
			fields: {
				labels: existingLabels,
			},
		}),
	});

	return labelsToSeed;
}

// --- Router ---

export const webhooksRouter = router({
	list: protectedProcedure
		.input(z.object({ projectId: z.string() }))
		.query(async ({ ctx, input }) => {
			const pctx = await resolveProjectContext(input.projectId, ctx.effectiveOrgId);

			const [trello, github, jira] = await Promise.all([
				trelloListWebhooks(pctx),
				githubListWebhooks(pctx),
				jiraListWebhooks(pctx),
			]);

			return { trello, github, jira };
		}),

	create: protectedProcedure
		.input(
			z.object({
				projectId: z.string(),
				callbackBaseUrl: z.string().url(),
				trelloOnly: z.boolean().optional(),
				githubOnly: z.boolean().optional(),
				jiraOnly: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const pctx = await resolveProjectContext(input.projectId, ctx.effectiveOrgId);
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
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const pctx = await resolveProjectContext(input.projectId, ctx.effectiveOrgId);
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
