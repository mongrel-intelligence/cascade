import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
	getWebhookLogById,
	getWebhookLogStats,
	listWebhookLogs,
} from '../../db/repositories/webhookLogsRepository.js';
import { protectedProcedure, router } from '../trpc.js';

export const webhookLogsRouter = router({
	list: protectedProcedure
		.input(
			z.object({
				source: z.string().optional(),
				eventType: z.string().optional(),
				receivedAfter: z.string().datetime().optional(),
				receivedBefore: z.string().datetime().optional(),
				limit: z.number().min(1).max(100).default(50),
				offset: z.number().min(0).default(0),
			}),
		)
		.query(async ({ input }) => {
			return listWebhookLogs({
				source: input.source,
				eventType: input.eventType,
				receivedAfter: input.receivedAfter ? new Date(input.receivedAfter) : undefined,
				receivedBefore: input.receivedBefore ? new Date(input.receivedBefore) : undefined,
				limit: input.limit,
				offset: input.offset,
			});
		}),

	getById: protectedProcedure
		.input(z.object({ id: z.string().uuid() }))
		.query(async ({ input }) => {
			const log = await getWebhookLogById(input.id);
			if (!log) throw new TRPCError({ code: 'NOT_FOUND' });
			return log;
		}),

	getStats: protectedProcedure.query(async () => {
		return getWebhookLogStats();
	}),
});
