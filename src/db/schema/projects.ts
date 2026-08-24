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
		repo: text('repo'),
		// Spec 024: several projects may share a repository. The partial unique
		// index uq_projects_repo_primary enforces AT MOST one primary per repo;
		// requiring that one exists is save-time validation's job (plan 4), since
		// an index cannot mandate a row. The primary receives GitHub events that
		// carry no PR->project link.
		repoPrimary: boolean('repo_primary').notNull().default(true),
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
		//
		// For a dockerfile-sourced project (spec 023) the meaning of the shared
		// columns widens: worker_image stays the REFERENCED ref (null when built
		// from a Dockerfile), worker_image_digest holds the active launchable pin
		// (a registry digest OR the LOCAL built image ID), and worker_image_status
		// additionally admits 'building'.
		workerImage: text('worker_image'),
		workerImageDigest: text('worker_image_digest'),
		workerImageStatus: text('worker_image_status'),
		workerImageError: text('worker_image_error'),

		// Per-project worker Dockerfile (spec 023). All nullable; NULL = not a
		// dockerfile-sourced project. Dormant until plans 2-5 wire spawn
		// resolution, the build engine, set surfaces, and UI.
		//
		// worker_dockerfile         — operator's extra-layers content (RUN/COPY/ENV).
		// worker_image_build_hash   — content-hash of desired content (job identity
		//                             + supersede guard; computed by plan 4).
		// worker_image_build_status — status of the most recent (re)build ATTEMPT
		//                             ('building' | 'failed'; NULL = idle). Split from
		//                             worker_image_status so a failed rebuild never
		//                             strands the still-runnable verified pin.
		workerDockerfile: text('worker_dockerfile'),
		workerImageBuildHash: text('worker_image_build_hash'),
		workerImageBuildStatus: text('worker_image_build_status'),

		createdAt: timestamp('created_at').defaultNow(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	// Indexes live in the hand-written migrations, not here: migration 0061
	// replaced 0019's plain `uq_projects_repo` with the partial
	// `uq_projects_repo_primary` (WHERE repo IS NOT NULL AND repo_primary).
	() => [],
);
