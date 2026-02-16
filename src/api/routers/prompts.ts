import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
	getAvailablePartialNames,
	getRawPartial,
	getRawTemplate,
	getTemplateVariables,
	getValidAgentTypes,
	validateTemplate,
} from '../../agents/prompts/index.js';
import {
	deletePartial,
	getPartial,
	listPartials,
	loadPartials,
	upsertPartial,
} from '../../db/repositories/partialsRepository.js';
import { protectedProcedure, router } from '../trpc.js';

export const promptsRouter = router({
	// ========================================================================
	// Template introspection (read-only)
	// ========================================================================

	agentTypes: protectedProcedure.query(() => {
		return getValidAgentTypes();
	}),

	getDefault: protectedProcedure
		.input(z.object({ agentType: z.string().min(1) }))
		.query(({ input }) => {
			try {
				return { content: getRawTemplate(input.agentType) };
			} catch {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: `Unknown agent type: ${input.agentType}`,
				});
			}
		}),

	variables: protectedProcedure.query(() => {
		return getTemplateVariables();
	}),

	validate: protectedProcedure
		.input(z.object({ template: z.string() }))
		.mutation(async ({ input }) => {
			const dbPartials = await loadPartials();
			return validateTemplate(input.template, dbPartials);
		}),

	// ========================================================================
	// Partial CRUD
	// ========================================================================

	listPartials: protectedProcedure.query(async () => {
		const dbRows = await listPartials();
		const diskNames = getAvailablePartialNames();

		// Merge: DB content takes priority, disk names fill gaps
		const dbByName = new Map(dbRows.map((r) => [r.name, r]));
		const result: Array<{
			name: string;
			source: 'db' | 'disk';
			lines: number;
			id?: number;
		}> = [];

		// Add all disk partials with DB override info
		for (const name of diskNames) {
			const dbRow = dbByName.get(name);
			if (dbRow) {
				result.push({
					name,
					source: 'db',
					lines: dbRow.content.split('\n').length,
					id: dbRow.id,
				});
				dbByName.delete(name);
			} else {
				try {
					const content = getRawPartial(name);
					result.push({
						name,
						source: 'disk',
						lines: content.split('\n').length,
					});
				} catch {
					result.push({ name, source: 'disk', lines: 0 });
				}
			}
		}

		// Add DB-only partials (custom ones not on disk)
		for (const [name, row] of dbByName) {
			result.push({
				name,
				source: 'db',
				lines: row.content.split('\n').length,
				id: row.id,
			});
		}

		return result.sort((a, b) => a.name.localeCompare(b.name));
	}),

	getPartial: protectedProcedure
		.input(z.object({ name: z.string().min(1) }))
		.query(async ({ input }) => {
			// Check DB first
			const dbRow = await getPartial(input.name);
			if (dbRow) {
				return { name: input.name, content: dbRow.content, source: 'db' as const, id: dbRow.id };
			}
			// Fall back to disk
			try {
				const content = getRawPartial(input.name);
				return { name: input.name, content, source: 'disk' as const };
			} catch {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: `Partial not found: ${input.name}`,
				});
			}
		}),

	getDefaultPartial: protectedProcedure
		.input(z.object({ name: z.string().min(1) }))
		.query(({ input }) => {
			try {
				return { content: getRawPartial(input.name) };
			} catch {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: `No disk partial: ${input.name}`,
				});
			}
		}),

	upsertPartial: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1),
				content: z.string().min(1),
			}),
		)
		.mutation(async ({ input }) => {
			// Validate content doesn't break templates
			const dbPartials = await loadPartials();
			dbPartials.set(input.name, input.content);
			// Simple check: content itself shouldn't have broken Eta syntax
			const testResult = validateTemplate(`Test: ${input.content}`, dbPartials);
			if (!testResult.valid) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: `Invalid partial content: ${testResult.error}`,
				});
			}

			return upsertPartial({ name: input.name, content: input.content });
		}),

	deletePartial: protectedProcedure
		.input(z.object({ id: z.number() }))
		.mutation(async ({ input }) => {
			await deletePartial(input.id);
		}),
});
