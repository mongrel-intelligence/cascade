import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { loadProjectConfigById } from '../../config/provider.js';
import { isAgentEnabledForProject } from '../../db/repositories/agentConfigsRepository.js';
import {
	DEFAULT_STALE_RUN_THRESHOLD_MS,
	cancelRunById,
	deleteDebugAnalysisByRunId,
	getDebugAnalysisByRunId,
	getLlmCallByNumber,
	getRunById,
	getRunLogs,
	hasActiveRunForWorkItem,
	listLlmCallsMeta,
	listRuns,
} from '../../db/repositories/runsRepository.js';
import { publishCancelCommand } from '../../queue/cancel.js';
import { isAnalysisRunning } from '../../triggers/shared/debug-status.js';
import { parseLlmResponse } from '../../utils/llmResponseParser.js';
import { logger } from '../../utils/logging.js';
import { protectedProcedure, router, superAdminProcedure } from '../trpc.js';
import { verifyProjectOrgAccess } from './_shared/projectAccess.js';

const useQueue = !!process.env.REDIS_URL;

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
			if (isAnalysisRunning(input.runId)) {
				return { status: 'running' as const };
			}
			const analysis = await getDebugAnalysisByRunId(input.runId);
			if (analysis) {
				return { status: 'completed' as const };
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

			if (isAnalysisRunning(input.runId)) {
				throw new TRPCError({
					code: 'CONFLICT',
					message: 'Debug analysis is already running for this run',
				});
			}

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

			// Delete existing analysis before re-running
			await deleteDebugAnalysisByRunId(input.runId);

			if (useQueue) {
				const { submitDashboardJob } = await import('../../queue/client.js');
				await submitDashboardJob({
					type: 'debug-analysis',
					runId: input.runId,
					projectId: run.projectId,
					workItemId: run.workItemId ?? undefined,
				});
			} else {
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
				prNumber: z.number().optional(),
				prBranch: z.string().optional(),
				repoFullName: z.string().optional(),
				headSha: z.string().optional(),
				model: z.string().optional(),
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

			if (useQueue) {
				const { submitDashboardJob } = await import('../../queue/client.js');
				await submitDashboardJob({
					type: 'manual-run',
					projectId: input.projectId,
					agentType: input.agentType,
					workItemId: input.workItemId,
					prNumber: input.prNumber,
					prBranch: input.prBranch,
					repoFullName: input.repoFullName,
					headSha: input.headSha,
					modelOverride: input.model,
				});
			} else {
				const { triggerManualRun } = await import('../../triggers/shared/manual-runner.js');
				triggerManualRun(
					{
						projectId: input.projectId,
						agentType: input.agentType,
						workItemId: input.workItemId,
						prNumber: input.prNumber,
						prBranch: input.prBranch,
						repoFullName: input.repoFullName,
						headSha: input.headSha,
						modelOverride: input.model,
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

			if (useQueue) {
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
