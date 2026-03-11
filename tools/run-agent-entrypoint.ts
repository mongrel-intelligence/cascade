#!/usr/bin/env tsx
/**
 * Entrypoint script that runs inside the Docker container.
 * Starts services and executes the agent.
 *
 * This script is called by run-local.ts via Docker.
 */

import { runAgent } from '../src/agents/registry.js';
import { findProjectByBoardId, findProjectByRepo, loadConfig } from '../src/config/provider.js';
import { githubClient } from '../src/github/client.js';
import type { AgentInput, CascadeConfig, ProjectConfig } from '../src/types/index.js';

// Input types
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

function parseEntrypointArgs(): { agentType: string; input: ParsedInput } {
	const args = process.argv.slice(2);
	const agentType = args[0];

	if (!agentType) {
		console.error('Usage: run-agent-entrypoint.ts <agent-type> <work-item-id>');
		console.error('       run-agent-entrypoint.ts <agent-type> --pr <owner> <repo> <pr-number>');
		process.exit(1);
	}

	// Check for --pr flag
	if (args[1] === '--pr') {
		const owner = args[2];
		const repo = args[3];
		const prNumber = Number.parseInt(args[4], 10);

		if (!owner || !repo || Number.isNaN(prNumber)) {
			console.error('Usage: run-agent-entrypoint.ts <agent-type> --pr <owner> <repo> <pr-number>');
			process.exit(1);
		}

		return {
			agentType,
			input: { type: 'github-pr', owner, repo, prNumber },
		};
	}

	// Legacy: work item ID as second argument
	const workItemId = args[1];
	if (!workItemId) {
		console.error('Usage: run-agent-entrypoint.ts <agent-type> <work-item-id>');
		process.exit(1);
	}

	return {
		agentType,
		input: { type: 'trello', workItemId },
	};
}

async function getCardBoardId(workItemId: string): Promise<string> {
	const apiKey = process.env.TRELLO_API_KEY;
	const token = process.env.TRELLO_TOKEN;

	if (!apiKey || !token) {
		throw new Error('TRELLO_API_KEY and TRELLO_TOKEN must be set');
	}

	const response = await fetch(
		`https://api.trello.com/1/cards/${workItemId}?fields=idBoard&key=${apiKey}&token=${token}`,
	);

	if (!response.ok) {
		throw new Error(`Failed to fetch card ${workItemId}: ${response.status}`);
	}

	const card = (await response.json()) as { idBoard: string };
	return card.idBoard;
}

async function prepareGitHubPRInput(
	prInput: GitHubPRInput,
	config: CascadeConfig,
): Promise<{ project: ProjectConfig; agentInput: AgentInput }> {
	const { owner, repo, prNumber } = prInput;
	const repoFullName = `${owner}/${repo}`;

	// Find project by repository name
	const project = await findProjectByRepo(repoFullName);
	if (!project) {
		console.error(`No project configured for repo ${repoFullName}`);
		console.error('Available projects:');
		for (const p of config.projects) {
			console.error(`  - ${p.id}: ${p.repo}`);
		}
		process.exit(1);
	}

	// Fetch PR details to get branch name and head SHA
	console.log(`Fetching PR #${prNumber} details from ${repoFullName}...`);
	const prDetails = await githubClient.getPR(owner, repo, prNumber);
	console.log(`PR branch: ${prDetails.headRef}`);

	// Build ReviewAgentInput
	const agentInput: AgentInput = {
		prNumber,
		prBranch: prDetails.headRef,
		headSha: prDetails.headSha,
		repoFullName,
		// Synthetic trigger data for local testing
		triggerCommentId: 0,
		triggerCommentBody: `Local testing of PR #${prNumber}: ${prDetails.title}`,
		triggerCommentPath: '',
		triggerCommentUrl: prDetails.htmlUrl,
		project,
		config,
	};

	return { project, agentInput };
}

function applyEnvironmentOverrides(agentInput: AgentInput): void {
	if (process.env.CASCADE_INTERACTIVE === 'true') {
		agentInput.interactive = true;
		console.log('Interactive mode: enabled');
	}
	if (process.env.CASCADE_YES === 'true') {
		agentInput.autoAccept = true;
		console.log('Auto-accept mode: enabled');
	}
	if (process.env.CASCADE_MODEL_OVERRIDE) {
		agentInput.modelOverride = process.env.CASCADE_MODEL_OVERRIDE;
		console.log(`Model override: ${process.env.CASCADE_MODEL_OVERRIDE}`);
	}
}

function printAgentResult(
	result: { success: boolean; cost?: number; error?: string; prUrl?: string; output: string },
	durationMs: number,
): void {
	console.log('');
	console.log('='.repeat(60));
	console.log('Agent Result');
	console.log('='.repeat(60));
	console.log(`Success: ${result.success}`);
	console.log(`Duration: ${(durationMs / 1000).toFixed(1)}s`);
	if (result.cost) console.log(`Cost: $${result.cost.toFixed(4)}`);
	if (result.error) console.log(`Error: ${result.error}`);
	if (result.prUrl) console.log(`PR URL: ${result.prUrl}`);
	console.log('');
	console.log('Output (truncated):');
	console.log('-'.repeat(60));
	console.log(result.output.slice(0, 2000));
	if (result.output.length > 2000) {
		console.log(`... (${result.output.length - 2000} more characters)`);
	}
}

async function main() {
	const { agentType, input } = parseEntrypointArgs();

	console.log('='.repeat(60));
	console.log('CASCADE Local Agent Runner');
	console.log('='.repeat(60));
	console.log(`Agent Type: ${agentType}`);
	if (input.type === 'github-pr') {
		console.log(`PR: ${input.owner}/${input.repo}#${input.prNumber}`);
	} else {
		console.log(`Work Item ID: ${input.workItemId}`);
	}
	console.log('');

	// Load config from database
	console.log('Loading configuration...');
	const config = await loadConfig();
	console.log(`Found ${config.projects.length} project(s)`);

	let project: ProjectConfig;
	let agentInput: AgentInput;

	if (input.type === 'github-pr') {
		// GitHub PR flow
		const prepared = await prepareGitHubPRInput(input, config);
		project = prepared.project;
		agentInput = prepared.agentInput;
	} else {
		// Trello card flow
		console.log('Fetching card to determine project...');
		const boardId = await getCardBoardId(input.workItemId);
		console.log(`Card belongs to board: ${boardId}`);

		const foundProject = await findProjectByBoardId(boardId);
		if (!foundProject) {
			console.error(`No project configured for board ${boardId}`);
			console.error('Available projects:');
			for (const p of config.projects) {
				console.error(`  - ${p.id}: board ${p.trello.boardId}`);
			}
			process.exit(1);
		}
		project = foundProject;
		agentInput = {
			project,
			config,
			workItemId: input.workItemId,
		};
	}

	applyEnvironmentOverrides(agentInput);

	console.log(`Using project: ${project.id} (${project.name})`);
	console.log('');
	console.log('='.repeat(60));
	console.log('Starting agent...');
	console.log('='.repeat(60));
	console.log('');

	// Run the agent
	const startTime = Date.now();
	const result = await runAgent(agentType, agentInput);
	const durationMs = Date.now() - startTime;

	printAgentResult(result, durationMs);
	process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
	console.error('Fatal error:', err);
	process.exit(1);
});
