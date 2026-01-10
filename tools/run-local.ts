#!/usr/bin/env tsx
/**
 * Run a CASCADE agent locally in Docker against a Trello card.
 *
 * Usage:
 *   npm run tool:run-local briefing https://trello.com/c/abc123/card-name
 *   npm run tool:run-local implementation abc123
 *   npm run tool:run-local planning abc123 --rebuild
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const VALID_AGENTS = ['briefing', 'planning', 'implementation', 'debug', 'review'];
const IMAGE_NAME = 'cascade:local';

function extractCardId(input: string): string {
	// Match Trello URL: https://trello.com/c/abc123/... or https://trello.com/c/abc123
	const urlMatch = input.match(/trello\.com\/c\/([a-zA-Z0-9]+)/);
	if (urlMatch) {
		return urlMatch[1];
	}
	// Assume it's already a card ID
	return input;
}

interface CliOptions {
	agentType: string;
	cardInput: string;
	rebuild: boolean;
}

function parseArgs(): CliOptions {
	const args = process.argv.slice(2);

	const options: CliOptions = {
		agentType: '',
		cardInput: '',
		rebuild: false,
	};

	for (const arg of args) {
		if (arg === '--rebuild') {
			options.rebuild = true;
		} else if (!arg.startsWith('--')) {
			if (!options.agentType) {
				options.agentType = arg;
			} else if (!options.cardInput) {
				options.cardInput = arg;
			}
		}
	}

	if (!options.agentType || !options.cardInput) {
		console.error('Usage: npm run tool:run-local <agent-type> <trello-card-url-or-id> [--rebuild]');
		console.error('');
		console.error('Agent types:', VALID_AGENTS.join(', '));
		console.error('');
		console.error('Examples:');
		console.error('  npm run tool:run-local briefing https://trello.com/c/abc123/card-name');
		console.error('  npm run tool:run-local implementation abc123');
		console.error('  npm run tool:run-local planning abc123 --rebuild');
		process.exit(1);
	}

	if (!VALID_AGENTS.includes(options.agentType)) {
		console.error(`Invalid agent type: ${options.agentType}`);
		console.error('Valid agents:', VALID_AGENTS.join(', '));
		process.exit(1);
	}

	return options;
}

function dockerImageExists(): boolean {
	try {
		execSync(`docker image inspect ${IMAGE_NAME}`, { stdio: 'pipe' });
		return true;
	} catch {
		return false;
	}
}

function buildDockerImage(): void {
	console.log('Building Docker image...');
	execSync(`docker build -t ${IMAGE_NAME} .`, { stdio: 'inherit', cwd: process.cwd() });
	console.log('Docker image built successfully.');
}

function ensureDockerImage(rebuild: boolean): void {
	if (rebuild) {
		buildDockerImage();
		return;
	}

	if (dockerImageExists()) {
		console.log(`Using existing ${IMAGE_NAME} image`);
	} else {
		console.log('Docker image not found, building...');
		buildDockerImage();
	}
}

function runAgentInDocker(agentType: string, cardId: string): Promise<number> {
	const cwd = process.cwd();
	const envFile = resolve(cwd, '.env');
	const workspaceDir = resolve(cwd, 'workspace');

	if (!existsSync(envFile)) {
		console.error('Error: .env file not found. Copy .env.example to .env and fill in credentials.');
		process.exit(1);
	}

	// Create workspace directory if it doesn't exist
	if (!existsSync(workspaceDir)) {
		mkdirSync(workspaceDir, { recursive: true });
	}

	console.log(`Workspace: ${workspaceDir}`);

	const dockerArgs = [
		'run',
		'--rm',
		'-it',
		// Mount local code for live development
		'-v',
		`${cwd}/src:/app/src`,
		'-v',
		`${cwd}/config:/app/config`,
		'-v',
		`${cwd}/tools:/app/tools`,
		'-v',
		`${cwd}/tsconfig.json:/app/tsconfig.json`,
		'-v',
		`${cwd}/package.json:/app/package.json`,
		// Mount workspace for repos and logs
		'-v',
		`${workspaceDir}:/workspace`,
		// Pass environment file
		'--env-file',
		envFile,
		// Set local mode env var (to skip log uploads)
		'-e',
		'CASCADE_LOCAL_MODE=true',
		// Pass tokens from host environment (may override .env)
		...(process.env.GITHUB_TOKEN ? ['-e', `GITHUB_TOKEN=${process.env.GITHUB_TOKEN}`] : []),
		...(process.env.HF_TOKEN ? ['-e', `HF_TOKEN=${process.env.HF_TOKEN}`] : []),
		...(process.env.ANTHROPIC_API_KEY
			? ['-e', `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY}`]
			: []),
		...(process.env.OPENAI_API_KEY ? ['-e', `OPENAI_API_KEY=${process.env.OPENAI_API_KEY}`] : []),
		...(process.env.GEMINI_API_KEY ? ['-e', `GEMINI_API_KEY=${process.env.GEMINI_API_KEY}`] : []),
		// Image
		IMAGE_NAME,
		// Command: run the entrypoint script with tsx
		'npx',
		'tsx',
		'/app/tools/run-agent-entrypoint.ts',
		agentType,
		cardId,
	];

	console.log(`\nStarting ${agentType} agent for card ${cardId}...\n`);

	const docker = spawn('docker', dockerArgs, {
		stdio: 'inherit',
		cwd,
	});

	return new Promise((resolve) => {
		docker.on('close', (code) => {
			resolve(code ?? 1);
		});
	});
}

async function main() {
	const options = parseArgs();
	const cardId = extractCardId(options.cardInput);

	console.log(`Agent: ${options.agentType}`);
	console.log(`Card ID: ${cardId}`);

	ensureDockerImage(options.rebuild);

	const exitCode = await runAgentInDocker(options.agentType, cardId);
	process.exit(exitCode);
}

main().catch((err) => {
	console.error('Error:', err);
	process.exit(1);
});
