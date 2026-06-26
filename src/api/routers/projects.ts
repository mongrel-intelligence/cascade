import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { CLAUDE_CODE_SETTING_DEFAULTS } from '../../backends/claude-code/settings.js';
import { CODEX_SETTING_DEFAULTS } from '../../backends/codex/settings.js';
import { OPENCODE_SETTING_DEFAULTS } from '../../backends/opencode/settings.js';
import { EngineSettingsSchema } from '../../config/engineSettings.js';
import { getOrgCredential } from '../../config/provider.js';
import { PROJECT_DEFAULTS } from '../../config/schema.js';
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
import { enqueueWorkerImageValidationJob } from '../../queue/client.js';
import { routerConfig } from '../../router/config.js';
import { captureException } from '../../sentry.js';
import { logger } from '../../utils/logging.js';
import { protectedProcedure, publicProcedure, router, superAdminProcedure } from '../trpc.js';

async function verifyProjectOwnership(
	projectId: string,
	orgId: string,
): Promise<{ orgId: string; workerImage: string | null }> {
	const db = getDb();
	const [project] = await db
		.select({ orgId: projects.orgId, workerImage: projects.workerImage })
		.from(projects)
		.where(eq(projects.id, projectId));
	if (!project || project.orgId !== orgId) {
		throw new TRPCError({ code: 'NOT_FOUND' });
	}
	return { orgId: project.orgId, workerImage: project.workerImage ?? null };
}

/**
 * Worker-image column writes computed from a set/clear request (spec 022). The
 * digest is always cleared here — it is re-pinned only by the router-side
 * validator on success. Status is `pending` on set (awaiting validation) and
 * `null` on clear (revert to the global default).
 */
interface WorkerImageColumns {
	workerImage: string | null;
	workerImageStatus: 'pending' | null;
	workerImageDigest: null;
	workerImageError: null;
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
 *   - clear (`null`)         → all four columns null, no enqueue
 *   - set (`string`)         → grammar-checked; `pending` + enqueue, or `BAD_REQUEST`
 */
function processWorkerImageChange(opts: {
	touched: boolean;
	value: string | null;
	actorRole: 'member' | 'admin' | 'superadmin';
}): { columns: WorkerImageColumns; enqueueRef: string | null } | null {
	if (!opts.touched) return null;

	if (opts.actorRole !== 'superadmin') {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: 'Superadmin access required to change the worker image',
		});
	}

	if (opts.value === null) {
		return {
			columns: {
				workerImage: null,
				workerImageStatus: null,
				workerImageDigest: null,
				workerImageError: null,
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
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const workerImageChange = processWorkerImageChange({
				touched: input.workerImage !== undefined,
				value: input.workerImage ?? null,
				actorRole: ctx.user.role,
			});
			const { workerImage: _workerImage, ...rest } = input;

			const created = await createProject(ctx.effectiveOrgId, {
				...rest,
				...(input.agentEngine !== undefined ? { agentEngine: input.agentEngine } : {}),
				...(input.engineSettings !== undefined ? { engineSettings: input.engineSettings } : {}),
				...(workerImageChange ? workerImageChange.columns : {}),
			});

			if (workerImageChange) {
				await finalizeWorkerImageChange({
					change: workerImageChange,
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
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const owned = await verifyProjectOwnership(input.id, ctx.effectiveOrgId);

			// Validate + authorize the worker-image change BEFORE persisting so a
			// FORBIDDEN/BAD_REQUEST leaves the project untouched.
			const workerImageChange = processWorkerImageChange({
				touched: input.workerImage !== undefined,
				value: input.workerImage ?? null,
				actorRole: ctx.user.role,
			});

			const { id, workerImage: _workerImage, ...updates } = input;
			await updateProject(id, ctx.effectiveOrgId, {
				...updates,
				...(input.agentEngine !== undefined ? { agentEngine: input.agentEngine } : {}),
				...(input.engineSettings !== undefined ? { engineSettings: input.engineSettings } : {}),
				...(workerImageChange ? workerImageChange.columns : {}),
			});

			if (workerImageChange) {
				await finalizeWorkerImageChange({
					change: workerImageChange,
					actorId: ctx.user.id,
					projectId: id,
					from: owned.workerImage,
				});
			}
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
