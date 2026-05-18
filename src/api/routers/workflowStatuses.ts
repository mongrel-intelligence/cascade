import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { resolveAgentDefinition } from '../../agents/definitions/loader.js';
import {
	createCustomWorkflowStatusDefinition,
	deleteCustomWorkflowStatusDefinition,
	getCustomWorkflowStatusDefinition,
	updateCustomWorkflowStatusDefinition,
} from '../../db/repositories/workflowStatusDefinitionsRepository.js';
import {
	BUILTIN_WORKFLOW_STATUS_KEYS,
	listWorkflowStatusDefinitions,
} from '../../workflow/statusDefinitions.js';
import { protectedProcedure, router, superAdminProcedure } from '../trpc.js';

const STATUS_CHANGED_TRIGGER_EVENT = 'pm:status-changed';

const StatusKeySchema = z
	.string()
	.trim()
	.regex(/^[a-z][a-z0-9-]*$/, 'Status key must be a lowercase slug');

const AgentTypeSchema = z
	.preprocess((value) => (value === '' ? null : value), z.string().trim().min(1).nullable())
	.optional();

async function assertCustomStatusKeyAvailable(key: string) {
	if (BUILTIN_WORKFLOW_STATUS_KEYS.has(key)) {
		throw new TRPCError({
			code: 'CONFLICT',
			message: `Cannot override builtin workflow status: ${key}`,
		});
	}

	const existing = await getCustomWorkflowStatusDefinition(key);
	if (existing) {
		throw new TRPCError({
			code: 'CONFLICT',
			message: `Workflow status already exists: ${key}`,
		});
	}
}

function assertCustomStatusKey(key: string) {
	if (BUILTIN_WORKFLOW_STATUS_KEYS.has(key)) {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: `Builtin workflow status cannot be modified: ${key}`,
		});
	}
}

async function validateAgentType(agentType: string | null | undefined) {
	if (!agentType) return;
	let definition: Awaited<ReturnType<typeof resolveAgentDefinition>>;
	try {
		definition = await resolveAgentDefinition(agentType);
	} catch {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: `Unknown agent type: ${agentType}`,
		});
	}
	if (!definition.triggers.some((trigger) => trigger.event === STATUS_CHANGED_TRIGGER_EVENT)) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: `Agent type does not support ${STATUS_CHANGED_TRIGGER_EVENT}: ${agentType}`,
		});
	}
}

export const workflowStatusesRouter = router({
	list: protectedProcedure.query(async () => {
		return listWorkflowStatusDefinitions();
	}),

	create: superAdminProcedure
		.input(
			z.object({
				key: StatusKeySchema,
				label: z.string().trim().min(1),
				agentType: AgentTypeSchema,
				sortOrder: z.number().int().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			await assertCustomStatusKeyAvailable(input.key);
			await validateAgentType(input.agentType);
			return createCustomWorkflowStatusDefinition(input);
		}),

	update: superAdminProcedure
		.input(
			z.object({
				key: StatusKeySchema,
				label: z.string().trim().min(1).optional(),
				agentType: AgentTypeSchema,
				sortOrder: z.number().int().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			assertCustomStatusKey(input.key);
			await validateAgentType(input.agentType);
			const updated = await updateCustomWorkflowStatusDefinition(input.key, {
				...(input.label !== undefined ? { label: input.label } : {}),
				...(input.agentType !== undefined ? { agentType: input.agentType } : {}),
				...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
			});
			if (!updated) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: `Workflow status not found: ${input.key}`,
				});
			}
			return updated;
		}),

	delete: superAdminProcedure
		.input(z.object({ key: StatusKeySchema }))
		.mutation(async ({ input }) => {
			assertCustomStatusKey(input.key);
			const deleted = await deleteCustomWorkflowStatusDefinition(input.key);
			if (!deleted) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: `Workflow status not found: ${input.key}`,
				});
			}
			return { key: input.key };
		}),
});
