#!/usr/bin/env tsx
/**
 * Migrate existing trigger configs from project_integrations.triggers JSONB
 * to the new agent_trigger_configs table.
 *
 * This script reads the legacy triggers from project_integrations and creates
 * corresponding rows in agent_trigger_configs using the new event format.
 *
 * Usage:
 *   npx tsx tools/migrate-triggers.ts [--dry-run]
 *
 * The script will:
 * 1. Scan all project_integrations for non-empty triggers
 * 2. Map legacy keys to new event format
 * 3. Upsert into agent_trigger_configs (skip if row exists)
 * 4. Log: projects migrated, configs created, skipped
 */

import { and, eq, sql } from 'drizzle-orm';
import { closeDb, getDb } from '../src/db/client.js';
import { agentTriggerConfigs, projectIntegrations } from '../src/db/schema/index.js';

// ============================================================================
// Legacy Key Mappings
// ============================================================================

interface TriggerMapping {
	agentType: string;
	event: string;
	parameters?: Record<string, unknown>;
}

// PM triggers (Trello status-changed, formerly card-moved)
const PM_CARD_MOVED_MAPPINGS: Record<string, TriggerMapping> = {
	cardMovedToSplitting: { agentType: 'splitting', event: 'pm:status-changed' },
	cardMovedToPlanning: { agentType: 'planning', event: 'pm:status-changed' },
	cardMovedToTodo: { agentType: 'implementation', event: 'pm:status-changed' },
};

// PM triggers (JIRA status-changed, formerly issue-transitioned, nested under issueTransitioned object)
const PM_ISSUE_TRANSITIONED_AGENTS = ['splitting', 'planning', 'implementation'] as const;

// PM triggers (label-added, nested under readyToProcessLabel object)
const PM_LABEL_ADDED_AGENTS = ['splitting', 'planning', 'implementation'] as const;

// SCM triggers (GitHub)
const SCM_SIMPLE_MAPPINGS: Record<string, TriggerMapping> = {
	checkSuiteFailure: { agentType: 'respond-to-ci', event: 'scm:check-suite-failure' },
	prReviewSubmitted: { agentType: 'respond-to-review', event: 'scm:pr-review-submitted' },
	prCommentMention: { agentType: 'respond-to-pr-comment', event: 'scm:pr-comment-mention' },
	prOpened: { agentType: 'review', event: 'scm:pr-opened' },
};

// SCM triggers (review trigger nested under reviewTrigger object)
const REVIEW_TRIGGER_MAPPINGS: Record<string, TriggerMapping> = {
	ownPrsOnly: {
		agentType: 'review',
		event: 'scm:check-suite-success',
		parameters: { authorMode: 'own' },
	},
	externalPrs: {
		agentType: 'review',
		event: 'scm:check-suite-success',
		parameters: { authorMode: 'external' },
	},
	onReviewRequested: { agentType: 'review', event: 'scm:review-requested' },
};

// ============================================================================
// Migration Logic
// ============================================================================

interface MigrationStats {
	integrationsMigrated: number;
	configsCreated: number;
	configsSkipped: number;
	configsUpdated: number;
}

interface LegacyTriggers {
	// PM (Trello)
	cardMovedToSplitting?: boolean;
	cardMovedToPlanning?: boolean;
	cardMovedToTodo?: boolean;
	// PM (JIRA) - can be boolean (applies to all) or object
	issueTransitioned?:
		| boolean
		| { splitting?: boolean; planning?: boolean; implementation?: boolean };
	// PM (label-added) - can be boolean or object
	readyToProcessLabel?:
		| boolean
		| { splitting?: boolean; planning?: boolean; implementation?: boolean };
	// PM (comment mention)
	commentMention?: boolean;
	// SCM (GitHub)
	checkSuiteFailure?: boolean;
	prReviewSubmitted?: boolean;
	prCommentMention?: boolean;
	prOpened?: boolean;
	// SCM (GitHub review trigger) - nested object
	reviewTrigger?: {
		ownPrsOnly?: boolean;
		externalPrs?: boolean;
		onReviewRequested?: boolean;
	};
	// Lifecycle (kept in legacy table, not migrated)
	prReadyToMerge?: boolean;
	prMerged?: boolean;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: migration script with straightforward nested logic
async function migrateIntegration(
	db: ReturnType<typeof getDb>,
	integration: { id: number; projectId: string; category: string; triggers: unknown },
	dryRun: boolean,
	stats: MigrationStats,
): Promise<void> {
	const triggers = integration.triggers as LegacyTriggers;
	if (!triggers || typeof triggers !== 'object') {
		return;
	}

	const projectId = integration.projectId;
	const configsToCreate: Array<{
		agentType: string;
		event: string;
		enabled: boolean;
		parameters: Record<string, unknown>;
	}> = [];

	// Process PM triggers
	if (integration.category === 'pm') {
		// Card-moved triggers (Trello)
		for (const [key, mapping] of Object.entries(PM_CARD_MOVED_MAPPINGS)) {
			const value = triggers[key as keyof LegacyTriggers];
			if (typeof value === 'boolean') {
				configsToCreate.push({
					agentType: mapping.agentType,
					event: mapping.event,
					enabled: value,
					parameters: {},
				});
			}
		}

		// Issue-transitioned triggers (JIRA)
		const issueTransitioned = triggers.issueTransitioned;
		if (issueTransitioned !== undefined) {
			if (typeof issueTransitioned === 'boolean') {
				// Boolean applies to all agents
				for (const agentType of PM_ISSUE_TRANSITIONED_AGENTS) {
					configsToCreate.push({
						agentType,
						event: 'pm:status-changed',
						enabled: issueTransitioned,
						parameters: {},
					});
				}
			} else if (typeof issueTransitioned === 'object') {
				// Per-agent settings
				for (const agentType of PM_ISSUE_TRANSITIONED_AGENTS) {
					const value = issueTransitioned[agentType];
					if (typeof value === 'boolean') {
						configsToCreate.push({
							agentType,
							event: 'pm:status-changed',
							enabled: value,
							parameters: {},
						});
					}
				}
			}
		}

		// Label-added triggers
		const readyToProcessLabel = triggers.readyToProcessLabel;
		if (readyToProcessLabel !== undefined) {
			if (typeof readyToProcessLabel === 'boolean') {
				// Boolean applies to all agents
				for (const agentType of PM_LABEL_ADDED_AGENTS) {
					configsToCreate.push({
						agentType,
						event: 'pm:label-added',
						enabled: readyToProcessLabel,
						parameters: {},
					});
				}
			} else if (typeof readyToProcessLabel === 'object') {
				// Per-agent settings
				for (const agentType of PM_LABEL_ADDED_AGENTS) {
					const value = readyToProcessLabel[agentType];
					if (typeof value === 'boolean') {
						configsToCreate.push({
							agentType,
							event: 'pm:label-added',
							enabled: value,
							parameters: {},
						});
					}
				}
			}
		}

		// Comment mention (affects planning and respond-to-planning-comment)
		if (typeof triggers.commentMention === 'boolean') {
			configsToCreate.push({
				agentType: 'planning',
				event: 'pm:comment-mention',
				enabled: triggers.commentMention,
				parameters: {},
			});
			configsToCreate.push({
				agentType: 'respond-to-planning-comment',
				event: 'pm:comment-mention',
				enabled: triggers.commentMention,
				parameters: {},
			});
		}
	}

	// Process SCM triggers
	if (integration.category === 'scm') {
		// Simple SCM triggers
		for (const [key, mapping] of Object.entries(SCM_SIMPLE_MAPPINGS)) {
			const value = triggers[key as keyof LegacyTriggers];
			if (typeof value === 'boolean') {
				configsToCreate.push({
					agentType: mapping.agentType,
					event: mapping.event,
					enabled: value,
					parameters: mapping.parameters ?? {},
				});
			}
		}

		// Review trigger (nested)
		const reviewTrigger = triggers.reviewTrigger;
		if (reviewTrigger && typeof reviewTrigger === 'object') {
			for (const [key, mapping] of Object.entries(REVIEW_TRIGGER_MAPPINGS)) {
				const value = reviewTrigger[key as keyof typeof reviewTrigger];
				if (typeof value === 'boolean') {
					configsToCreate.push({
						agentType: mapping.agentType,
						event: mapping.event,
						enabled: value,
						parameters: mapping.parameters ?? {},
					});
				}
			}
		}
	}

	// Upsert each config
	for (const config of configsToCreate) {
		// Check if config already exists
		const [existing] = await db
			.select({ id: agentTriggerConfigs.id })
			.from(agentTriggerConfigs)
			.where(
				and(
					eq(agentTriggerConfigs.projectId, projectId),
					eq(agentTriggerConfigs.agentType, config.agentType),
					eq(agentTriggerConfigs.triggerEvent, config.event),
				),
			);

		if (existing) {
			stats.configsSkipped++;
			console.log(`  [skip] ${projectId}/${config.agentType}/${config.event}: already exists`);
			continue;
		}

		if (dryRun) {
			stats.configsCreated++;
			console.log(
				`  [would create] ${projectId}/${config.agentType}/${config.event}: enabled=${config.enabled}`,
			);
		} else {
			await db.insert(agentTriggerConfigs).values({
				projectId,
				agentType: config.agentType,
				triggerEvent: config.event,
				enabled: config.enabled,
				parameters: config.parameters,
			});
			stats.configsCreated++;
			console.log(
				`  [created] ${projectId}/${config.agentType}/${config.event}: enabled=${config.enabled}`,
			);
		}
	}

	if (configsToCreate.length > 0) {
		stats.integrationsMigrated++;
	}
}

async function main() {
	const dryRun = process.argv.includes('--dry-run');

	console.log(`\nTrigger Config Migration${dryRun ? ' (DRY RUN)' : ''}`);
	console.log('='.repeat(50));

	const db = getDb();

	// Get all integrations with non-empty triggers
	const integrations = await db
		.select({
			id: projectIntegrations.id,
			projectId: projectIntegrations.projectId,
			category: projectIntegrations.category,
			triggers: projectIntegrations.triggers,
		})
		.from(projectIntegrations)
		.where(sql`${projectIntegrations.triggers} != '{}'::jsonb`);

	console.log(`\nFound ${integrations.length} integrations with trigger configs\n`);

	const stats: MigrationStats = {
		integrationsMigrated: 0,
		configsCreated: 0,
		configsSkipped: 0,
		configsUpdated: 0,
	};

	for (const integration of integrations) {
		console.log(`Processing: ${integration.projectId} (${integration.category})`);
		await migrateIntegration(db, integration, dryRun, stats);
	}

	console.log(`\n${'='.repeat(50)}`);
	console.log(`${dryRun ? '[DRY RUN] ' : ''}Migration Summary:`);
	console.log(`  Integrations processed: ${stats.integrationsMigrated}`);
	console.log(`  Configs created: ${stats.configsCreated}`);
	console.log(`  Configs skipped (already exist): ${stats.configsSkipped}`);
	console.log('');

	await closeDb();
}

main().catch((err) => {
	console.error('Error:', err);
	process.exit(1);
});
