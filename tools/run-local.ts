#!/usr/bin/env tsx
/**
 * Run a CASCADE agent locally in Docker against a Trello card or GitHub PR.
 *
 * Usage:
 *   npm run tool:run-local -- splitting https://trello.com/c/abc123/card-name
 *   npm run tool:run-local -- implementation abc123
 *   npm run tool:run-local -- respond-to-review https://github.com/owner/repo/pull/123
 *   npm run tool:run-local -- planning abc123 --rebuild
 *   npm run tool:run-local -- implementation abc123 -i
 *   npm run tool:run-local -- implementation abc123 -m gemini-2.0-flash
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { program } from 'commander';

const VALID_AGENTS = [
	'splitting',
	'planning',
	'implementation',
	'debug',
	'respond-to-review',
	'respond-to-ci',
	'review',
] as const;
const IMAGE_NAME = 'cascade:local';

// Input types for different sources
interface TrelloInput {
	type: 'trello';
	workItemId: string;
}

interface GitHubPRInput {
	type: 'github-pr';
	owner: string;
	repo: string;
	prNumber: number;
}

type ParsedInput = TrelloInput | GitHubPRInput;

function parseInput(input: string): ParsedInput {
	// Check for GitHub PR URL: https://github.com/owner/repo/pull/123
	const githubMatch = input.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
	if (githubMatch) {
		return {
			type: 'github-pr',
			owner: githubMatch[1],
			repo: githubMatch[2],
			prNumber: Number.parseInt(githubMatch[3], 10),
		};
	}

	// Check for Trello URL: https://trello.com/c/abc123/...
	const trelloMatch = input.match(/trello\.com\/c\/([a-zA-Z0-9]+)/);
	if (trelloMatch) {
		return {
			type: 'trello',
			workItemId: trelloMatch[1],
		};
	}

	// Assume it's a Trello work item ID
	return {
		type: 'trello',
		workItemId: input,
	};
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
	execSync(`docker build -f Dockerfile.worker -t ${IMAGE_NAME} .`, {
		stdio: 'inherit',
		cwd: process.cwd(),
	});
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

function runAgentInDocker(
	agentType: string,
	input: ParsedInput,
	interactive: boolean,
	yes: boolean,
	model?: string,
): Promise<number> {
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

	// Build entrypoint arguments based on input type
	let entrypointArgs: string[];
	let displayName: string;

	if (input.type === 'github-pr') {
		// Pass PR details as separate arguments with --pr flag
		entrypointArgs = [agentType, '--pr', input.owner, input.repo, String(input.prNumber)];
		displayName = `${input.owner}/${input.repo}#${input.prNumber}`;
	} else {
		// Pass Trello work item ID
		entrypointArgs = [agentType, input.workItemId];
		displayName = `work item ${input.workItemId}`;
	}

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
		// Pass interactive mode flag
		...(interactive ? ['-e', 'CASCADE_INTERACTIVE=true'] : []),
		// Pass auto-accept flag (only meaningful with interactive)
		...(yes ? ['-e', 'CASCADE_YES=true'] : []),
		// Pass model override
		...(model ? ['-e', `CASCADE_MODEL_OVERRIDE=${model}`] : []),
		// Pass infrastructure tokens from host environment (project secrets come from DB)
		...(process.env.CLAUDE_CODE_OAUTH_TOKEN
			? ['-e', `CLAUDE_CODE_OAUTH_TOKEN=${process.env.CLAUDE_CODE_OAUTH_TOKEN}`]
			: []),
		// Image
		IMAGE_NAME,
		// Command: run the entrypoint script with tsx
		'npx',
		'-y',
		'tsx',
		'/app/tools/run-agent-entrypoint.ts',
		...entrypointArgs,
	];

	console.log(`\nStarting ${agentType} agent for ${displayName}...\n`);

	const docker = spawn('docker', dockerArgs, {
		stdio: 'inherit',
		cwd,
	});

	return new Promise((resolvePromise) => {
		docker.on('close', (code) => {
			resolvePromise(code ?? 1);
		});
	});
}

// Configure CLI with commander
program
	.name('run-local')
	.description('Run a CASCADE agent locally in Docker')
	.argument('<agent>', `Agent type: ${VALID_AGENTS.join(', ')}`)
	.argument('<input>', 'Trello card URL/ID or GitHub PR URL')
	.option('-r, --rebuild', 'Rebuild Docker image before running', false)
	.option('-i, --interactive', 'Show all gadget calls with full params, wait for Enter', false)
	.option('-y, --yes', 'Auto-accept all prompts (requires --interactive)', false)
	.option(
		'-m, --model <model>',
		'Override the LLM model (e.g., gemini-2.0-flash, claude-sonnet-4-20250514)',
	)
	.action(
		async (
			agent: string,
			input: string,
			options: { rebuild: boolean; interactive: boolean; yes: boolean; model?: string },
		) => {
			// Validate agent type
			if (!VALID_AGENTS.includes(agent as (typeof VALID_AGENTS)[number])) {
				console.error(`Invalid agent type: ${agent}`);
				console.error(`Valid agents: ${VALID_AGENTS.join(', ')}`);
				process.exit(1);
			}

			const parsedInput = parseInput(input);

			console.log(`Agent: ${agent}`);
			if (parsedInput.type === 'github-pr') {
				console.log(`PR: ${parsedInput.owner}/${parsedInput.repo}#${parsedInput.prNumber}`);
			} else {
				console.log(`Work Item ID: ${parsedInput.workItemId}`);
			}

			ensureDockerImage(options.rebuild);

			if (options.interactive) {
				console.log('Interactive mode: ON');
				if (options.yes) {
					console.log('Auto-accept: ON');
				}
			}
			if (options.model) {
				console.log(`Model override: ${options.model}`);
			}

			const exitCode = await runAgentInDocker(
				agent,
				parsedInput,
				options.interactive,
				options.yes,
				options.model,
			);
			process.exit(exitCode);
		},
	);

program.parse();
