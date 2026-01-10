#!/usr/bin/env tsx
/**
 * Entrypoint script that runs inside the Docker container.
 * Starts services and executes the agent.
 *
 * This script is called by run-local.ts via Docker.
 */

import { execSync } from 'node:child_process';
import { runAgent } from '../src/agents/registry.js';
import { loadProjectsConfig } from '../src/config/projects.js';

const CONFIG_PATH = '/app/config/projects.json';

async function getCardBoardId(cardId: string): Promise<string> {
	const apiKey = process.env.TRELLO_API_KEY;
	const token = process.env.TRELLO_TOKEN;

	if (!apiKey || !token) {
		throw new Error('TRELLO_API_KEY and TRELLO_TOKEN must be set');
	}

	const response = await fetch(
		`https://api.trello.com/1/cards/${cardId}?fields=idBoard&key=${apiKey}&token=${token}`,
	);

	if (!response.ok) {
		throw new Error(`Failed to fetch card ${cardId}: ${response.status}`);
	}

	const card = (await response.json()) as { idBoard: string };
	return card.idBoard;
}

function startServices(): void {
	console.log('Starting PostgreSQL...');
	try {
		execSync(
			'su postgres -c "/usr/lib/postgresql/*/bin/pg_ctl start -D /var/lib/postgresql/data -l /tmp/postgres.log -w"',
			{ stdio: 'inherit' },
		);
	} catch (err) {
		console.warn('PostgreSQL may already be running or failed to start:', err);
	}

	console.log('Starting Redis...');
	try {
		execSync('redis-server /etc/redis/redis.conf --daemonize yes', { stdio: 'inherit' });
	} catch (err) {
		console.warn('Redis may already be running or failed to start:', err);
	}

	console.log('Services started.\n');
}

async function main() {
	const [agentType, cardId] = process.argv.slice(2);

	if (!agentType || !cardId) {
		console.error('Usage: run-agent-entrypoint.ts <agent-type> <card-id>');
		process.exit(1);
	}

	console.log('='.repeat(60));
	console.log('CASCADE Local Agent Runner');
	console.log('='.repeat(60));
	console.log(`Agent Type: ${agentType}`);
	console.log(`Card ID: ${cardId}`);
	console.log('');

	// Start services
	startServices();

	// Load config
	console.log('Loading configuration...');
	const config = loadProjectsConfig(CONFIG_PATH);
	console.log(`Found ${config.projects.length} project(s)`);

	// Get board ID from card to find the right project
	console.log('Fetching card to determine project...');
	const boardId = await getCardBoardId(cardId);
	console.log(`Card belongs to board: ${boardId}`);

	const project = config.projects.find((p) => p.trello.boardId === boardId);
	if (!project) {
		console.error(`No project configured for board ${boardId}`);
		console.error('Available projects:');
		for (const p of config.projects) {
			console.error(`  - ${p.id}: board ${p.trello.boardId}`);
		}
		process.exit(1);
	}

	console.log(`Using project: ${project.id} (${project.name})`);
	console.log('');
	console.log('='.repeat(60));
	console.log('Starting agent...');
	console.log('='.repeat(60));
	console.log('');

	// Run the agent
	const startTime = Date.now();
	const result = await runAgent(agentType, {
		project,
		config,
		cardId,
	});
	const durationMs = Date.now() - startTime;

	console.log('');
	console.log('='.repeat(60));
	console.log('Agent Result');
	console.log('='.repeat(60));
	console.log(`Success: ${result.success}`);
	console.log(`Duration: ${(durationMs / 1000).toFixed(1)}s`);
	if (result.cost) {
		console.log(`Cost: $${result.cost.toFixed(4)}`);
	}
	if (result.error) {
		console.log(`Error: ${result.error}`);
	}
	if (result.prUrl) {
		console.log(`PR URL: ${result.prUrl}`);
	}
	console.log('');
	console.log('Output (truncated):');
	console.log('-'.repeat(60));
	console.log(result.output.slice(0, 2000));
	if (result.output.length > 2000) {
		console.log(`... (${result.output.length - 2000} more characters)`);
	}

	process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
	console.error('Fatal error:', err);
	process.exit(1);
});
