#!/usr/bin/env tsx
/**
 * Manually trigger debug analysis for a specific agent run.
 *
 * Usage:
 *   npm run tool:debug-run <run-id>
 *
 * Requires DATABASE_URL to be set.
 */

import { getAllProjectCredentials } from '../src/config/provider.js';
import { closeDb } from '../src/db/client.js';
import {
	findProjectByIdFromDb,
	loadConfigFromDb,
} from '../src/db/repositories/configRepository.js';
import { getRunById } from '../src/db/repositories/runsRepository.js';
import { withTrelloCredentials } from '../src/trello/client.js';
import { triggerDebugAnalysis } from '../src/triggers/shared/debug-runner.js';

async function main() {
	const runId = process.argv[2];
	if (!runId) {
		console.error('Usage: npm run tool:debug-run <run-id>');
		process.exit(1);
	}

	console.log(`Looking up run ${runId}...`);
	const run = await getRunById(runId);
	if (!run) {
		console.error(`Run not found: ${runId}`);
		process.exit(1);
	}

	console.log('Run found:', {
		agentType: run.agentType,
		status: run.status,
		projectId: run.projectId,
		cardId: run.cardId,
	});

	if (!run.projectId) {
		console.error('Run has no project ID');
		process.exit(1);
	}

	const config = await loadConfigFromDb();
	const project = await findProjectByIdFromDb(run.projectId);
	if (!project) {
		console.error(`Project not found: ${run.projectId}`);
		process.exit(1);
	}

	// Scope Trello credentials for the debug analysis
	const secrets = await getAllProjectCredentials(run.projectId);
	const trelloApiKey = secrets.TRELLO_API_KEY;
	const trelloToken = secrets.TRELLO_TOKEN;

	await withTrelloCredentials({ apiKey: trelloApiKey, token: trelloToken }, async () => {
		console.log('Triggering debug analysis...');
		await triggerDebugAnalysis(runId, project, config, run.cardId ?? undefined);
		console.log('Debug analysis complete.');
	});
}

main()
	.catch((err) => {
		console.error('Error:', err);
		process.exit(1);
	})
	.finally(() => closeDb());
