import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
	deleteMcpServer,
	getMcpServer,
	listMcpServers,
	toggleMcpServer,
	upsertMcpServer,
} from '../../db/repositories/mcpServersRepository.js';
import { protectedProcedure, router } from '../trpc.js';
import { verifyProjectOrgAccess } from './_shared/projectAccess.js';

// ============================================================================
// Input Schemas
// ============================================================================

const McpStdioConfigSchema = z.object({
	type: z.literal('stdio'),
	command: z.string().min(1),
	args: z.array(z.string()).optional(),
	env: z.record(z.string()).optional(),
});

const McpSSEConfigSchema = z.object({
	type: z.literal('sse'),
	url: z.string().url(),
	headers: z.record(z.string()).optional(),
});

const McpHttpConfigSchema = z.object({
	type: z.literal('http'),
	url: z.string().url(),
	headers: z.record(z.string()).optional(),
});

const McpServerConfigSchema = z.discriminatedUnion('type', [
	McpStdioConfigSchema,
	McpSSEConfigSchema,
	McpHttpConfigSchema,
]);

// ============================================================================
// Router
// ============================================================================

export const mcpServersRouter = router({
	/** List all MCP servers for a project. */
	list: protectedProcedure
		.input(z.object({ projectId: z.string() }))
		.query(async ({ ctx, input }) => {
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
			return listMcpServers(input.projectId);
		}),

	/** Create or update an MCP server (upsert by projectId + name). */
	upsert: protectedProcedure
		.input(
			z.object({
				id: z.string().optional(),
				projectId: z.string(),
				name: z.string().min(1, 'Server name must not be empty'),
				config: McpServerConfigSchema,
				agentTypes: z.array(z.string()).nullish(),
				enabled: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
			return upsertMcpServer({
				id: input.id,
				projectId: input.projectId,
				name: input.name,
				config: input.config,
				agentTypes: input.agentTypes ?? null,
				enabled: input.enabled,
			});
		}),

	/** Delete an MCP server by ID. */
	delete: protectedProcedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const server = await getMcpServer(input.id);
			if (!server) {
				throw new TRPCError({ code: 'NOT_FOUND' });
			}
			await verifyProjectOrgAccess(server.projectId, ctx.effectiveOrgId);
			await deleteMcpServer(input.id);
		}),

	/** Toggle the enabled state of an MCP server. */
	toggle: protectedProcedure
		.input(z.object({ id: z.string(), enabled: z.boolean() }))
		.mutation(async ({ ctx, input }) => {
			const server = await getMcpServer(input.id);
			if (!server) {
				throw new TRPCError({ code: 'NOT_FOUND' });
			}
			await verifyProjectOrgAccess(server.projectId, ctx.effectiveOrgId);
			const updated = await toggleMcpServer(input.id, input.enabled);
			if (!updated) {
				throw new TRPCError({ code: 'NOT_FOUND' });
			}
			return updated;
		}),
});
