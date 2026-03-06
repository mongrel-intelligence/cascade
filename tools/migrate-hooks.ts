#!/usr/bin/env npx tsx
/**
 * Migration script: Converts legacy `backend` and `trailingMessage` fields
 * in agent_definitions JSONB to the new unified `hooks` structure.
 *
 * Usage:
 *   npx tsx tools/migrate-hooks.ts            # Preview (dry-run)
 *   npx tsx tools/migrate-hooks.ts --apply    # Apply changes
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
if (!DATABASE_URL) {
	console.error('DATABASE_URL is required');
	process.exit(1);
}

const dryRun = !process.argv.includes('--apply');

interface LegacyBackend {
	enableStopHooks?: boolean;
	needsGitHubToken?: boolean;
	blockGitPush?: boolean;
	requiresPR?: boolean;
	hooks?: {
		scm?: {
			enableStopHooks?: boolean;
			blockGitPush?: boolean;
			requiresPR?: boolean;
			requiresReview?: boolean;
			requiresPushedChanges?: boolean;
		};
	};
}

interface LegacyTrailingMessage {
	includeDiagnostics?: boolean;
	includeTodoProgress?: boolean;
	includeGitStatus?: boolean;
	includePRStatus?: boolean;
	includeReminder?: boolean;
}

interface NewHooks {
	trailing?: {
		scm?: { gitStatus?: boolean; prStatus?: boolean };
		builtin?: { diagnostics?: boolean; todoProgress?: boolean; reminder?: boolean };
	};
	finish?: {
		scm?: {
			requiresPR?: boolean;
			requiresReview?: boolean;
			requiresPushedChanges?: boolean;
			blockGitPush?: boolean;
		};
	};
}

/** Migrate legacy backend config → hooks.finish.scm */
function migrateBackendToFinish(backend: LegacyBackend, hooks: NewHooks, agentType?: string): void {
	const legacyScm = {
		...(backend.blockGitPush !== undefined && { blockGitPush: backend.blockGitPush }),
		...(backend.requiresPR !== undefined && { requiresPR: backend.requiresPR }),
	};
	const nestedScm = backend.hooks?.scm ?? {};
	// Drop enableStopHooks — it's now implied by having any finish hook
	const { enableStopHooks: _drop, ...mergedScm } = { ...legacyScm, ...nestedScm };

	if (backend.enableStopHooks && Object.keys(mergedScm).length === 0) {
		console.warn(
			`    WARNING: ${agentType ?? 'unknown'} had enableStopHooks: true but no finish requirements — stop hooks will be disabled`,
		);
	}

	if (Object.keys(mergedScm).length > 0) {
		hooks.finish = { ...hooks.finish, scm: { ...hooks.finish?.scm, ...mergedScm } };
	}
}

/** Migrate legacy trailingMessage → hooks.trailing */
function migrateTrailingMessage(trailing: LegacyTrailingMessage, hooks: NewHooks): void {
	const scm: Record<string, boolean> = {};
	const builtin: Record<string, boolean> = {};

	if (trailing.includeGitStatus) scm.gitStatus = true;
	if (trailing.includePRStatus) scm.prStatus = true;
	if (trailing.includeDiagnostics) builtin.diagnostics = true;
	if (trailing.includeTodoProgress) builtin.todoProgress = true;
	if (trailing.includeReminder) builtin.reminder = true;

	if (Object.keys(scm).length > 0 || Object.keys(builtin).length > 0) {
		hooks.trailing = {
			...hooks.trailing,
			...(Object.keys(scm).length > 0 && { scm }),
			...(Object.keys(builtin).length > 0 && { builtin }),
		};
	}
}

function migrateDefinition(
	def: Record<string, unknown>,
	agentType?: string,
): Record<string, unknown> | null {
	const backend = def.backend as LegacyBackend | undefined;
	const trailing = def.trailingMessage as LegacyTrailingMessage | undefined;

	if (!backend && !trailing) return null;

	const hooks: NewHooks = (def.hooks as NewHooks) ?? {};

	if (backend) migrateBackendToFinish(backend, hooks, agentType);
	if (trailing) migrateTrailingMessage(trailing, hooks);

	// Build updated definition without legacy fields
	const { backend: _b, trailingMessage: _t, ...rest } = def;
	return {
		...rest,
		...(Object.keys(hooks).length > 0 && { hooks }),
	};
}

async function main() {
	const sql = postgres(DATABASE_URL);

	try {
		const rows = await sql<
			{ id: number; agent_type: string; definition: Record<string, unknown> }[]
		>`
			SELECT id, agent_type, definition FROM agent_definitions
		`;

		console.log(`Found ${rows.length} agent definitions`);

		let migrated = 0;
		for (const row of rows) {
			const updated = migrateDefinition(row.definition, row.agent_type);
			if (!updated) {
				console.log(`  ${row.agent_type}: no changes needed`);
				continue;
			}

			migrated++;
			console.log(`  ${row.agent_type}: ${dryRun ? 'would migrate' : 'migrating'}...`);

			if (dryRun) {
				console.log(
					`    before: ${JSON.stringify({ backend: row.definition.backend, trailingMessage: row.definition.trailingMessage })}`,
				);
				console.log(`    after:  ${JSON.stringify(updated.hooks)}`);
			}

			if (!dryRun) {
				await sql`
					UPDATE agent_definitions
					SET definition = ${JSON.stringify(updated)}::jsonb,
					    updated_at = NOW()
					WHERE id = ${row.id}
				`;
			}
		}

		console.log(
			`\n${dryRun ? '[DRY RUN] ' : ''}${migrated} definitions ${dryRun ? 'would be' : 'were'} migrated`,
		);
		if (dryRun && migrated > 0) {
			console.log('Run with --apply to apply changes');
		}
	} finally {
		await sql.end();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
