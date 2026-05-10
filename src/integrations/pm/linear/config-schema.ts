/**
 * Linear provider integration config schema.
 *
 * Plan 009/4 extracts the Linear Zod schema from its inline location
 * in `src/config/schema.ts` into this file so the manifest can own its
 * declared contract. The conformance harness asserts round-trip
 * identity — permanently eliminating the two-layer drift class that
 * shipped `projectId` stripped twice in the 2026-04 workstream
 * (#1138 + #1142).
 *
 * Note: Linear API credentials live in the `project_credentials` table.
 * This schema only covers project-scoped settings.
 */

import { z } from 'zod';

export const linearConfigSchema = z
	.object({
		/** Linear team UUID. */
		teamId: z.string().min(1),

		/**
		 * Optional Linear Project (initiative) ID — when set, narrows
		 * scope within the team. Added in spec 005. Must survive
		 * round-trip through this schema — regression guard for
		 * #1138 + #1142.
		 */
		projectId: z.string().optional(),

		/**
		 * Mapping from CASCADE status keys (backlog/todo/inProgress/done/...)
		 * to Linear workflow state UUIDs. Values are Linear state IDs
		 * (UUIDs), not state names — storing names was the bug class
		 * caught in #1117, #1137, #1139.
		 */
		statuses: z.record(z.string(), z.string()),

		/**
		 * Optional CASCADE-managed Linear label UUIDs. Each key is
		 * optional to accommodate teams that only use a subset.
		 *
		 * `cascadeAlert` — recognized label UUID for alert work items (spec 019).
		 * `cascadeFriction` — recognized label UUID for friction work items (2026-05-10).
		 * `statuses.alerts` is the recognized status key for the alerts slot.
		 * `statuses.friction` is the recognized status key for the friction report slot.
		 */
		labels: z
			.object({
				processing: z.string().optional(),
				processed: z.string().optional(),
				error: z.string().optional(),
				readyToProcess: z.string().optional(),
				auto: z.string().optional(),
				cascadeAlert: z.string().optional(),
				cascadeFriction: z.string().optional(),
			})
			.optional(),

		/** Optional per-field custom field IDs (currently only `cost` is used). */
		customFields: z
			.object({
				cost: z.string().optional(),
			})
			.optional(),
	})
	.describe('Linear project integration config');

export type LinearIntegrationConfig = z.infer<typeof linearConfigSchema>;
