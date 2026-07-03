import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { CLAUDE_CODE_SETTING_DEFAULTS } from '../../backends/claude-code/settings.js';
import { CODEX_SETTING_DEFAULTS } from '../../backends/codex/settings.js';
import { OPENCODE_SETTING_DEFAULTS } from '../../backends/opencode/settings.js';
import { EngineSettingsSchema } from '../../config/engineSettings.js';
import { getOrgCredential } from '../../config/provider.js';
import { PROJECT_DEFAULTS } from '../../config/schema.js';
import { validateWorkerDockerfileContent } from '../../config/workerDockerfileContent.js';
import { isValidImageReference } from '../../config/workerImageRef.js';
import { getDb } from '../../db/client.js';
import {
	deleteProjectCredential,
	listProjectCredentials,
	listProjectCredentialsMeta,
	writeProjectCredential,
} from '../../db/repositories/credentialsRepository.js';
import { listProjectsForOrg } from '../../db/repositories/runsRepository.js';
import {
	createProject,
	deleteProject,
	deleteProjectIntegration,
	getProjectFull,
	listProjectIntegrations,
	listProjectsFull,
	updateProject,
	updateProjectIntegrationTriggers,
	upsertProjectIntegration,
} from '../../db/repositories/settingsRepository.js';
import { projects } from '../../db/schema/index.js';
import { fetchOpenRouterModels } from '../../openrouter/client.js';
import { enqueueWorkerImageBuildJob, enqueueWorkerImageValidationJob } from '../../queue/client.js';
import { routerConfig } from '../../router/config.js';
import { computeContentHash } from '../../router/worker-dockerfile-compose.js';
import { captureException } from '../../sentry.js';
import { logger } from '../../utils/logging.js';
import { protectedProcedure, publicProcedure, router, superAdminProcedure } from '../trpc.js';

/**
 * The current worker-image/dockerfile state read alongside the ownership check.
 * `workerImage` drives the image audit "from"; the three dockerfile columns feed
 * the set-Dockerfile mutual-exclusivity + idempotency logic (spec 023) and the
 * `rebuildWorkerImage` source guard.
 */
interface OwnedProjectWorkerState {
	orgId: string;
	workerImage: string | null;
	workerDockerfile: string | null;
	workerImageBuildHash: string | null;
	workerImageStatus: string | null;
}

async function verifyProjectOwnership(
	projectId: string,
	orgId: string,
): Promise<OwnedProjectWorkerState> {
	const db = getDb();
	const [project] = await db
		.select({
			orgId: projects.orgId,
			workerImage: projects.workerImage,
			workerDockerfile: projects.workerDockerfile,
			workerImageBuildHash: projects.workerImageBuildHash,
			workerImageStatus: projects.workerImageStatus,
		})
		.from(projects)
		.where(eq(projects.id, projectId));
	if (!project || project.orgId !== orgId) {
		throw new TRPCError({ code: 'NOT_FOUND' });
	}
	return {
		orgId: project.orgId,
		workerImage: project.workerImage ?? null,
		workerDockerfile: project.workerDockerfile ?? null,
		workerImageBuildHash: project.workerImageBuildHash ?? null,
		workerImageStatus: project.workerImageStatus ?? null,
	};
}

/**
 * Worker-image column writes computed from a set/clear request (spec 022). The
 * digest is always cleared here — it is re-pinned only by the router-side
 * validator on success. Status is `pending` on set (awaiting validation) and
 * `null` on clear (revert to the global default).
 */
interface WorkerImageColumns {
	workerImage: string | null;
	// The shared launchable-pin columns. Always written on SET (`pending` +
	// cleared digest/error). On CLEAR they are nulled — reverting to the global
	// default — ONLY when the project was reference-sourced; on a
	// dockerfile-sourced project they are OMITTED (undefined) so
	// `--clear-worker-image` cannot wipe the Dockerfile build's verified pin and
	// strand the project. Symmetric to `processWorkerDockerfileChange`'s
	// `wasDockerfileSourced` guard on these same columns.
	workerImageStatus?: 'pending' | null;
	workerImageDigest?: null;
	workerImageError?: null;
	// Spec 023 mutual exclusivity (the reference → dockerfile direction): setting a
	// non-null referenced image clears any Dockerfile source + its build columns so
	// a project always has exactly one effective image source. Omitted (undefined)
	// on the clear path, which only reverts the referenced-image columns.
	workerDockerfile?: null;
	workerImageBuildHash?: null;
	workerImageBuildStatus?: null;
}

/**
 * Validate and translate a worker-image set/clear request into DB column writes
 * (spec 022 plan 3/4). Superadmin-gated; malformed refs are rejected
 * synchronously so nothing is persisted. Returns `null` when the field was not
 * touched (so existing callers are unaffected), otherwise the columns to persist
 * plus the ref to enqueue for validation (set only).
 *
 *   - not touched            → `null`
 *   - non-superadmin actor   → throws `FORBIDDEN`
 *   - clear (`null`)         → `workerImage` null; the launchable-pin columns are
 *                              nulled only when the project was reference-sourced
 *                              (see below); no enqueue
 *   - set (`string`)         → grammar-checked; `pending` + enqueue, or `BAD_REQUEST`
 *
 * `existing.workerDockerfile` guards the clear path against stranding a
 * dockerfile-sourced project (spec 023). The launchable-pin columns
 * (`worker_image_status`/`digest`/`error`) are SHARED between the reference and
 * dockerfile sources. A dockerfile-sourced project already has `workerImage`
 * null (mutual exclusivity), so clearing the (already-null) reference must NOT
 * touch those columns — they hold the Dockerfile build's verified pin. Wiping
 * them would leave `deriveWorkerImageSource` at `dockerfile` with an unverified
 * pin, so `resolveEffectiveBaseImage` throws `WorkerImageResolutionError` on
 * every spawn with no rebuild enqueued (unlaunchable until a manual re-set /
 * rebuild). This is the mirror of `processWorkerDockerfileChange`'s
 * `wasDockerfileSourced` guard.
 */
function processWorkerImageChange(opts: {
	touched: boolean;
	value: string | null;
	actorRole: 'member' | 'admin' | 'superadmin';
	existing: { workerDockerfile: string | null };
}): { columns: WorkerImageColumns; enqueueRef: string | null } | null {
	if (!opts.touched) return null;

	if (opts.actorRole !== 'superadmin') {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: 'Superadmin access required to change the worker image',
		});
	}

	if (opts.value === null) {
		const wasDockerfileSourced = opts.existing.workerDockerfile != null;
		return {
			columns: {
				workerImage: null,
				// No-strand guard: only a reference-sourced project's launchable pin
				// lives in these columns, so revert them to the global default. A
				// dockerfile-sourced project keeps its Dockerfile build's pin intact.
				...(wasDockerfileSourced
					? {}
					: { workerImageStatus: null, workerImageDigest: null, workerImageError: null }),
			},
			enqueueRef: null,
		};
	}

	const ref = opts.value.trim();
	if (!isValidImageReference(ref)) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: `Invalid worker image reference: ${opts.value}`,
		});
	}

	return {
		columns: {
			workerImage: ref,
			workerImageStatus: 'pending',
			workerImageDigest: null,
			workerImageError: null,
			// Mutual exclusivity (spec 023): a referenced image supersedes any
			// Dockerfile source. Clear the content + its build columns so the derived
			// source flips to `reference` and no stale build state lingers.
			workerDockerfile: null,
			workerImageBuildHash: null,
			workerImageBuildStatus: null,
		},
		enqueueRef: ref,
	};
}

/**
 * Side-effects after a worker-image change is persisted: emit a structured,
 * grep-stable audit line (AC #8) and enqueue the eager router-side validation job
 * (set only). Kept separate so the create/update mutations stay readable.
 *
 * The audit line is emitted BEFORE the enqueue: by the time this runs the column
 * write is already committed, so every persisted set/clear MUST be audited even
 * if the enqueue then throws (e.g. Redis unavailable). Auditing after the enqueue
 * would lose the record on enqueue failure while the change stayed persisted.
 */
async function finalizeWorkerImageChange(opts: {
	change: { columns: WorkerImageColumns; enqueueRef: string | null };
	actorId: string;
	projectId: string;
	from: string | null;
}): Promise<void> {
	logger.info('[audit] project worker image changed', {
		event: 'project_worker_image_changed',
		actorId: opts.actorId,
		projectId: opts.projectId,
		from: opts.from,
		to: opts.change.columns.workerImage,
	});
	if (opts.change.enqueueRef) {
		await enqueueWorkerImageValidationJob({
			projectId: opts.projectId,
			ref: opts.change.enqueueRef,
		});
	}
}

/**
 * Worker-Dockerfile column writes computed from a set/clear request (spec 023).
 * A superset of {@link WorkerImageColumns}: setting a Dockerfile is mutually
 * exclusive with a referenced image, so the set path also clears `workerImage` +
 * its digest, and manages both the build-attempt status (`workerImageBuildStatus`)
 * and the launchable-image status (`workerImageStatus`) independently.
 */
interface WorkerDockerfileColumns {
	workerDockerfile: string | null;
	workerImageBuildHash: string | null;
	workerImageBuildStatus: 'building' | null;
	// Mutual exclusivity + launchable-pin management (set/clear path only).
	workerImage?: null;
	workerImageDigest?: null;
	workerImageStatus?: 'building' | 'verified' | null;
	workerImageError?: null;
}

/**
 * Validate and translate a worker-Dockerfile set/clear request into DB column
 * writes (spec 023 plan 4). Mirrors {@link processWorkerImageChange}; the set
 * surface has NO Docker access so it computes only the Docker-free content-hash
 * (`computeContentHash`) — the router (plan 3) resolves the base digest and does
 * the real build. Superadmin-gated; invalid content is rejected synchronously so
 * nothing is persisted. Returns `null` when nothing should change (field not
 * touched, or a byte-identical re-save on an already-verified project).
 *
 *   - not touched                 → `null`
 *   - non-superadmin actor        → throws `FORBIDDEN`
 *   - clear (`null`)              → drop the content + build columns (reverting a
 *                                   dockerfile-sourced project's launchable pin);
 *                                   no enqueue
 *   - set (`string`)              → content-checked; `BAD_REQUEST` on invalid.
 *                                   Idempotent no-op (`null`) when byte-identical
 *                                   on a verified project; otherwise `building` +
 *                                   enqueue a superseding build.
 *
 * `existing` is the project's current state (all-null for `create`, where there is
 * no prior project). `priorVerified` — an ALREADY dockerfile-sourced project
 * (`existing.workerDockerfile != null`) whose `worker_image_status === 'verified'`
 * — is the no-strand hinge: when true the last-good launchable pin
 * (`worker_image_digest`) is PRESERVED and `worker_image_status` stays `verified`
 * so the project keeps running on it while the rebuild is in flight (the invariant
 * `recordWorkerImageBuildResult`'s `keepActive` path relies on). A verified
 * *reference* project is deliberately EXCLUDED: its digest is a registry digest, so
 * a reference/default → dockerfile switch is a first build (`workerImageStatus:
 * 'building'`, digest cleared) rather than inheriting a foreign registry pin.
 */
function processWorkerDockerfileChange(opts: {
	touched: boolean;
	value: string | null;
	actorRole: 'member' | 'admin' | 'superadmin';
	existing: {
		workerDockerfile: string | null;
		workerImageBuildHash: string | null;
		workerImageStatus: string | null;
	};
}): {
	columns: WorkerDockerfileColumns;
	enqueueBuildHash: string | null;
	auditTo: string | null;
} | null {
	if (!opts.touched) return null;

	if (opts.actorRole !== 'superadmin') {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: 'Superadmin access required to change the worker Dockerfile',
		});
	}

	if (opts.value === null) {
		const wasDockerfileSourced = opts.existing.workerDockerfile != null;
		return {
			columns: {
				workerDockerfile: null,
				workerImageBuildHash: null,
				workerImageBuildStatus: null,
				// Only a dockerfile-sourced project's launchable pin lives in these
				// columns; reset them to revert to the global default. A
				// reference-sourced project keeps its own `worker_image_*` state.
				...(wasDockerfileSourced
					? { workerImageStatus: null, workerImageDigest: null, workerImageError: null }
					: {}),
			},
			enqueueBuildHash: null,
			auditTo: null,
		};
	}

	const validation = validateWorkerDockerfileContent(opts.value);
	if (!validation.valid) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: `Invalid worker Dockerfile content: ${validation.error}`,
		});
	}

	const content = opts.value;
	const contentHash = computeContentHash(content);
	// `priorVerified` gates BOTH the idempotency no-op and the no-strand pin
	// preservation below, so it must be true ONLY when the project was ALREADY
	// dockerfile-sourced with a verified DOCKERFILE-BUILD pin. `worker_image_status`
	// is also `verified` for a verified *reference* project, whose
	// `worker_image_digest` is a REGISTRY digest — preserving it here would relabel
	// that registry digest as a local-only Dockerfile image (`deriveWorkerImageSource`
	// flips to `dockerfile`, `resolveEffectiveBaseImage` returns it with
	// `localOnly: true`), silently running the old reference image or failing closed
	// with a misleading local-only terminal error. A reference/default → dockerfile
	// switch is therefore a FIRST build: the digest is cleared and the launchable
	// status is `building`, exactly like default → dockerfile. Symmetric to the
	// clear path's `wasDockerfileSourced` guard.
	const priorVerified =
		opts.existing.workerDockerfile != null && opts.existing.workerImageStatus === 'verified';

	// Idempotency: a byte-identical re-save on an already-verified dockerfile-sourced
	// project keeps the verified image and does NOT enqueue a redundant build.
	if (contentHash === opts.existing.workerImageBuildHash && priorVerified) {
		return null;
	}

	return {
		columns: {
			workerDockerfile: content,
			workerImageBuildHash: contentHash,
			workerImageBuildStatus: 'building',
			// Mutual exclusivity: clear the referenced image so the derived source
			// flips to `dockerfile`.
			workerImage: null,
			workerImageError: null,
			// Keep the project runnable on its last-good verified pin during the
			// rebuild when one exists (no-strand); otherwise there is no pin, so mark
			// the launchable status `building` and clear the (stale) digest.
			workerImageStatus: priorVerified ? 'verified' : 'building',
			...(priorVerified ? {} : { workerImageDigest: null }),
		},
		enqueueBuildHash: contentHash,
		auditTo: contentHash,
	};
}

/**
 * Side-effects after a worker-Dockerfile change is persisted: emit the
 * grep-stable audit line then enqueue the eager router-side BUILD job (set only).
 * Mirrors {@link finalizeWorkerImageChange}; the audit precedes the enqueue for
 * the same reason (a persisted change must be audited even if Redis is down).
 * The audited `from`/`to` are content-hashes, not the (potentially large)
 * Dockerfile bodies.
 */
async function finalizeWorkerDockerfileChange(opts: {
	change: { enqueueBuildHash: string | null; auditTo: string | null };
	actorId: string;
	projectId: string;
	from: string | null;
}): Promise<void> {
	logger.info('[audit] project worker dockerfile changed', {
		event: 'project_worker_dockerfile_changed',
		actorId: opts.actorId,
		projectId: opts.projectId,
		from: opts.from,
		to: opts.change.auditTo,
	});
	if (opts.change.enqueueBuildHash) {
		await enqueueWorkerImageBuildJob({
			projectId: opts.projectId,
			buildHash: opts.change.enqueueBuildHash,
		});
	}
}

/**
 * Reject a create/update that SETS both a referenced image and a Dockerfile in a
 * single call (spec 023 mutual exclusivity, at the tRPC boundary). A project has
 * exactly one effective image source, so accepting both is contradictory:
 * column-spread lets the Dockerfile silently win while the referenced image
 * still triggers a spurious validation enqueue + a misleading `to: <ref>` audit
 * line for a value that was never persisted. The CLI already marks the flags
 * mutually exclusive; this makes the direct tRPC contract match. Only a both-SET
 * request collides — a `null` (explicit clear) on either side alongside setting
 * the other source stays coherent and is allowed.
 */
function assertWorkerSourceExclusive(input: {
	workerImage?: string | null;
	workerDockerfile?: string | null;
}): void {
	if (input.workerImage != null && input.workerDockerfile != null) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message:
				'workerImage and workerDockerfile are mutually exclusive; set only one ' +
				'(a project has a single worker image source)',
		});
	}
}

function normalizeIntegrationConfig(input: {
	category: 'pm' | 'scm' | 'alerting';
	provider: string;
	config: Record<string, unknown>;
}): Record<string, unknown> {
	if (input.category !== 'alerting' || input.provider !== 'sentry') {
		return input.config;
	}

	const organizationSlug =
		typeof input.config.organizationSlug === 'string' ? input.config.organizationSlug.trim() : '';
	const projectSlug =
		typeof input.config.projectSlug === 'string' ? input.config.projectSlug.trim() : '';
	const resultsContainerId =
		typeof input.config.resultsContainerId === 'string'
			? input.config.resultsContainerId.trim()
			: '';

	if (!organizationSlug) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: 'Sentry organization slug is required',
		});
	}
	if (!projectSlug) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: 'Sentry project slug is required',
		});
	}

	return {
		organizationSlug,
		projectSlug,
		...(resultsContainerId ? { resultsContainerId } : {}),
	};
}

function serializeProject<T extends { agentEngineSettings?: unknown }>(
	project: T,
): Omit<T, 'agentEngineSettings'> & { engineSettings: T['agentEngineSettings'] | null } {
	const { agentEngineSettings, ...rest } = project;
	return {
		...rest,
		engineSettings: (agentEngineSettings ?? null) as T['agentEngineSettings'] | null,
	};
}

export const projectsRouter = router({
	/**
	 * Returns all system-level default values, sourced from code constants.
	 * Use staleTime: Infinity on the client — these never change at runtime.
	 */
	defaults: publicProcedure.query(() => {
		return {
			model: PROJECT_DEFAULTS.model,
			maxIterations: PROJECT_DEFAULTS.maxIterations,
			watchdogTimeoutMs: PROJECT_DEFAULTS.watchdogTimeoutMs,
			progressModel: PROJECT_DEFAULTS.progressModel,
			progressIntervalMinutes: PROJECT_DEFAULTS.progressIntervalMinutes,
			workItemBudgetUsd: PROJECT_DEFAULTS.workItemBudgetUsd,
			agentEngine: PROJECT_DEFAULTS.agentEngine,
			engineSettings: {
				'claude-code': CLAUDE_CODE_SETTING_DEFAULTS,
				codex: CODEX_SETTING_DEFAULTS,
				opencode: OPENCODE_SETTING_DEFAULTS,
			},
			// Global worker image — the default a project falls back to when it has
			// no per-project `workerImage` set (spec 022). Surfaced so the dashboard
			// can show "unset = <this image>".
			workerImage: routerConfig.workerImage,
		};
	}),

	// Existing - returns id+name for dropdowns
	list: protectedProcedure.query(async ({ ctx }) => {
		return listProjectsForOrg(ctx.effectiveOrgId);
	}),

	listAll: superAdminProcedure.query(async () => {
		const db = getDb();
		return db.select({ id: projects.id, name: projects.name }).from(projects);
	}),

	// New - returns all columns
	listFull: protectedProcedure.query(async ({ ctx }) => {
		return (await listProjectsFull(ctx.effectiveOrgId)).map(serializeProject);
	}),

	getById: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
		const project = await getProjectFull(input.id, ctx.effectiveOrgId);
		if (!project) throw new TRPCError({ code: 'NOT_FOUND' });
		return serializeProject(project);
	}),

	create: protectedProcedure
		.input(
			z.object({
				id: z
					.string()
					.min(1)
					.regex(/^[a-z0-9-]+$/),
				name: z.string().min(1),
				repo: z.string().min(1).optional(),
				baseBranch: z.string().optional(),
				branchPrefix: z.string().optional(),
				model: z.string().nullish(),
				maxIterations: z.number().int().positive().nullish(),
				watchdogTimeoutMs: z.number().int().positive().nullish(),
				workItemBudgetUsd: z.string().nullish(),
				agentEngine: z.string().nullish(),
				engineSettings: EngineSettingsSchema.nullish(),
				progressModel: z.string().nullish(),
				progressIntervalMinutes: z.string().nullish(),
				runLinksEnabled: z.boolean().optional(),
				maxInFlightItems: z.number().int().positive().nullish(),
				snapshotEnabled: z.boolean().nullish(),
				snapshotTtlMs: z.number().int().positive().nullish(),
				// Wall timeout (ms) for `.cascade/setup.sh`. `.nonnegative()` (NOT
				// `.positive()`) so an explicit `0` ("disable") is transmitted.
				setupTimeoutMs: z.number().int().nonnegative().nullish(),
				// Per-project worker image (spec 022). Superadmin-only; a malformed
				// ref is rejected synchronously. `null` is accepted as an explicit
				// "use the global default".
				workerImage: z.string().nullish(),
				// Per-project worker Dockerfile content (spec 023). Superadmin-only;
				// invalid content → `BAD_REQUEST` (nothing persisted). Setting it clears
				// any referenced image (mutual exclusivity) and enqueues a build.
				workerDockerfile: z.string().nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			// A project has a single image source: reject setting both at once.
			assertWorkerSourceExclusive(input);
			// A create has no prior project, so the existing worker state is empty:
			// never dockerfile-sourced, never idempotent, never `priorVerified`.
			const workerImageChange = processWorkerImageChange({
				touched: input.workerImage !== undefined,
				value: input.workerImage ?? null,
				actorRole: ctx.user.role,
				existing: { workerDockerfile: null },
			});
			const workerDockerfileChange = processWorkerDockerfileChange({
				touched: input.workerDockerfile !== undefined,
				value: input.workerDockerfile ?? null,
				actorRole: ctx.user.role,
				existing: { workerDockerfile: null, workerImageBuildHash: null, workerImageStatus: null },
			});
			const { workerImage: _workerImage, workerDockerfile: _workerDockerfile, ...rest } = input;

			const created = await createProject(ctx.effectiveOrgId, {
				...rest,
				...(input.agentEngine !== undefined ? { agentEngine: input.agentEngine } : {}),
				...(input.engineSettings !== undefined ? { engineSettings: input.engineSettings } : {}),
				...(workerImageChange ? workerImageChange.columns : {}),
				...(workerDockerfileChange ? workerDockerfileChange.columns : {}),
			});

			if (workerImageChange) {
				await finalizeWorkerImageChange({
					change: workerImageChange,
					actorId: ctx.user.id,
					projectId: input.id,
					from: null,
				});
			}

			if (workerDockerfileChange) {
				await finalizeWorkerDockerfileChange({
					change: workerDockerfileChange,
					actorId: ctx.user.id,
					projectId: input.id,
					from: null,
				});
			}

			return created;
		}),

	update: protectedProcedure
		.input(
			z.object({
				id: z.string(),
				name: z.string().min(1).optional(),
				repo: z.string().min(1).optional(),
				baseBranch: z.string().optional(),
				branchPrefix: z.string().optional(),
				model: z.string().nullish(),
				maxIterations: z.number().int().positive().nullish(),
				watchdogTimeoutMs: z.number().int().positive().nullish(),
				workItemBudgetUsd: z.string().nullish(),
				agentEngine: z.string().nullish(),
				engineSettings: EngineSettingsSchema.nullish(),
				progressModel: z.string().nullish(),
				progressIntervalMinutes: z.string().nullish(),
				runLinksEnabled: z.boolean().optional(),
				maxInFlightItems: z.number().int().positive().nullish(),
				snapshotEnabled: z.boolean().nullish(),
				snapshotTtlMs: z.number().int().positive().nullish(),
				// Wall timeout (ms) for `.cascade/setup.sh`. `.nonnegative()` (NOT
				// `.positive()`) so the CLI/UI can send `0` to disable.
				setupTimeoutMs: z.number().int().nonnegative().nullish(),
				// Per-project worker image (spec 022). Superadmin-only; a malformed
				// ref → `BAD_REQUEST` (nothing persisted). `null` clears it back to
				// the global default. Set → stored `pending` + validation enqueued.
				workerImage: z.string().nullish(),
				// Per-project worker Dockerfile content (spec 023). Superadmin-only;
				// invalid content → `BAD_REQUEST` (nothing persisted). `null` clears it
				// (reverting a dockerfile-sourced project to the default). Set → stored
				// `building` + content-hash + build enqueued; clears any referenced image.
				workerDockerfile: z.string().nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const owned = await verifyProjectOwnership(input.id, ctx.effectiveOrgId);

			// A project has a single image source: reject setting both at once.
			assertWorkerSourceExclusive(input);

			// Validate + authorize both worker-source changes BEFORE persisting so a
			// FORBIDDEN/BAD_REQUEST leaves the project untouched.
			const workerImageChange = processWorkerImageChange({
				touched: input.workerImage !== undefined,
				value: input.workerImage ?? null,
				actorRole: ctx.user.role,
				// Guards the clear path from stranding a dockerfile-sourced project by
				// wiping the shared launchable-pin columns (spec 023 no-strand).
				existing: { workerDockerfile: owned.workerDockerfile },
			});
			const workerDockerfileChange = processWorkerDockerfileChange({
				touched: input.workerDockerfile !== undefined,
				value: input.workerDockerfile ?? null,
				actorRole: ctx.user.role,
				existing: {
					workerDockerfile: owned.workerDockerfile,
					workerImageBuildHash: owned.workerImageBuildHash,
					workerImageStatus: owned.workerImageStatus,
				},
			});

			const {
				id,
				workerImage: _workerImage,
				workerDockerfile: _workerDockerfile,
				...updates
			} = input;
			await updateProject(id, ctx.effectiveOrgId, {
				...updates,
				...(input.agentEngine !== undefined ? { agentEngine: input.agentEngine } : {}),
				...(input.engineSettings !== undefined ? { engineSettings: input.engineSettings } : {}),
				...(workerImageChange ? workerImageChange.columns : {}),
				...(workerDockerfileChange ? workerDockerfileChange.columns : {}),
			});

			if (workerImageChange) {
				await finalizeWorkerImageChange({
					change: workerImageChange,
					actorId: ctx.user.id,
					projectId: id,
					from: owned.workerImage,
				});
			}

			if (workerDockerfileChange) {
				await finalizeWorkerDockerfileChange({
					change: workerDockerfileChange,
					actorId: ctx.user.id,
					projectId: id,
					// Audit the transition between content-hashes (prior → new).
					from: owned.workerImageBuildHash,
				});
			}
		}),

	/**
	 * Explicit worker-image rebuild for a Dockerfile-sourced project (spec 023
	 * plan 4). Superadmin-only. Re-enqueues a build even when the content is
	 * unchanged — the engine recomputes the full hash against the CURRENT base, so
	 * a refreshed base image actually rebuilds. `worker_image_build_status` flips
	 * to `building` while the launchable pin (`worker_image_status`/digest) is left
	 * untouched, so the project keeps running on its last-good image during the
	 * rebuild (no-strand).
	 */
	rebuildWorkerImage: superAdminProcedure
		.input(z.object({ projectId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const owned = await verifyProjectOwnership(input.projectId, ctx.effectiveOrgId);

			// Derived source must be `dockerfile` (worker_dockerfile set) — there is
			// nothing to rebuild for a `reference`/`default` project.
			if (owned.workerDockerfile == null) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'Rebuild is only available for a Dockerfile-sourced project',
				});
			}

			// A dockerfile-sourced project always carries its content-hash; fall back
			// to recomputing it from the stored content defensively so the enqueued
			// build's supersede guard always has a non-null identity to match.
			const buildHash = owned.workerImageBuildHash ?? computeContentHash(owned.workerDockerfile);

			await updateProject(input.projectId, ctx.effectiveOrgId, {
				workerImageBuildStatus: 'building',
			});

			logger.info('[audit] project worker dockerfile changed', {
				event: 'project_worker_dockerfile_changed',
				actorId: ctx.user.id,
				projectId: input.projectId,
				from: owned.workerImageBuildHash,
				to: buildHash,
				rebuild: true,
			});

			await enqueueWorkerImageBuildJob({ projectId: input.projectId, buildHash });
		}),

	delete: protectedProcedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			await verifyProjectOwnership(input.id, ctx.effectiveOrgId);
			await deleteProject(input.id, ctx.effectiveOrgId);
		}),

	// Integrations
	integrations: router({
		list: protectedProcedure
			.input(z.object({ projectId: z.string() }))
			.query(async ({ ctx, input }) => {
				await verifyProjectOwnership(input.projectId, ctx.effectiveOrgId);
				return listProjectIntegrations(input.projectId);
			}),

		upsert: protectedProcedure
			.input(
				z.object({
					projectId: z.string(),
					category: z.enum(['pm', 'scm', 'alerting']),
					provider: z.string().min(1),
					config: z.record(z.unknown()),
					triggers: z.record(z.boolean()).optional(),
				}),
			)
			.mutation(async ({ ctx, input }) => {
				await verifyProjectOwnership(input.projectId, ctx.effectiveOrgId);
				const config = normalizeIntegrationConfig(input);
				return upsertProjectIntegration(
					input.projectId,
					input.category,
					input.provider,
					config,
					input.triggers,
				);
			}),

		updateTriggers: protectedProcedure
			.input(
				z.object({
					projectId: z.string(),
					category: z.enum(['pm', 'scm', 'alerting']),
					triggers: z.record(z.union([z.boolean(), z.string().nullable(), z.record(z.boolean())])),
				}),
			)
			.mutation(async ({ ctx, input }) => {
				await verifyProjectOwnership(input.projectId, ctx.effectiveOrgId);
				await updateProjectIntegrationTriggers(input.projectId, input.category, input.triggers);
			}),

		delete: protectedProcedure
			.input(z.object({ projectId: z.string(), category: z.enum(['pm', 'scm', 'alerting']) }))
			.mutation(async ({ ctx, input }) => {
				await verifyProjectOwnership(input.projectId, ctx.effectiveOrgId);
				await deleteProjectIntegration(input.projectId, input.category);
			}),
	}),

	// Project-scoped credentials (project_credentials table)
	credentials: router({
		/**
		 * List masked metadata for all project-scoped credentials.
		 * Never returns plaintext values — only masked last-4-chars preview.
		 */
		list: protectedProcedure
			.input(z.object({ projectId: z.string() }))
			.query(async ({ ctx, input }) => {
				await verifyProjectOwnership(input.projectId, ctx.effectiveOrgId);
				try {
					const rows = await listProjectCredentials(input.projectId);
					return rows.map((row) => ({
						envVarKey: row.envVarKey,
						name: row.name,
						isConfigured: true,
						maskedValue: row.value.length <= 12 ? '****' : `****${row.value.slice(-4)}`,
					}));
				} catch (err) {
					// Decryption key missing/wrong — return metadata without value preview
					captureException(err, {
						tags: { source: 'credentials_list' },
						extra: { projectId: input.projectId },
						level: 'warning',
					});
					const meta = await listProjectCredentialsMeta(input.projectId);
					return meta.map((row) => ({
						envVarKey: row.envVarKey,
						name: row.name,
						isConfigured: true,
						maskedValue: '****',
					}));
				}
			}),

		/**
		 * Upsert a project-scoped credential (write-only — never exposes plaintext).
		 */
		set: protectedProcedure
			.input(
				z.object({
					projectId: z.string(),
					envVarKey: z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
					value: z.string().min(1),
					name: z.string().optional(),
				}),
			)
			.mutation(async ({ ctx, input }) => {
				await verifyProjectOwnership(input.projectId, ctx.effectiveOrgId);
				await writeProjectCredential(
					input.projectId,
					input.envVarKey,
					input.value,
					input.name ?? null,
				);
			}),

		/**
		 * Delete a project-scoped credential.
		 */
		delete: protectedProcedure
			.input(
				z.object({
					projectId: z.string(),
					envVarKey: z.string().min(1),
				}),
			)
			.mutation(async ({ ctx, input }) => {
				await verifyProjectOwnership(input.projectId, ctx.effectiveOrgId);
				await deleteProjectCredential(input.projectId, input.envVarKey);
			}),
	}),

	/**
	 * Returns available OpenRouter models for the model autocomplete combobox.
	 * Resolves the project's OPENROUTER_API_KEY credential (if any) and proxies
	 * the OpenRouter /api/v1/models endpoint with server-side 1-hour caching.
	 * Falls back to an empty array if the API is unreachable or no key is configured.
	 */
	openRouterModels: protectedProcedure
		.input(z.object({ projectId: z.string() }))
		.query(async ({ ctx, input }) => {
			await verifyProjectOwnership(input.projectId, ctx.effectiveOrgId);
			const apiKey = await getOrgCredential(input.projectId, 'OPENROUTER_API_KEY').catch(
				() => null,
			);
			return fetchOpenRouterModels(apiKey);
		}),
});
