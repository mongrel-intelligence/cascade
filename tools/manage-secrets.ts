#!/usr/bin/env tsx
/**
 * Manage per-project secrets in the database.
 *
 * Usage:
 *   npx tsx tools/manage-secrets.ts set <project-id> <key> <value>
 *   npx tsx tools/manage-secrets.ts list <project-id>
 *   npx tsx tools/manage-secrets.ts delete <project-id> <key>
 *
 * Requires DATABASE_URL to be set.
 */

import { closeDb } from '../src/db/client.js';
import {
	deleteProjectSecret,
	getProjectSecrets,
	setProjectSecret,
} from '../src/db/repositories/secretsRepository.js';

const WELL_KNOWN_KEYS = [
	'GITHUB_TOKEN',
	'GITHUB_REVIEWER_TOKEN',
	'TRELLO_API_KEY',
	'TRELLO_TOKEN',
	'OPENROUTER_API_KEY',
	'ANTHROPIC_API_KEY',
	'GEMINI_API_KEY',
	'OPENAI_API_KEY',
	'HF_TOKEN',
	'CLAUDE_CODE_OAUTH_TOKEN',
];

function printUsage(): void {
	console.log('Usage:');
	console.log('  npx tsx tools/manage-secrets.ts set <project-id> <key> <value>');
	console.log('  npx tsx tools/manage-secrets.ts list <project-id>');
	console.log('  npx tsx tools/manage-secrets.ts delete <project-id> <key>');
	console.log('');
	console.log('Well-known keys:', WELL_KNOWN_KEYS.join(', '));
}

async function main() {
	const [command, projectId, key, value] = process.argv.slice(2);

	if (!command || !projectId) {
		printUsage();
		process.exit(1);
	}

	switch (command) {
		case 'set': {
			if (!key || !value) {
				console.error('Error: set requires <key> and <value>');
				printUsage();
				process.exit(1);
			}
			await setProjectSecret(projectId, key, value);
			console.log(`Set ${key} for project ${projectId}`);
			break;
		}

		case 'list': {
			const secrets = await getProjectSecrets(projectId);
			const keys = Object.keys(secrets);
			if (keys.length === 0) {
				console.log(`No secrets found for project ${projectId}`);
			} else {
				console.log(`Secrets for project ${projectId}:`);
				for (const k of keys) {
					const masked = `${secrets[k].slice(0, 4)}...${secrets[k].slice(-4)}`;
					console.log(`  ${k}: ${masked}`);
				}
			}
			break;
		}

		case 'delete': {
			if (!key) {
				console.error('Error: delete requires <key>');
				printUsage();
				process.exit(1);
			}
			await deleteProjectSecret(projectId, key);
			console.log(`Deleted ${key} for project ${projectId}`);
			break;
		}

		default:
			console.error(`Unknown command: ${command}`);
			printUsage();
			process.exit(1);
	}

	await closeDb();
}

main().catch((err) => {
	console.error('Error:', err);
	process.exit(1);
});
