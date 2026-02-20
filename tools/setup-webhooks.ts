#!/usr/bin/env tsx
/**
 * Set up Trello and GitHub webhooks for a project.
 *
 * Usage:
 *   npx tsx tools/setup-webhooks.ts create <project-id> <callback-base-url>
 *   npx tsx tools/setup-webhooks.ts list <project-id>
 *   npx tsx tools/setup-webhooks.ts delete <project-id> <callback-base-url>
 *
 * Options:
 *   --trello-only    Only operate on Trello webhooks
 *   --github-only    Only operate on GitHub webhooks
 *
 * Requires DATABASE_URL to be set.
 */

import { Octokit } from '@octokit/rest';
import { PROVIDER_CREDENTIAL_ROLES } from '../src/config/integrationRoles.js';
import type { IntegrationProvider } from '../src/config/integrationRoles.js';
import { closeDb } from '../src/db/client.js';
import { findProjectByIdFromDb } from '../src/db/repositories/configRepository.js';
import {
	resolveAllIntegrationCredentials,
	resolveAllOrgCredentials,
} from '../src/db/repositories/credentialsRepository.js';

const GITHUB_WEBHOOK_EVENTS = [
	'pull_request',
	'pull_request_review',
	'check_suite',
	'issue_comment',
];

interface TrelloWebhook {
	id: string;
	description: string;
	idModel: string;
	callbackURL: string;
	active: boolean;
}

function printUsage(): void {
	console.log('Usage:');
	console.log('  npx tsx tools/setup-webhooks.ts create <project-id> <callback-base-url>');
	console.log('  npx tsx tools/setup-webhooks.ts list <project-id>');
	console.log('  npx tsx tools/setup-webhooks.ts delete <project-id> <callback-base-url>');
	console.log('');
	console.log('Options:');
	console.log('  --trello-only    Only operate on Trello webhooks');
	console.log('  --github-only    Only operate on GitHub webhooks');
}

function hasFlag(args: string[], flag: string): boolean {
	return args.includes(flag);
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

async function resolveProjectContext(projectId: string): Promise<ProjectContext> {
	const project = await findProjectByIdFromDb(projectId);
	if (!project) {
		console.error(`Project '${projectId}' not found`);
		process.exit(1);
	}

	// Build credential map from integration credentials + org defaults
	const integrationCreds = await resolveAllIntegrationCredentials(projectId);
	const orgCreds = await resolveAllOrgCredentials(project.orgId);

	const credMap: Record<string, string> = { ...orgCreds };
	for (const cred of integrationCreds) {
		const roles = PROVIDER_CREDENTIAL_ROLES[cred.provider as IntegrationProvider];
		if (!roles) continue;
		const roleDef = roles.find((r) => r.role === cred.role);
		if (roleDef) {
			credMap[roleDef.envVarKey] = cred.value;
		}
	}

	const trelloApiKey = credMap.TRELLO_API_KEY;
	const trelloToken = credMap.TRELLO_TOKEN;
	const githubToken = credMap.GITHUB_TOKEN_IMPLEMENTER ?? credMap.GITHUB_TOKEN;

	if (!trelloApiKey || !trelloToken) {
		console.warn(
			'Warning: TRELLO_API_KEY or TRELLO_TOKEN not found — Trello operations will be skipped',
		);
	}
	if (!githubToken) {
		console.warn('Warning: GITHUB_TOKEN not found — GitHub operations will be skipped');
	}

	return {
		projectId,
		orgId: project.orgId,
		repo: project.repo,
		boardId: project.trello.boardId,
		trelloApiKey: trelloApiKey ?? '',
		trelloToken: trelloToken ?? '',
		githubToken: githubToken ?? '',
	};
}

// --- Trello webhook operations ---

async function trelloListWebhooks(ctx: ProjectContext): Promise<TrelloWebhook[]> {
	const response = await fetch(
		`https://api.trello.com/1/tokens/${ctx.trelloToken}/webhooks?key=${ctx.trelloApiKey}`,
	);
	if (!response.ok) {
		throw new Error(`Failed to list Trello webhooks: ${response.status} ${await response.text()}`);
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
		throw new Error(`Failed to create Trello webhook: ${response.status} ${await response.text()}`);
	}
	return (await response.json()) as TrelloWebhook;
}

async function trelloDeleteWebhook(ctx: ProjectContext, webhookId: string): Promise<void> {
	const response = await fetch(
		`https://api.trello.com/1/webhooks/${webhookId}?key=${ctx.trelloApiKey}&token=${ctx.trelloToken}`,
		{ method: 'DELETE' },
	);
	if (!response.ok) {
		throw new Error(
			`Failed to delete Trello webhook ${webhookId}: ${response.status} ${await response.text()}`,
		);
	}
}

// --- GitHub webhook operations ---

function getOctokit(token: string): Octokit {
	return new Octokit({ auth: token });
}

function parseRepo(repo: string): { owner: string; repo: string } {
	const [owner, name] = repo.split('/');
	return { owner, repo: name };
}

interface GitHubWebhook {
	id: number;
	name: string;
	active: boolean;
	events: string[];
	config: { url?: string; content_type?: string };
}

async function githubListWebhooks(ctx: ProjectContext): Promise<GitHubWebhook[]> {
	const octokit = getOctokit(ctx.githubToken);
	const { owner, repo } = parseRepo(ctx.repo);
	const { data } = await octokit.repos.listWebhooks({ owner, repo });
	return data as GitHubWebhook[];
}

async function githubCreateWebhook(
	ctx: ProjectContext,
	callbackURL: string,
): Promise<GitHubWebhook> {
	const octokit = getOctokit(ctx.githubToken);
	const { owner, repo } = parseRepo(ctx.repo);
	const { data } = await octokit.repos.createWebhook({
		owner,
		repo,
		config: {
			url: callbackURL,
			content_type: 'json',
		},
		events: GITHUB_WEBHOOK_EVENTS,
		active: true,
	});
	return data as GitHubWebhook;
}

async function githubDeleteWebhook(ctx: ProjectContext, hookId: number): Promise<void> {
	const octokit = getOctokit(ctx.githubToken);
	const { owner, repo } = parseRepo(ctx.repo);
	await octokit.repos.deleteWebhook({ owner, repo, hook_id: hookId });
}

// --- Print helpers ---

function printTrelloWebhooks(webhooks: TrelloWebhook[]): void {
	console.log('Trello webhooks:');
	if (webhooks.length === 0) {
		console.log('  (none)');
	} else {
		for (const w of webhooks) {
			console.log(`  [${w.id}] ${w.callbackURL} (active: ${w.active})`);
			if (w.description) console.log(`    description: ${w.description}`);
		}
	}
	console.log('');
}

function printGitHubWebhooks(webhooks: GitHubWebhook[]): void {
	console.log('GitHub webhooks:');
	if (webhooks.length === 0) {
		console.log('  (none)');
	} else {
		for (const w of webhooks) {
			console.log(
				`  [${w.id}] ${w.config.url} (active: ${w.active}, events: ${w.events.join(', ')})`,
			);
		}
	}
	console.log('');
}

// --- Command handlers ---

async function handleList(args: string[]): Promise<void> {
	const projectId = args[1];
	if (!projectId) {
		console.error('Error: list requires <project-id>');
		printUsage();
		process.exit(1);
	}

	const trelloOnly = hasFlag(args, '--trello-only');
	const githubOnly = hasFlag(args, '--github-only');
	const ctx = await resolveProjectContext(projectId);

	console.log(`Project: ${ctx.projectId} (org: ${ctx.orgId})`);
	console.log(`Repo: ${ctx.repo}`);
	console.log(`Trello board: ${ctx.boardId}`);
	console.log('');

	if (!githubOnly && ctx.trelloApiKey && ctx.trelloToken) {
		printTrelloWebhooks(await trelloListWebhooks(ctx));
	}

	if (!trelloOnly && ctx.githubToken) {
		printGitHubWebhooks(await githubListWebhooks(ctx));
	}
}

async function handleCreate(args: string[]): Promise<void> {
	const [, projectId, callbackBaseUrl] = args;
	if (!projectId || !callbackBaseUrl) {
		console.error('Error: create requires <project-id> <callback-base-url>');
		printUsage();
		process.exit(1);
	}

	const trelloOnly = hasFlag(args, '--trello-only');
	const githubOnly = hasFlag(args, '--github-only');
	const ctx = await resolveProjectContext(projectId);
	const baseUrl = callbackBaseUrl.replace(/\/$/, '');

	// Trello webhook
	if (!githubOnly && ctx.trelloApiKey && ctx.trelloToken) {
		const trelloCallbackUrl = `${baseUrl}/webhook/trello`;
		const existing = await trelloListWebhooks(ctx);
		const duplicate = existing.find((w) => w.callbackURL === trelloCallbackUrl);

		if (duplicate) {
			console.log(`Trello webhook already exists: [${duplicate.id}] ${duplicate.callbackURL}`);
		} else {
			const created = await trelloCreateWebhook(ctx, trelloCallbackUrl);
			console.log(`Created Trello webhook: [${created.id}] ${created.callbackURL}`);
		}
	}

	// GitHub webhook
	if (!trelloOnly && ctx.githubToken) {
		const githubCallbackUrl = `${baseUrl}/webhook/github`;
		const existing = await githubListWebhooks(ctx);
		const duplicate = existing.find((w) => w.config.url === githubCallbackUrl);

		if (duplicate) {
			console.log(`GitHub webhook already exists: [${duplicate.id}] ${duplicate.config.url}`);
		} else {
			const created = await githubCreateWebhook(ctx, githubCallbackUrl);
			console.log(
				`Created GitHub webhook: [${created.id}] ${created.config.url} (events: ${created.events.join(', ')})`,
			);
		}
	}
}

async function deleteTrelloWebhooksForUrl(ctx: ProjectContext, callbackUrl: string): Promise<void> {
	const existing = await trelloListWebhooks(ctx);
	const matching = existing.filter((w) => w.callbackURL === callbackUrl);

	if (matching.length === 0) {
		console.log(`No Trello webhook found for ${callbackUrl}`);
	} else {
		for (const w of matching) {
			await trelloDeleteWebhook(ctx, w.id);
			console.log(`Deleted Trello webhook: [${w.id}] ${w.callbackURL}`);
		}
	}
}

async function deleteGitHubWebhooksForUrl(ctx: ProjectContext, callbackUrl: string): Promise<void> {
	const existing = await githubListWebhooks(ctx);
	const matching = existing.filter((w) => w.config.url === callbackUrl);

	if (matching.length === 0) {
		console.log(`No GitHub webhook found for ${callbackUrl}`);
	} else {
		for (const w of matching) {
			await githubDeleteWebhook(ctx, w.id);
			console.log(`Deleted GitHub webhook: [${w.id}] ${w.config.url}`);
		}
	}
}

async function handleDelete(args: string[]): Promise<void> {
	const [, projectId, callbackBaseUrl] = args;
	if (!projectId || !callbackBaseUrl) {
		console.error('Error: delete requires <project-id> <callback-base-url>');
		printUsage();
		process.exit(1);
	}

	const trelloOnly = hasFlag(args, '--trello-only');
	const githubOnly = hasFlag(args, '--github-only');
	const ctx = await resolveProjectContext(projectId);
	const baseUrl = callbackBaseUrl.replace(/\/$/, '');

	if (!githubOnly && ctx.trelloApiKey && ctx.trelloToken) {
		await deleteTrelloWebhooksForUrl(ctx, `${baseUrl}/webhook/trello`);
	}

	if (!trelloOnly && ctx.githubToken) {
		await deleteGitHubWebhooksForUrl(ctx, `${baseUrl}/webhook/github`);
	}
}

// --- Main ---

const commandHandlers: Record<string, (args: string[]) => Promise<void>> = {
	create: handleCreate,
	list: handleList,
	delete: handleDelete,
};

async function main() {
	const args = process.argv.slice(2);
	const command = args[0];

	if (!command) {
		printUsage();
		process.exit(1);
	}

	const handler = commandHandlers[command];
	if (!handler) {
		console.error(`Unknown command: ${command}`);
		printUsage();
		process.exit(1);
	}

	await handler(args);
	await closeDb();
}

main().catch((err) => {
	console.error('Error:', err);
	process.exit(1);
});
