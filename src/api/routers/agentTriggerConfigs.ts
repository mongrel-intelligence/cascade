import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { getKnownAgentTypes, loadAgentDefinition } from '../../agents/definitions/loader.js';
import type {
	AgentDefinition,
	SupportedTrigger,
	TriggerParameter,
} from '../../agents/definitions/schema.js';
import { listAgentDefinitions } from '../../db/repositories/agentDefinitionsRepository.js';
import {
	deleteTriggerConfig,
	getTriggerConfig,
	getTriggerConfigById,
	getTriggerConfigsByProject,
	getTriggerConfigsByProjectAndAgent,
	updateTriggerConfig,
	upsertTriggerConfig,
} from '../../db/repositories/agentTriggerConfigsRepository.js';
import { listProjectIntegrations } from '../../db/repositories/settingsRepository.js';
import { logger } from '../../utils/logging.js';
import { protectedProcedure, router } from '../trpc.js';
import { verifyProjectOrgAccess } from './_shared/projectAccess.js';
import type {
	ProjectTriggersView,
	ResolvedTrigger,
	TriggerParameterDef,
	TriggerParameterValue,
} from './_shared/triggerTypes.js';

// ============================================================================
// Input Schemas
// ============================================================================

/**
 * Trigger event format: {category}:{event-name}
 * Categories: pm, scm, email, sms
 * Event name: lowercase letters, numbers, and hyphens
 */
const TriggerEventSchema = z
	.string()
	.regex(
		/^(pm|scm|email|sms):[a-z][a-z0-9-]*$/,
		'Event must be in format {category}:{event-name} (e.g., pm:card-moved, scm:check-suite-success)',
	);

/**
 * Trigger parameters: flat key-value map with primitive values only.
 * Nested objects are not supported.
 */
const TriggerParametersSchema = z.record(z.union([z.string(), z.boolean(), z.number()])).optional();

// ============================================================================
// Router
// ============================================================================

export const agentTriggerConfigsRouter = router({
	/**
	 * List all trigger configs for a project.
	 */
	listByProject: protectedProcedure
		.input(z.object({ projectId: z.string() }))
		.query(async ({ ctx, input }) => {
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
			return getTriggerConfigsByProject(input.projectId);
		}),

	/**
	 * List trigger configs for a specific agent in a project.
	 */
	listByProjectAndAgent: protectedProcedure
		.input(z.object({ projectId: z.string(), agentType: z.string() }))
		.query(async ({ ctx, input }) => {
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
			return getTriggerConfigsByProjectAndAgent(input.projectId, input.agentType);
		}),

	/**
	 * Get a specific trigger config.
	 */
	get: protectedProcedure
		.input(
			z.object({
				projectId: z.string(),
				agentType: z.string(),
				triggerEvent: TriggerEventSchema,
			}),
		)
		.query(async ({ ctx, input }) => {
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
			return getTriggerConfig(input.projectId, input.agentType, input.triggerEvent);
		}),

	/**
	 * Create or update a trigger config.
	 */
	upsert: protectedProcedure
		.input(
			z.object({
				projectId: z.string(),
				agentType: z.string(),
				triggerEvent: TriggerEventSchema,
				enabled: z.boolean().optional(),
				parameters: TriggerParametersSchema,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
			return upsertTriggerConfig({
				projectId: input.projectId,
				agentType: input.agentType,
				triggerEvent: input.triggerEvent,
				enabled: input.enabled,
				parameters: input.parameters,
			});
		}),

	/**
	 * Update an existing trigger config by ID.
	 */
	update: protectedProcedure
		.input(
			z.object({
				id: z.number(),
				enabled: z.boolean().optional(),
				parameters: TriggerParametersSchema,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			// Verify ownership
			const config = await getTriggerConfigById(input.id);
			if (!config) {
				throw new TRPCError({ code: 'NOT_FOUND' });
			}
			await verifyProjectOrgAccess(config.projectId, ctx.effectiveOrgId);

			const result = await updateTriggerConfig(input.id, {
				enabled: input.enabled,
				parameters: input.parameters,
			});
			if (!result) {
				throw new TRPCError({ code: 'NOT_FOUND' });
			}
			return result;
		}),

	/**
	 * Delete a trigger config by ID.
	 */
	delete: protectedProcedure
		.input(z.object({ id: z.number() }))
		.mutation(async ({ ctx, input }) => {
			// Verify ownership
			const config = await getTriggerConfigById(input.id);
			if (!config) {
				throw new TRPCError({ code: 'NOT_FOUND' });
			}
			await verifyProjectOrgAccess(config.projectId, ctx.effectiveOrgId);

			await deleteTriggerConfig(input.id);
		}),

	/**
	 * Bulk update trigger configs for a project.
	 * This is optimized for the dashboard where we update multiple triggers at once.
	 */
	bulkUpsert: protectedProcedure
		.input(
			z.object({
				projectId: z.string(),
				configs: z.array(
					z.object({
						agentType: z.string(),
						triggerEvent: TriggerEventSchema,
						enabled: z.boolean().optional(),
						parameters: TriggerParametersSchema,
					}),
				),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);

			const results = await Promise.all(
				input.configs.map((config) =>
					upsertTriggerConfig({
						projectId: input.projectId,
						agentType: config.agentType,
						triggerEvent: config.triggerEvent,
						enabled: config.enabled,
						parameters: config.parameters,
					}),
				),
			);
			return results;
		}),

	/**
	 * Get a composite view of all triggers for a project.
	 * Combines agent definitions with project-specific trigger configs.
	 * This is optimized for the dashboard to fetch all trigger data in a single call.
	 */
	getProjectTriggersView: protectedProcedure
		.input(z.object({ projectId: z.string() }))
		.query(async ({ ctx, input }): Promise<ProjectTriggersView> => {
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);

			// Fetch DB definitions and configs in parallel
			const [dbDefinitions, configs, integrations] = await Promise.all([
				listAgentDefinitions().catch((err) => {
					logger.warn('Failed to fetch agent definitions from DB', { error: err });
					return [];
				}),
				getTriggerConfigsByProject(input.projectId),
				listProjectIntegrations(input.projectId),
			]);

			// Build a combined list of definitions (DB + YAML)
			const yamlTypes = getKnownAgentTypes();
			const definitions: Array<{ agentType: string; definition: AgentDefinition }> = [];
			const seen = new Set<string>();

			// Start with DB definitions (they override YAML)
			for (const row of dbDefinitions) {
				definitions.push({ agentType: row.agentType, definition: row.definition });
				seen.add(row.agentType);
			}

			// Fill in YAML-only types not in DB
			for (const agentType of yamlTypes) {
				if (!seen.has(agentType)) {
					try {
						definitions.push({ agentType, definition: loadAgentDefinition(agentType) });
					} catch (err) {
						logger.warn('Failed to load agent definition from YAML', { agentType, error: err });
					}
				}
			}

			// Build a map of configs by agent type and event for O(1) lookup
			const configMap = new Map<string, Map<string, (typeof configs)[number]>>();
			for (const config of configs) {
				if (!configMap.has(config.agentType)) {
					configMap.set(config.agentType, new Map());
				}
				configMap.get(config.agentType)?.set(config.triggerEvent, config);
			}

			// Helper to merge parameter values with definitions
			function mergeParameters(
				paramDefs: TriggerParameter[],
				configParams?: Record<string, unknown>,
			): Record<string, TriggerParameterValue> {
				const result: Record<string, TriggerParameterValue> = {};
				for (const def of paramDefs) {
					// Use configured value if available, otherwise use default
					const value =
						configParams?.[def.name] !== undefined ? configParams[def.name] : def.defaultValue;
					// Only include valid primitive values
					if (
						typeof value === 'string' ||
						typeof value === 'boolean' ||
						typeof value === 'number'
					) {
						result[def.name] = value;
					}
				}
				return result;
			}

			// Helper to map parameter definitions
			function mapParameterDef(p: TriggerParameter): TriggerParameterDef {
				return {
					name: p.name,
					type: p.type as TriggerParameterDef['type'],
					label: p.label,
					description: p.description ?? null,
					required: p.required,
					defaultValue: p.defaultValue ?? null,
					options: p.options ?? null,
				};
			}

			// Build the agents array with merged trigger data
			const agents = definitions.map((def) => {
				const agentConfigs = configMap.get(def.agentType);
				const triggers: ResolvedTrigger[] = (def.definition.triggers ?? []).map(
					(trigger: SupportedTrigger) => {
						const config = agentConfigs?.get(trigger.event);
						return {
							event: trigger.event,
							label: trigger.label,
							description: trigger.description ?? null,
							providers: trigger.providers ?? null,
							enabled: config?.enabled ?? trigger.defaultEnabled,
							parameters: mergeParameters(
								trigger.parameters ?? [],
								config?.parameters as Record<string, unknown> | undefined,
							),
							parameterDefs: (trigger.parameters ?? []).map(mapParameterDef),
							isCustomized: config !== undefined,
						};
					},
				);

				return {
					agentType: def.agentType,
					triggers,
				};
			});

			// Build integrations map with single pass
			const integrationsMap = {
				pm: null as string | null,
				scm: null as string | null,
				email: null as string | null,
				sms: null as string | null,
			};
			for (const integration of integrations) {
				const category = integration.category as keyof typeof integrationsMap;
				if (category in integrationsMap) {
					integrationsMap[category] = integration.provider as string;
				}
			}

			return {
				agents,
				integrations: integrationsMap,
			};
		}),
});
