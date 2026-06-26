import { boolean, integer, jsonb, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import type { EngineSettings } from '../../config/engineSettings.js';
import { organizations } from './organizations.js';

export const projects = pgTable(
	'projects',
	{
		id: text('id').primaryKey(),
		orgId: text('org_id')
			.notNull()
			.references(() => organizations.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		repo: text('repo').unique(),
		baseBranch: text('base_branch').default('main'),
		branchPrefix: text('branch_prefix').default('feature/'),

		model: text('model'),
		maxIterations: integer('max_iterations'),
		watchdogTimeoutMs: integer('watchdog_timeout_ms'),
		workItemBudgetUsd: numeric('work_item_budget_usd', { precision: 10, scale: 2 }),
		agentEngine: text('agent_engine'),
		agentEngineSettings: jsonb('agent_engine_settings').$type<EngineSettings>(),
		progressModel: text('progress_model'),
		progressIntervalMinutes: numeric('progress_interval_minutes', { precision: 5, scale: 1 }),
		runLinksEnabled: boolean('run_links_enabled').default(false).notNull(),
		maxInFlightItems: integer('max_in_flight_items'),

		snapshotEnabled: boolean('snapshot_enabled'),
		snapshotTtlMs: integer('snapshot_ttl_ms'),

		// Per-project wall timeout (ms) for `.cascade/setup.sh`. Nullable; NULL or 0
		// means no per-project wall timeout (rely on the global worker/watchdog
		// container timeout). A positive value bounds the setup script's wall clock.
		setupTimeoutMs: integer('setup_timeout_ms'),

		// Per-project worker image (spec 022). All nullable; NULL = use the
		// global router-level default image. Dormant until plans 2-4 wire
		// spawn resolution, validation, CLI/API, and UI.
		workerImage: text('worker_image'),
		workerImageDigest: text('worker_image_digest'),
		workerImageStatus: text('worker_image_status'),
		workerImageError: text('worker_image_error'),

		createdAt: timestamp('created_at').defaultNow(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	// Partial unique index (only for non-null values) defined in migration 0019
	() => [],
);
