#!/usr/bin/env tsx
/**
 * Resolve and display the full effective configuration for an agent in a project context.
 *
 * Merges all configuration layers:
 *   1. Project row overrides (model, maxIterations, watchdogTimeoutMs, workItemBudgetUsd, agentEngine, etc.)
 *   2. Project-level agent_configs (project_id set)
 *   3. Resolved credentials (integration credentials + org defaults)
 *
 * Usage:
 *   npx tsx tools/resolve-config.ts <project-id> <agent-type>
 *   npx tsx tools/resolve-config.ts <project-id>              # show project config without agent-specific resolution
 *
 * Requires DATABASE_URL to be set.
 */

import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '../src/db/client.js';
import { resolveAllProjectCredentials } from '../src/db/repositories/credentialsRepository.js';
import { agentConfigs, projectIntegrations, projects } from '../src/db/schema/index.js';

function maskValue(value: string): string {
	if (value.length <= 8) return '****';
	return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

interface TrelloIntegrationConfig {
	boardId: string;
	lists: Record<string, string>;
	labels: Record<string, string>;
	customFields?: Record<string, string>;
}

interface AgentConfigInfo {
	model: string | null;
	maxIterations: number | null;
	agentEngine: string | null;
}

interface EffectiveConfig {
	projectId: string;
	orgId: string;
	projectName: string;
	repo: string;
	agentType: string | null;
	effectiveModel: string;
	effectiveMaxIterations: number;
	effectiveEngine: string;
	projectOverrides: Record<string, string | number | boolean | null>;
	projectAgentConfig: AgentConfigInfo | null;
	trello: TrelloIntegrationConfig | null;
	credentials: Record<string, string>;
}

function toInfo(ac: typeof agentConfigs.$inferSelect | null | undefined): AgentConfigInfo | null {
	if (!ac) return null;
	return {
		model: ac.model,
		maxIterations: ac.maxIterations,
		agentEngine: ac.agentEngine,
	};
}

async function resolveEffectiveConfig(
	projectId: string,
	agentType: string | null,
): Promise<EffectiveConfig> {
	const db = getDb();

	const [projectRow] = await db.select().from(projects).where(eq(projects.id, projectId));
	if (!projectRow) throw new Error(`Project '${projectId}' not found`);

	const orgId = projectRow.orgId;

	const [projectAcs, integrations, credentials] = await Promise.all([
		db.select().from(agentConfigs).where(eq(agentConfigs.projectId, projectId)),
		db.select().from(projectIntegrations).where(eq(projectIntegrations.projectId, projectId)),
		resolveAllProjectCredentials(projectId),
	]);

	const trelloConfig = integrations.find((i) => i.provider === 'trello')?.config as
		| TrelloIntegrationConfig
		| undefined;

	const findByType = (acs: (typeof agentConfigs.$inferSelect)[]) =>
		agentType ? acs.find((ac) => ac.agentType === agentType) : null;

	const projectAc = toInfo(findByType(projectAcs));

	return {
		projectId,
		orgId,
		projectName: projectRow.name,
		repo: projectRow.repo,
		agentType,
		effectiveModel:
			projectAc?.model ?? projectRow.model ?? 'openrouter:google/gemini-3-flash-preview',
		effectiveMaxIterations: projectAc?.maxIterations ?? projectRow.maxIterations ?? 50,
		effectiveEngine: projectAc?.agentEngine ?? projectRow.agentEngine ?? 'llmist',
		projectOverrides: {
			model: projectRow.model,
			maxIterations: projectRow.maxIterations,
			watchdogTimeoutMs: projectRow.watchdogTimeoutMs,
			workItemBudgetUsd: projectRow.workItemBudgetUsd,
			agentEngine: projectRow.agentEngine,
			progressModel: projectRow.progressModel,
			progressIntervalMinutes: projectRow.progressIntervalMinutes,
			baseBranch: projectRow.baseBranch,
			branchPrefix: projectRow.branchPrefix,
		},
		projectAgentConfig: projectAc,
		trello: trelloConfig ?? null,
		credentials,
	};
}

function printSection(title: string, entries: [string, unknown][]): void {
	console.log(`\n--- ${title} ---`);
	for (const [key, value] of entries) {
		console.log(`  ${key}: ${value ?? '(not set)'}`);
	}
}

function printKeyValueSection(title: string, obj: Record<string, unknown>): void {
	printSection(
		title,
		Object.entries(obj).map(([k, v]) => [k, v]),
	);
}

function printAgentLayer(name: string, data: AgentConfigInfo | null): void {
	if (!data) {
		console.log(`  ${name}: (not set)`);
		return;
	}
	console.log(`  ${name}:`);
	if (data.model) console.log(`    model: ${data.model}`);
	if (data.maxIterations != null) console.log(`    maxIterations: ${data.maxIterations}`);
	if (data.agentEngine) console.log(`    agentEngine: ${data.agentEngine}`);
}

function printTrello(trello: TrelloIntegrationConfig | null): void {
	console.log('\n--- Trello ---');
	if (!trello) {
		console.log('  (no Trello integration configured)');
		return;
	}
	console.log(`  Board ID: ${trello.boardId}`);
	for (const [section, data] of Object.entries({
		Lists: trello.lists,
		Labels: trello.labels,
		'Custom Fields': trello.customFields ?? {},
	})) {
		const entries = Object.entries(data);
		if (entries.length === 0 && section !== 'Custom Fields') {
			console.log(`  ${section}: (none configured)`);
		} else {
			for (const e of entries) {
				if (entries.indexOf(e) === 0) console.log(`  ${section}:`);
				console.log(`    ${e[0]}: ${e[1]}`);
			}
		}
	}
}

function printCredentials(config: EffectiveConfig): void {
	console.log('\n--- Project Credentials ---');
	const entries = Object.entries(config.credentials);
	if (entries.length === 0) {
		console.log('  (no credentials configured)');
	} else {
		for (const [key, value] of entries) {
			console.log(`  ${key}: ${maskValue(value)}`);
		}
	}
}

function printConfig(config: EffectiveConfig): void {
	const separator = '='.repeat(70);
	console.log(separator);
	console.log('  EFFECTIVE CONFIGURATION');
	console.log(separator);

	printSection('Identity', [
		['Project', `${config.projectName} (${config.projectId})`],
		['Organization', config.orgId],
		['Repository', config.repo],
	]);

	if (config.agentType) {
		printSection(`Agent: ${config.agentType}`, [
			['Model', config.effectiveModel],
			['Max iterations', config.effectiveMaxIterations],
			['Engine', config.effectiveEngine],
		]);

		console.log('\n--- Resolution Chain ---');
		printAgentLayer('Project agent_config', config.projectAgentConfig);
	}

	printKeyValueSection('Project Overrides', config.projectOverrides);
	printTrello(config.trello);
	printCredentials(config);

	console.log(`\n${separator}`);
}

async function main() {
	const args = process.argv.slice(2);
	const projectId = args[0];
	const agentType = args[1] ?? null;

	if (!projectId) {
		console.log('Usage:');
		console.log('  npx tsx tools/resolve-config.ts <project-id> <agent-type>');
		console.log('  npx tsx tools/resolve-config.ts <project-id>');
		console.log();
		console.log('Examples:');
		console.log('  npx tsx tools/resolve-config.ts car-dealership review');
		console.log('  npx tsx tools/resolve-config.ts car-dealership implementation');
		console.log('  npx tsx tools/resolve-config.ts car-dealership');
		process.exit(1);
	}

	const config = await resolveEffectiveConfig(projectId, agentType);
	printConfig(config);

	await closeDb();
}

main().catch((err) => {
	console.error('Error:', err);
	process.exit(1);
});
