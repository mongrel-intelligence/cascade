#!/usr/bin/env tsx
/**
 * Seed database from config/projects.json
 *
 * Reads the existing JSON config and inserts it into the database.
 *
 * Usage:
 *   npx tsx tools/seed-config-from-json.ts --org <org-id> [--config ./config/projects.json]
 *
 * Requires DATABASE_URL to be set.
 */

import { readFileSync } from 'node:fs';
import type { z } from 'zod';
import { type CascadeConfigSchema, validateConfig } from '../src/config/schema.js';
import { closeDb, getDb } from '../src/db/client.js';
import {
	agentConfigs,
	cascadeDefaults,
	projectIntegrations,
	projects,
} from '../src/db/schema/index.js';

type CascadeConfig = z.infer<typeof CascadeConfigSchema>;
type ProjectConfig = CascadeConfig['projects'][number];

const args = process.argv.slice(2);
let configPath = './config/projects.json';
let orgId: string | undefined;

for (let i = 0; i < args.length; i++) {
	if (args[i] === '--config' && args[i + 1]) {
		configPath = args[i + 1];
		i++;
	} else if (args[i] === '--org' && args[i + 1]) {
		orgId = args[i + 1];
		i++;
	}
}

if (!orgId) {
	console.error('Error: --org <org-id> is required');
	process.exit(1);
}

function buildProjectValues(p: ProjectConfig) {
	return {
		id: p.id,
		name: p.name,
		repo: p.repo,
		baseBranch: p.baseBranch,
		branchPrefix: p.branchPrefix,
		model: p.model ?? null,
		workItemBudgetUsd: p.workItemBudgetUsd ? String(p.workItemBudgetUsd) : null,
		agentEngine: p.agentEngine?.default ?? null,
	};
}

async function seedDefaults(d: CascadeConfig['defaults']) {
	console.log('Inserting defaults...');
	const db = getDb();
	const values = {
		orgId,
		model: d.model,
		maxIterations: d.maxIterations,
		freshMachineTimeoutMs: d.freshMachineTimeoutMs,
		watchdogTimeoutMs: d.watchdogTimeoutMs,
		postJobGracePeriodMs: d.postJobGracePeriodMs,
		workItemBudgetUsd: String(d.workItemBudgetUsd),
		agentEngine: d.agentEngine,
		progressModel: d.progressModel,
		progressIntervalMinutes: String(d.progressIntervalMinutes),
	};
	await db
		.insert(cascadeDefaults)
		.values(values)
		.onConflictDoUpdate({
			target: cascadeDefaults.orgId,
			set: { ...values, updatedAt: new Date() },
		});
	console.log('  Defaults upserted.');
}

async function seedProject(p: ProjectConfig) {
	console.log(`Inserting project: ${p.id} (${p.name})...`);
	const db = getDb();
	const values = buildProjectValues(p);
	const { id: _id, ...updateValues } = values;
	await db
		.insert(projects)
		.values(values)
		.onConflictDoUpdate({
			target: projects.id,
			set: { ...updateValues, updatedAt: new Date() },
		});
	console.log(`  Project ${p.id} upserted.`);
}

async function seedProjectIntegrations(p: ProjectConfig) {
	const db = getDb();
	if (p.trello) {
		const config = {
			boardId: p.trello.boardId,
			lists: p.trello.lists,
			labels: p.trello.labels,
			customFields: p.trello.customFields,
		};
		await db
			.insert(projectIntegrations)
			.values({ projectId: p.id, category: 'pm', provider: 'trello', config })
			.onConflictDoUpdate({
				target: [projectIntegrations.projectId, projectIntegrations.category],
				set: { config: sql`EXCLUDED.config`, provider: 'trello', updatedAt: new Date() },
			});
		console.log('  Trello integration upserted.');
	}
}

async function seedProjectAgentConfigs(p: ProjectConfig) {
	const db = getDb();
	const agentTypes = new Set([
		...Object.keys(p.agentModels ?? {}),
		...Object.keys(p.agentEngine?.overrides ?? {}),
		...Object.keys(p.prompts ?? {}),
	]);
	for (const agentType of agentTypes) {
		console.log(`    Inserting project agent config: ${agentType}...`);
		const model = p.agentModels?.[agentType] ?? null;
		const agentEngine = p.agentEngine?.overrides?.[agentType] ?? null;
		const prompt = p.prompts?.[agentType] ?? null;
		// Use raw SQL because the partial unique index (WHERE project_id IS NOT NULL)
		// can't be expressed via Drizzle's onConflictDoUpdate target
		await db.execute(sql`
			INSERT INTO agent_configs (project_id, agent_type, model, agent_engine, prompt)
			VALUES (${p.id}, ${agentType}, ${model}, ${agentEngine}, ${prompt})
			ON CONFLICT (project_id, agent_type) WHERE project_id IS NOT NULL
			DO UPDATE SET
				model = COALESCE(EXCLUDED.model, agent_configs.model),
				agent_engine = COALESCE(EXCLUDED.agent_engine, agent_configs.agent_engine),
				prompt = COALESCE(EXCLUDED.prompt, agent_configs.prompt),
				updated_at = NOW()
		`);
	}
}

async function main() {
	console.log(`Reading config from: ${configPath}`);
	const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
	const config = validateConfig(raw);
	console.log(`Validated config: ${config.projects.length} project(s)`);

	getDb(); // initialize connection

	await seedDefaults(config.defaults);
	for (const p of config.projects) {
		await seedProject(p);
		await seedProjectIntegrations(p);
		await seedProjectAgentConfigs(p);
	}

	console.log('\nDone! Config seeded successfully.');
	await closeDb();
}

main().catch((err) => {
	console.error('Seed failed:', err);
	process.exit(1);
});
