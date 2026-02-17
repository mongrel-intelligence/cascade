#!/usr/bin/env tsx
/**
 * Manage org-scoped credentials and per-project overrides.
 *
 * Usage:
 *   npx tsx tools/manage-secrets.ts create <org-id> <env-var-key> <value> [--name "..."] [--default]
 *   npx tsx tools/manage-secrets.ts list <org-id>
 *   npx tsx tools/manage-secrets.ts delete <credential-id>
 *   npx tsx tools/manage-secrets.ts set-override <project-id> <env-var-key> <credential-id> [--agent-type <type>]
 *   npx tsx tools/manage-secrets.ts remove-override <project-id> <env-var-key> [--agent-type <type>]
 *   npx tsx tools/manage-secrets.ts resolve <project-id>
 *
 * Requires DATABASE_URL to be set.
 */

import { closeDb } from '../src/db/client.js';
import { findProjectByIdFromDb } from '../src/db/repositories/configRepository.js';
import {
	createCredential,
	deleteCredential,
	listOrgCredentials,
	listProjectOverrides,
	removeAgentCredentialOverride,
	removeProjectCredentialOverride,
	resolveAllCredentials,
	setAgentCredentialOverride,
	setProjectCredentialOverride,
} from '../src/db/repositories/credentialsRepository.js';

function printUsage(): void {
	console.log('Usage:');
	console.log(
		'  npx tsx tools/manage-secrets.ts create <org-id> <env-var-key> <value> [--name "..."] [--default]',
	);
	console.log('  npx tsx tools/manage-secrets.ts list <org-id>');
	console.log('  npx tsx tools/manage-secrets.ts delete <credential-id>');
	console.log(
		'  npx tsx tools/manage-secrets.ts set-override <project-id> <env-var-key> <credential-id> [--agent-type <type>]',
	);
	console.log(
		'  npx tsx tools/manage-secrets.ts remove-override <project-id> <env-var-key> [--agent-type <type>]',
	);
	console.log('  npx tsx tools/manage-secrets.ts resolve <project-id>');
}

function parseFlag(args: string[], flag: string): string | undefined {
	const idx = args.indexOf(flag);
	if (idx === -1 || idx + 1 >= args.length) return undefined;
	return args[idx + 1];
}

function hasFlag(args: string[], flag: string): boolean {
	return args.includes(flag);
}

function maskValue(value: string): string {
	if (value.length <= 8) return '****';
	return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function handleCreate(args: string[]): Promise<void> {
	const [, orgId, envVarKey, value] = args;
	if (!orgId || !envVarKey || !value) {
		console.error('Error: create requires <org-id> <env-var-key> <value>');
		printUsage();
		process.exit(1);
	}
	const name = parseFlag(args, '--name') ?? envVarKey;
	const isDefault = hasFlag(args, '--default');

	const { id } = await createCredential({ orgId, name, envVarKey, value, isDefault });
	console.log(
		`Created credential #${id}: ${name} (${envVarKey}) for org ${orgId}${isDefault ? ' [DEFAULT]' : ''}`,
	);
}

async function handleList(args: string[]): Promise<void> {
	const orgId = args[1];
	if (!orgId) {
		console.error('Error: list requires <org-id>');
		printUsage();
		process.exit(1);
	}
	const creds = await listOrgCredentials(orgId);
	if (creds.length === 0) {
		console.log(`No credentials found for org ${orgId}`);
		return;
	}
	console.log(`Credentials for org ${orgId}:`);
	for (const c of creds) {
		const defaultTag = c.isDefault ? ' [DEFAULT]' : '';
		console.log(`  #${c.id}: ${c.name} (${c.envVarKey}) = ${maskValue(c.value)}${defaultTag}`);
	}
}

async function handleDelete(args: string[]): Promise<void> {
	const credIdStr = args[1];
	if (!credIdStr) {
		console.error('Error: delete requires <credential-id>');
		printUsage();
		process.exit(1);
	}
	const credId = Number.parseInt(credIdStr, 10);
	if (Number.isNaN(credId)) {
		console.error('Error: credential-id must be a number');
		process.exit(1);
	}
	await deleteCredential(credId);
	console.log(`Deleted credential #${credId}`);
}

function parseCredentialId(str: string): number {
	const credId = Number.parseInt(str, 10);
	if (Number.isNaN(credId)) {
		console.error('Error: credential-id must be a number');
		process.exit(1);
	}
	return credId;
}

async function handleSetOverride(args: string[]): Promise<void> {
	const [, projectId, envVarKey, credIdStr] = args;
	if (!projectId || !envVarKey || !credIdStr) {
		console.error('Error: set-override requires <project-id> <env-var-key> <credential-id>');
		printUsage();
		process.exit(1);
	}
	const credId = parseCredentialId(credIdStr);
	const agentType = parseFlag(args, '--agent-type');
	if (agentType) {
		await setAgentCredentialOverride(projectId, envVarKey, agentType, credId);
		console.log(
			`Set agent override: project ${projectId} → ${envVarKey} → credential #${credId} (agent: ${agentType})`,
		);
	} else {
		await setProjectCredentialOverride(projectId, envVarKey, credId);
		console.log(`Set override: project ${projectId} → ${envVarKey} → credential #${credId}`);
	}
}

async function handleRemoveOverride(args: string[]): Promise<void> {
	const [, projectId, envVarKey] = args;
	if (!projectId || !envVarKey) {
		console.error('Error: remove-override requires <project-id> <env-var-key>');
		printUsage();
		process.exit(1);
	}
	const agentType = parseFlag(args, '--agent-type');
	if (agentType) {
		await removeAgentCredentialOverride(projectId, envVarKey, agentType);
		console.log(
			`Removed agent override: project ${projectId} → ${envVarKey} (agent: ${agentType})`,
		);
	} else {
		await removeProjectCredentialOverride(projectId, envVarKey);
		console.log(`Removed override: project ${projectId} → ${envVarKey}`);
	}
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
	const resolved = await resolveAllCredentials(projectId, project.orgId);
	const overrides = await listProjectOverrides(projectId);
	const projectOverrideKeys = new Set(
		overrides.filter((o) => !o.agentType).map((o) => o.envVarKey),
	);
	const agentOverrides = overrides.filter((o) => o.agentType);

	if (Object.keys(resolved).length === 0 && agentOverrides.length === 0) {
		console.log(`No credentials resolved for project ${projectId}`);
		return;
	}
	console.log(`Resolved credentials for project ${projectId} (org: ${project.orgId}):`);
	for (const [key, value] of Object.entries(resolved)) {
		const source = projectOverrideKeys.has(key) ? 'override' : 'org-default';
		console.log(`  ${key}: ${maskValue(value)} [${source}]`);
	}
	if (agentOverrides.length > 0) {
		console.log('  Agent-scoped overrides:');
		for (const o of agentOverrides) {
			console.log(`    ${o.envVarKey} → ${o.credentialName} (agent: ${o.agentType})`);
		}
	}
}

const commandHandlers: Record<string, (args: string[]) => Promise<void>> = {
	create: handleCreate,
	list: handleList,
	delete: handleDelete,
	'set-override': handleSetOverride,
	'remove-override': handleRemoveOverride,
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
