#!/usr/bin/env tsx
/**
 * Resolve and display the full effective configuration for an agent in a project/org context.
 *
 * Merges all configuration layers:
 *   1. cascade_defaults (org-level global defaults)
 *   2. Global agent_configs (org_id IS NULL, project_id IS NULL)
 *   3. Org-level agent_configs (org_id set, project_id IS NULL)
 *   4. Project-level agent_configs (project_id set)
 *   5. Project row overrides (model, cardBudgetUsd, agentBackend)
 *   6. Resolved credentials (org defaults + project overrides)
 *
 * Usage:
 *   npx tsx tools/resolve-config.ts <project-id> <agent-type>
 *   npx tsx tools/resolve-config.ts <project-id>              # show project config without agent-specific resolution
 *
 * Requires DATABASE_URL to be set.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { closeDb, getDb } from '../src/db/client.js';
import {
	listProjectOverrides,
	resolveAllCredentials,
} from '../src/db/repositories/credentialsRepository.js';
import {
	agentConfigs,
	cascadeDefaults,
	projectIntegrations,
	projects,
} from '../src/db/schema/index.js';

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
	agentBackend: string | null;
	prompt: string | null;
}

interface EffectiveConfig {
	projectId: string;
	orgId: string;
	projectName: string;
	repo: string;
	agentType: string | null;
	effectiveModel: string;
	effectiveMaxIterations: number;
	effectiveBackend: string;
	effectivePrompt: string | null;
	orgDefaults: Record<string, string | number | null>;
	projectOverrides: Record<string, string | number | boolean | null>;
	agentConfigLayers: {
		global: AgentConfigInfo | null;
		org: AgentConfigInfo | null;
		project: AgentConfigInfo | null;
	};
	trello: TrelloIntegrationConfig | null;
	credentials: Record<string, string>;
	credentialOverrides: { envVarKey: string; credentialId: number; credentialName: string }[];
}

function toInfo(ac: typeof agentConfigs.$inferSelect | null | undefined): AgentConfigInfo | null {
	if (!ac) return null;
	return {
		model: ac.model,
		maxIterations: ac.maxIterations,
		agentBackend: ac.agentBackend,
		prompt: ac.prompt,
	};
}

function resolveBackend(
	projectAc: AgentConfigInfo | null,
	orgAc: AgentConfigInfo | null,
	globalAc: AgentConfigInfo | null,
	projectBackendDefault: string | null,
	orgBackend: string | null,
): string {
	return (
		projectAc?.agentBackend ??
		orgAc?.agentBackend ??
		globalAc?.agentBackend ??
		projectBackendDefault ??
		orgBackend ??
		'llmist'
	);
}

async function resolveEffectiveConfig(
	projectId: string,
	agentType: string | null,
): Promise<EffectiveConfig> {
	const db = getDb();

	const [projectRow] = await db.select().from(projects).where(eq(projects.id, projectId));
	if (!projectRow) throw new Error(`Project '${projectId}' not found`);

	const orgId = projectRow.orgId;

	const [
		defaultsRow,
		globalAcs,
		orgAcs,
		projectAcs,
		integrations,
		credentials,
		credentialOverrides,
	] = await Promise.all([
		db
			.select()
			.from(cascadeDefaults)
			.where(eq(cascadeDefaults.orgId, orgId))
			.then((r) => r[0]),
		db
			.select()
			.from(agentConfigs)
			.where(and(isNull(agentConfigs.projectId), isNull(agentConfigs.orgId))),
		db
			.select()
			.from(agentConfigs)
			.where(and(eq(agentConfigs.orgId, orgId), isNull(agentConfigs.projectId))),
		db.select().from(agentConfigs).where(eq(agentConfigs.projectId, projectId)),
		db.select().from(projectIntegrations).where(eq(projectIntegrations.projectId, projectId)),
		resolveAllCredentials(projectId, orgId),
		listProjectOverrides(projectId),
	]);

	const trelloConfig = integrations.find((i) => i.type === 'trello')?.config as
		| TrelloIntegrationConfig
		| undefined;

	const findByType = (acs: (typeof agentConfigs.$inferSelect)[]) =>
		agentType ? acs.find((ac) => ac.agentType === agentType) : null;

	const globalAc = toInfo(findByType(globalAcs));
	const orgAc = toInfo(findByType(orgAcs));
	const projectAc = toInfo(findByType(projectAcs));

	return {
		projectId,
		orgId,
		projectName: projectRow.name,
		repo: projectRow.repo,
		agentType,
		effectiveModel:
			projectAc?.model ??
			orgAc?.model ??
			globalAc?.model ??
			projectRow.model ??
			defaultsRow?.model ??
			'openrouter:google/gemini-3-flash-preview',
		effectiveMaxIterations:
			projectAc?.maxIterations ??
			orgAc?.maxIterations ??
			globalAc?.maxIterations ??
			defaultsRow?.maxIterations ??
			50,
		effectiveBackend: resolveBackend(
			projectAc,
			orgAc,
			globalAc,
			projectRow.agentBackend,
			defaultsRow?.agentBackend ?? null,
		),
		effectivePrompt: projectAc?.prompt ?? orgAc?.prompt ?? globalAc?.prompt ?? null,
		orgDefaults: {
			model: defaultsRow?.model ?? null,
			maxIterations: defaultsRow?.maxIterations ?? null,
			agentBackend: defaultsRow?.agentBackend ?? null,
			cardBudgetUsd: defaultsRow?.cardBudgetUsd ?? null,
			freshMachineTimeoutMs: defaultsRow?.freshMachineTimeoutMs ?? null,
			watchdogTimeoutMs: defaultsRow?.watchdogTimeoutMs ?? null,
			postJobGracePeriodMs: defaultsRow?.postJobGracePeriodMs ?? null,
			progressModel: defaultsRow?.progressModel ?? null,
			progressIntervalMinutes: defaultsRow?.progressIntervalMinutes ?? null,
		},
		projectOverrides: {
			model: projectRow.model,
			cardBudgetUsd: projectRow.cardBudgetUsd,
			agentBackend: projectRow.agentBackend,
			subscriptionCostZero: projectRow.subscriptionCostZero,
			baseBranch: projectRow.baseBranch,
			branchPrefix: projectRow.branchPrefix,
		},
		agentConfigLayers: { global: globalAc, org: orgAc, project: projectAc },
		trello: trelloConfig ?? null,
		credentials,
		credentialOverrides,
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
	if (data.agentBackend) console.log(`    agentBackend: ${data.agentBackend}`);
	if (data.prompt) {
		const truncated = data.prompt.length > 80 ? `${data.prompt.slice(0, 80)}...` : data.prompt;
		console.log(`    prompt: ${truncated}`);
	}
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
	console.log('\n--- Credentials ---');
	const credEntries = Object.entries(config.credentials);
	if (credEntries.length === 0) {
		console.log('  (no credentials resolved)');
		return;
	}
	const overrideKeys = new Set(config.credentialOverrides.map((o) => o.envVarKey));
	for (const [key, value] of credEntries) {
		const source = overrideKeys.has(key) ? 'project-override' : 'org-default';
		console.log(`  ${key}: ${maskValue(value)} [${source}]`);
	}
	if (config.credentialOverrides.length > 0) {
		console.log('\n  Credential Overrides:');
		for (const o of config.credentialOverrides) {
			console.log(`    ${o.envVarKey} → credential #${o.credentialId} (${o.credentialName})`);
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
			['Backend', config.effectiveBackend],
			['Prompt', config.effectivePrompt ?? '(none)'],
		]);

		console.log('\n--- Resolution Chain ---');
		printAgentLayer('Project agent_config', config.agentConfigLayers.project);
		printAgentLayer('Org agent_config', config.agentConfigLayers.org);
		printAgentLayer('Global agent_config', config.agentConfigLayers.global);
	}

	printKeyValueSection('Org Defaults (cascade_defaults)', config.orgDefaults);
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
