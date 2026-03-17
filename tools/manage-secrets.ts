#!/usr/bin/env tsx
/**
 * Manage project-scoped credentials.
 *
 * Usage:
 *   npx tsx tools/manage-secrets.ts set <project-id> <env-var-key> <value> [--name "..."]
 *   npx tsx tools/manage-secrets.ts list <project-id>
 *   npx tsx tools/manage-secrets.ts delete <project-id> <env-var-key>
 *   npx tsx tools/manage-secrets.ts resolve <project-id>
 *
 * Requires DATABASE_URL to be set.
 */

import { closeDb } from '../src/db/client.js';
import { findProjectByIdFromDb } from '../src/db/repositories/configRepository.js';
import {
	deleteProjectCredential,
	listProjectCredentials,
	writeProjectCredential,
} from '../src/db/repositories/credentialsRepository.js';

function printUsage(): void {
	console.log('Usage:');
	console.log(
		'  npx tsx tools/manage-secrets.ts set <project-id> <env-var-key> <value> [--name "..."]',
	);
	console.log('  npx tsx tools/manage-secrets.ts list <project-id>');
	console.log('  npx tsx tools/manage-secrets.ts delete <project-id> <env-var-key>');
	console.log('  npx tsx tools/manage-secrets.ts resolve <project-id>');
}

function parseFlag(args: string[], flag: string): string | undefined {
	const idx = args.indexOf(flag);
	if (idx === -1 || idx + 1 >= args.length) return undefined;
	return args[idx + 1];
}

function maskValue(value: string): string {
	if (value.length <= 8) return '****';
	return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function handleSet(args: string[]): Promise<void> {
	const [, projectId, envVarKey, value] = args;
	if (!projectId || !envVarKey || !value) {
		console.error('Error: set requires <project-id> <env-var-key> <value>');
		printUsage();
		process.exit(1);
	}
	const name = parseFlag(args, '--name') ?? undefined;

	const project = await findProjectByIdFromDb(projectId);
	if (!project) {
		console.error(`Project '${projectId}' not found`);
		process.exit(1);
	}

	await writeProjectCredential(projectId, envVarKey, value, name ?? null);
	console.log(`Set credential ${envVarKey} for project ${projectId}${name ? ` (${name})` : ''}`);
}

async function handleList(args: string[]): Promise<void> {
	const projectId = args[1];
	if (!projectId) {
		console.error('Error: list requires <project-id>');
		printUsage();
		process.exit(1);
	}
	const project = await findProjectByIdFromDb(projectId);
	if (!project) {
		console.error(`Project '${projectId}' not found`);
		process.exit(1);
	}

	const creds = await listProjectCredentials(projectId);
	if (creds.length === 0) {
		console.log(`No credentials found for project ${projectId}`);
		return;
	}
	console.log(`Credentials for project ${projectId}:`);
	for (const c of creds) {
		const nameTag = c.name ? ` (${c.name})` : '';
		console.log(`  ${c.envVarKey}${nameTag} = ${maskValue(c.value)}`);
	}
}

async function handleDelete(args: string[]): Promise<void> {
	const projectId = args[1];
	const envVarKey = args[2];
	if (!projectId || !envVarKey) {
		console.error('Error: delete requires <project-id> <env-var-key>');
		printUsage();
		process.exit(1);
	}

	const project = await findProjectByIdFromDb(projectId);
	if (!project) {
		console.error(`Project '${projectId}' not found`);
		process.exit(1);
	}

	await deleteProjectCredential(projectId, envVarKey);
	console.log(`Deleted credential ${envVarKey} from project ${projectId}`);
}

async function handleResolve(args: string[]): Promise<void> {
	const projectId = args[1];
	if (!projectId) {
		console.error('Error: resolve requires <project-id>');
		printUsage();
		process.exit(1);
	}
	const project = await findProjectByIdFromDb(projectId);
	if (!project) {
		console.error(`Project '${projectId}' not found`);
		process.exit(1);
	}

	// Resolve project-scoped credentials
	const projectCreds = await listProjectCredentials(projectId);

	if (projectCreds.length === 0) {
		console.log(`No credentials resolved for project ${projectId}`);
		return;
	}

	console.log(`Resolved credentials for project ${projectId}:`);

	for (const c of projectCreds) {
		const nameTag = c.name ? ` (${c.name})` : '';
		console.log(`  ${c.envVarKey}${nameTag}: ${maskValue(c.value)}`);
	}
}

const commandHandlers: Record<string, (args: string[]) => Promise<void>> = {
	set: handleSet,
	list: handleList,
	delete: handleDelete,
	resolve: handleResolve,
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
