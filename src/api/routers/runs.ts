import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { findProjectById, loadConfig } from '../../config/provider.js';
import { getDb } from '../../db/client.js';
import {
	deleteDebugAnalysisByRunId,
	getDebugAnalysisByRunId,
	getLlmCallByNumber,
	getRunById,
	getRunLogs,
	listLlmCallsMeta,
	listRuns,
} from '../../db/repositories/runsRepository.js';
import { projects } from '../../db/schema/index.js';
import { triggerDebugAnalysis } from '../../triggers/shared/debug-runner.js';
import { isAnalysisRunning } from '../../triggers/shared/debug-status.js';
import { logger } from '../../utils/logging.js';
import { protectedProcedure, router } from '../trpc.js';

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
				orgId: ctx.user.orgId,
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
			if (run.projectId) {
				const db = getDb();
				const [project] = await db
					.select({ orgId: projects.orgId })
					.from(projects)
					.where(eq(projects.id, run.projectId));
				if (!project || project.orgId !== ctx.user.orgId) {
					throw new TRPCError({ code: 'NOT_FOUND' });
				}
			}

			return run;
		}),

	getLogs: protectedProcedure
		.input(z.object({ runId: z.string().uuid() }))
		.query(async ({ input }) => {
			const logs = await getRunLogs(input.runId);
			return logs;
		}),

	listLlmCalls: protectedProcedure
		.input(z.object({ runId: z.string().uuid() }))
		.query(async ({ input }) => {
			return listLlmCallsMeta(input.runId);
		}),

	getLlmCall: protectedProcedure
		.input(z.object({ runId: z.string().uuid(), callNumber: z.number() }))
		.query(async ({ input }) => {
			const call = await getLlmCallByNumber(input.runId, input.callNumber);
			if (!call) throw new TRPCError({ code: 'NOT_FOUND' });
			return call;
		}),

	getDebugAnalysis: protectedProcedure
		.input(z.object({ runId: z.string().uuid() }))
		.query(async ({ input }) => {
			const analysis = await getDebugAnalysisByRunId(input.runId);
			return analysis;
		}),

	getDebugAnalysisStatus: protectedProcedure
		.input(z.object({ runId: z.string().uuid() }))
		.query(async ({ input }) => {
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
			if (run.projectId) {
				const db = getDb();
				const [project] = await db
					.select({ orgId: projects.orgId })
					.from(projects)
					.where(eq(projects.id, run.projectId));
				if (!project || project.orgId !== ctx.user.orgId) {
					throw new TRPCError({ code: 'NOT_FOUND' });
				}
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

			const project = await findProjectById(run.projectId);
			if (!project) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'Project not found for this run',
				});
			}

			const config = await loadConfig();

			// Delete existing analysis before re-running
			await deleteDebugAnalysisByRunId(input.runId);

			// Fire-and-forget
			triggerDebugAnalysis(input.runId, project, config, run.cardId ?? undefined).catch((err) => {
				logger.error('Manual debug analysis failed', {
					runId: input.runId,
					error: String(err),
				});
			});

			return { triggered: true };
		}),
});
