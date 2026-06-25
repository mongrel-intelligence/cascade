import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { loadProjectConfigById } from '../../config/provider.js';
import { isAgentEnabledForProject } from '../../db/repositories/agentConfigsRepository.js';
import {
	cancelRunById,
	DEFAULT_STALE_RUN_THRESHOLD_MS,
	deleteDebugAnalysisByRunId,
	getDebugAnalysisByRunId,
	getDebugAnalysisRunState,
	getLlmCallByNumber,
	getRunById,
	getRunLogs,
	hasActiveRunForWorkItem,
	isDebugAnalysisRunActive,
	listLlmCallsMeta,
	listRuns,
	markDebugAnalysisRunning,
} from '../../db/repositories/runsRepository.js';
import { publishCancelCommand } from '../../queue/cancel.js';
import { parseLlmResponse } from '../../utils/llmResponseParser.js';
import { logger } from '../../utils/logging.js';
import { protectedProcedure, router, superAdminProcedure } from '../trpc.js';
import { verifyProjectOrgAccess } from './_shared/projectAccess.js';

/**
 * Whether dashboard jobs run through the durable BullMQ queue (production) or
 * are fired in-process (local dev without REDIS_URL).
 *
 * Read at call time — not memoised at module load — so the REDIS_URL gate
 * reflects the live environment and is observable in unit tests.
 */
function isQueueMode(): boolean {
	return !!process.env.REDIS_URL;
}

/**
 * Throw CONFLICT when a debug analysis is already in progress for `runId`.
 *
 * Reads the durable `debug_analysis_status` row (the worker-owned, cross-process
 * signal of the *analysis* lifecycle). This is authoritative in both queue mode
 * (analysis runs in a separate worker container) and local dev (in-process): the
 * dashboard BullMQ job reaches `completed` at container *spawn*, not at analysis
 * completion, so the queue cannot be used to detect a still-running analysis. A
 * stale `running` row (crashed worker) is ignored, so a crash never wedges the
 * re-trigger permanently.
 */
async function assertDebugAnalysisNotInFlight(runId: string): Promise<void> {
	const state = await getDebugAnalysisRunState(runId);
	if (isDebugAnalysisRunActive(state)) {
		throw new TRPCError({
			code: 'CONFLICT',
			message: 'Debug analysis is already running for this run',
		});
	}
}

export const runsRouter = router({
	list: protectedProcedure
		.input(
			z.object({
				projectId: z.string().optional(),
				status: z.array(z.string()).optional(),
				agentType: z.string().optional(),
				startedAfter: z.string().datetime().optional(),
				startedBefore: z.string().datetime().optional(),
				limit: z.number().min(1).max(100).default(50),
				offset: z.number().min(0).default(0),
				sort: z.enum(['startedAt', 'durationMs', 'costUsd']).default('startedAt'),
				order: z.enum(['asc', 'desc']).default('desc'),
			}),
		)
		.query(async ({ ctx, input }) => {
			return listRuns({
				orgId: ctx.effectiveOrgId,
				projectId: input.projectId,
				status: input.status,
				agentType: input.agentType,
				startedAfter: input.startedAfter ? new Date(input.startedAfter) : undefined,
				startedBefore: input.startedBefore ? new Date(input.startedBefore) : undefined,
				limit: input.limit,
				offset: input.offset,
				sort: input.sort,
				order: input.order,
			});
		}),

	listAll: superAdminProcedure
		.input(
			z.object({
				projectId: z.string().optional(),
				status: z.array(z.string()).optional(),
				agentType: z.string().optional(),
				startedAfter: z.string().datetime().optional(),
				startedBefore: z.string().datetime().optional(),
				limit: z.number().min(1).max(100).default(50),
				offset: z.number().min(0).default(0),
				sort: z.enum(['startedAt', 'durationMs', 'costUsd']).default('startedAt'),
				order: z.enum(['asc', 'desc']).default('desc'),
			}),
		)
		.query(async ({ input }) => {
			return listRuns({
				projectId: input.projectId,
				status: input.status,
				agentType: input.agentType,
				startedAfter: input.startedAfter ? new Date(input.startedAfter) : undefined,
				startedBefore: input.startedBefore ? new Date(input.startedBefore) : undefined,
				limit: input.limit,
				offset: input.offset,
				sort: input.sort,
				order: input.order,
			});
		}),

	getById: protectedProcedure
		.input(z.object({ id: z.string().uuid() }))
		.query(async ({ ctx, input }) => {
			const run = await getRunById(input.id);
			if (!run) throw new TRPCError({ code: 'NOT_FOUND' });

			// Verify org access
			if (run.projectId && ctx.user?.role !== 'superadmin') {
				if (!ctx.effectiveOrgId) throw new TRPCError({ code: 'UNAUTHORIZED' });
				await verifyProjectOrgAccess(run.projectId, ctx.effectiveOrgId);
			}

			return run;
		}),

	getLogs: protectedProcedure
		.input(z.object({ runId: z.string().uuid() }))
		.query(async ({ ctx, input }) => {
			const run = await getRunById(input.runId);
			if (!run) throw new TRPCError({ code: 'NOT_FOUND' });
			if (run.projectId && ctx.user?.role !== 'superadmin') {
				if (!ctx.effectiveOrgId) throw new TRPCError({ code: 'UNAUTHORIZED' });
				await verifyProjectOrgAccess(run.projectId, ctx.effectiveOrgId);
			}
			return getRunLogs(input.runId);
		}),

	listLlmCalls: protectedProcedure
		.input(z.object({ runId: z.string().uuid() }))
		.query(async ({ ctx, input }) => {
			const run = await getRunById(input.runId);
			if (!run) throw new TRPCError({ code: 'NOT_FOUND' });
			if (run.projectId && ctx.user?.role !== 'superadmin') {
				if (!ctx.effectiveOrgId) throw new TRPCError({ code: 'UNAUTHORIZED' });
				await verifyProjectOrgAccess(run.projectId, ctx.effectiveOrgId);
			}
			const raw = await listLlmCallsMeta(input.runId);
			const calls = raw.map((c) => {
				const { blocks, textPreview } = parseLlmResponse(c.response);
				const toolCalls = blocks
					.filter(
						(b): b is { kind: 'tool_use'; name: string; inputSummary: string } =>
							b.kind === 'tool_use',
					)
					.map((b) => ({ name: b.name, inputSummary: b.inputSummary }));
				const thinkingBlocks = blocks.filter(
					(b): b is { kind: 'thinking'; text: string } => b.kind === 'thinking',
				);
				const thinkingChars = thinkingBlocks.reduce((sum, b) => sum + b.text.length, 0);
				const thinkingPreview =
					thinkingChars > 0
						? thinkingBlocks
								.map((b) => b.text)
								.join(' ')
								.slice(0, 200)
						: null;
				return {
					id: c.id,
					runId: c.runId,
					callNumber: c.callNumber,
					inputTokens: c.inputTokens,
					outputTokens: c.outputTokens,
					cachedTokens: c.cachedTokens,
					costUsd: c.costUsd,
					durationMs: c.durationMs,
					model: c.model,
					createdAt: c.createdAt,
					toolCalls,
					textPreview,
					thinkingChars: thinkingChars > 0 ? thinkingChars : null,
					thinkingPreview,
				};
			});
			return { engine: run.engine ?? 'unknown', calls };
		}),

	getLlmCall: protectedProcedure
		.input(z.object({ runId: z.string().uuid(), callNumber: z.number() }))
		.query(async ({ ctx, input }) => {
			const run = await getRunById(input.runId);
			if (!run) throw new TRPCError({ code: 'NOT_FOUND' });
			if (run.projectId && ctx.user?.role !== 'superadmin') {
				if (!ctx.effectiveOrgId) throw new TRPCError({ code: 'UNAUTHORIZED' });
				await verifyProjectOrgAccess(run.projectId, ctx.effectiveOrgId);
			}
			const call = await getLlmCallByNumber(input.runId, input.callNumber);
			if (!call) throw new TRPCError({ code: 'NOT_FOUND' });
			return call;
		}),

	getDebugAnalysis: protectedProcedure
		.input(z.object({ runId: z.string().uuid() }))
		.query(async ({ ctx, input }) => {
			const run = await getRunById(input.runId);
			if (!run) throw new TRPCError({ code: 'NOT_FOUND' });
			if (run.projectId && ctx.user?.role !== 'superadmin') {
				if (!ctx.effectiveOrgId) throw new TRPCError({ code: 'UNAUTHORIZED' });
				await verifyProjectOrgAccess(run.projectId, ctx.effectiveOrgId);
			}
			const analysis = await getDebugAnalysisByRunId(input.runId);
			return analysis;
		}),

	getDebugAnalysisStatus: protectedProcedure
		.input(z.object({ runId: z.string().uuid() }))
		.query(async ({ ctx, input }) => {
			const run = await getRunById(input.runId);
			if (!run) throw new TRPCError({ code: 'NOT_FOUND' });
			if (run.projectId && ctx.user?.role !== 'superadmin') {
				if (!ctx.effectiveOrgId) throw new TRPCError({ code: 'UNAUTHORIZED' });
				await verifyProjectOrgAccess(run.projectId, ctx.effectiveOrgId);
			}
			// Status is derived from the durable `debug_analysis_status` row (the
			// worker-owned, cross-process signal of the *analysis* lifecycle) plus
			// the persisted `debug_analyses` content row. This is identical in queue
			// mode (analysis runs in a separate worker container) and local dev
			// (in-process): the dashboard BullMQ job reaches `completed` at container
			// *spawn*, not at analysis completion, so it cannot represent a
			// still-running analysis.
			//
			// Precedence:
			//   1. An active `running` row wins and short-circuits the content lookup.
			//   2. else a persisted analysis means a prior run completed.
			//   3. else a `failed` status row means the last attempt errored out.
			//   4. else idle. (A stale `running` row — crashed worker — falls through
			//      here so a crash never wedges the run as permanently `running`.)
			const state = await getDebugAnalysisRunState(input.runId);
			if (isDebugAnalysisRunActive(state)) {
				return { status: 'running' as const };
			}
			const analysis = await getDebugAnalysisByRunId(input.runId);
			if (analysis) {
				return { status: 'completed' as const };
			}
			if (state?.status === 'failed') {
				return { status: 'failed' as const };
			}
			return { status: 'idle' as const };
		}),

	triggerDebugAnalysis: protectedProcedure
		.input(z.object({ runId: z.string().uuid() }))
		.mutation(async ({ ctx, input }) => {
			const run = await getRunById(input.runId);
			if (!run) throw new TRPCError({ code: 'NOT_FOUND' });

			// Verify org access
			if (run.projectId && ctx.user?.role !== 'superadmin') {
				if (!ctx.effectiveOrgId) throw new TRPCError({ code: 'UNAUTHORIZED' });
				await verifyProjectOrgAccess(run.projectId, ctx.effectiveOrgId);
			}

			if (run.agentType === 'debug') {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'Cannot run debug analysis on a debug run',
				});
			}

			// Already-running guard — reads the durable `debug_analysis_status` row
			// uniformly in queue mode and local dev (see assertDebugAnalysisNotInFlight).
			await assertDebugAnalysisNotInFlight(input.runId);

			if (!run.projectId) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'Run has no associated project',
				});
			}

			const pc = await loadProjectConfigById(run.projectId);
			if (!pc) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'Project not found for this run',
				});
			}

			// Delete the prior analysis content row before re-running. Any leftover
			// terminal status row (e.g. `failed`) is not removed here — it is
			// overwritten by the `markDebugAnalysisRunning` upsert below.
			await deleteDebugAnalysisByRunId(input.runId);

			if (isQueueMode()) {
				const { debugAnalysisJobId, removeDashboardJob, submitDashboardJob } = await import(
					'../../queue/client.js'
				);
				// Reuse the deterministic id so a re-run replaces (rather than races)
				// any prior job, and so a near-simultaneous second trigger that slips
				// past the guard cannot spawn a duplicate container. Clear any prior
				// terminal job first so the re-enqueue isn't rejected for a duplicate id.
				const jobId = debugAnalysisJobId(input.runId);
				await removeDashboardJob(jobId);
				await submitDashboardJob(
					{
						type: 'debug-analysis',
						runId: input.runId,
						projectId: run.projectId,
						workItemId: run.workItemId ?? undefined,
					},
					jobId,
				);
				// Mark running only after the job is durably enqueued: a failed enqueue
				// then leaves no `running` row to block (and self-stale) a retry. The
				// worker re-marks running (idempotent) when it starts the analysis;
				// this write covers the enqueue→container-spawn window so status reads
				// `running` immediately and a second trigger gets CONFLICT.
				await markDebugAnalysisRunning(input.runId);
			} else {
				// Local dev: mark running before firing so the guard is effective, then
				// run in-process (the runner re-marks running and clears/fails at end).
				await markDebugAnalysisRunning(input.runId);
				const { triggerDebugAnalysis } = await import('../../triggers/shared/debug-runner.js');
				triggerDebugAnalysis(input.runId, pc.project, pc.config, run.workItemId ?? undefined).catch(
					(err) => {
						logger.error('Manual debug analysis failed', {
							runId: input.runId,
							error: String(err),
						});
					},
				);
			}

			return { triggered: true };
		}),

	trigger: protectedProcedure
		.input(
			z.object({
				projectId: z.string(),
				agentType: z.string(),
				workItemId: z.string().optional(),
				workItemUrl: z.string().optional(),
				workItemTitle: z.string().optional(),
				prNumber: z.number().optional(),
				prBranch: z.string().optional(),
				repoFullName: z.string().optional(),
				headSha: z.string().optional(),
				model: z.string().optional(),
				triggerCommentBody: z.string().optional(),
				triggerCommentId: z.number().optional(),
				triggerCommentUrl: z.string().optional(),
				triggerCommentPath: z.string().optional(),
				triggerCommentAuthor: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			// Verify org ownership of project
			if (ctx.user?.role !== 'superadmin') {
				if (!ctx.effectiveOrgId) throw new TRPCError({ code: 'UNAUTHORIZED' });
				await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
			}

			// Block if a worker is already active on this work item
			if (input.workItemId && input.agentType !== 'debug') {
				const active = await hasActiveRunForWorkItem(
					input.projectId,
					input.workItemId,
					DEFAULT_STALE_RUN_THRESHOLD_MS,
				);
				if (active) {
					throw new TRPCError({
						code: 'CONFLICT',
						message: 'A worker is already active on this work item',
					});
				}
			}

			const pc = await loadProjectConfigById(input.projectId);
			if (!pc) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'Project configuration not found',
				});
			}

			// Check agent is explicitly enabled for this project
			const agentEnabled = await isAgentEnabledForProject(input.projectId, input.agentType);
			if (!agentEnabled) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: `Agent '${input.agentType}' is not enabled for this project. Add an agent config in Project Settings > Agent Configs to enable it.`,
				});
			}

			if (isQueueMode()) {
				const { submitDashboardJob } = await import('../../queue/client.js');
				await submitDashboardJob({
					type: 'manual-run',
					projectId: input.projectId,
					agentType: input.agentType,
					workItemId: input.workItemId,
					workItemUrl: input.workItemUrl,
					workItemTitle: input.workItemTitle,
					prNumber: input.prNumber,
					prBranch: input.prBranch,
					repoFullName: input.repoFullName,
					headSha: input.headSha,
					modelOverride: input.model,
					triggerCommentBody: input.triggerCommentBody,
					triggerCommentId: input.triggerCommentId,
					triggerCommentUrl: input.triggerCommentUrl,
					triggerCommentPath: input.triggerCommentPath,
					triggerCommentAuthor: input.triggerCommentAuthor,
				});
			} else {
				const { triggerManualRun } = await import('../../triggers/shared/manual-runner.js');
				triggerManualRun(
					{
						projectId: input.projectId,
						agentType: input.agentType,
						workItemId: input.workItemId,
						workItemUrl: input.workItemUrl,
						workItemTitle: input.workItemTitle,
						prNumber: input.prNumber,
						prBranch: input.prBranch,
						repoFullName: input.repoFullName,
						headSha: input.headSha,
						modelOverride: input.model,
						triggerCommentBody: input.triggerCommentBody,
						triggerCommentId: input.triggerCommentId,
						triggerCommentUrl: input.triggerCommentUrl,
						triggerCommentPath: input.triggerCommentPath,
						triggerCommentAuthor: input.triggerCommentAuthor,
					},
					pc.project,
					pc.config,
				).catch((err) => {
					logger.error('Manual trigger failed', {
						projectId: input.projectId,
						agentType: input.agentType,
						error: String(err),
					});
				});
			}

			return { triggered: true };
		}),

	retry: protectedProcedure
		.input(
			z.object({
				runId: z.string().uuid(),
				model: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const run = await getRunById(input.runId);
			if (!run) throw new TRPCError({ code: 'NOT_FOUND' });

			// Verify org access
			if (run.projectId && ctx.user?.role !== 'superadmin') {
				if (!ctx.effectiveOrgId) throw new TRPCError({ code: 'UNAUTHORIZED' });
				await verifyProjectOrgAccess(run.projectId, ctx.effectiveOrgId);
			}

			if (!run.projectId) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'Run has no associated project',
				});
			}

			// Block if a worker is already active on this work item
			if (run.workItemId && run.agentType !== 'debug') {
				const active = await hasActiveRunForWorkItem(
					run.projectId,
					run.workItemId,
					DEFAULT_STALE_RUN_THRESHOLD_MS,
				);
				if (active) {
					throw new TRPCError({
						code: 'CONFLICT',
						message: 'A worker is already active on this work item',
					});
				}
			}

			const pc = await loadProjectConfigById(run.projectId);
			if (!pc) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'Project configuration not found',
				});
			}

			if (isQueueMode()) {
				const { submitDashboardJob } = await import('../../queue/client.js');
				await submitDashboardJob({
					type: 'retry-run',
					runId: input.runId,
					projectId: run.projectId,
					modelOverride: input.model,
				});
			} else {
				const { triggerRetryRun } = await import('../../triggers/shared/manual-runner.js');
				triggerRetryRun(input.runId, pc.project, pc.config, input.model).catch((err) => {
					logger.error('Retry run failed', {
						runId: input.runId,
						error: String(err),
					});
				});
			}

			return { triggered: true };
		}),

	cancel: protectedProcedure
		.input(
			z.object({
				runId: z.string().uuid(),
				reason: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const run = await getRunById(input.runId);
			if (!run) throw new TRPCError({ code: 'NOT_FOUND' });

			if (run.projectId && ctx.user?.role !== 'superadmin') {
				if (!ctx.effectiveOrgId) throw new TRPCError({ code: 'UNAUTHORIZED' });
				await verifyProjectOrgAccess(run.projectId, ctx.effectiveOrgId);
			}

			if (run.status !== 'running') {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: `Run is not running (status: ${run.status})`,
				});
			}

			const reason = input.reason ?? 'Manually cancelled via API';
			const updated = await cancelRunById(input.runId, reason);
			if (!updated) {
				throw new TRPCError({
					code: 'CONFLICT',
					message: 'Run was already completed by the time cancel was processed',
				});
			}

			// Publish cancel command to Router (fire-and-forget)
			publishCancelCommand(input.runId, reason).catch((err) => {
				logger.error('[runs.cancel] Failed to publish cancel command:', {
					runId: input.runId,
					reason,
					error: String(err),
				});
			});

			return { cancelled: true };
		}),
});
