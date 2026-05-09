/**
 * Trello provider integration config schema.
 *
 * Plan 009/2 extracts the Trello Zod schema from its inline location
 * in `src/config/schema.ts` (under the CASCADE-config `trello` field)
 * so the manifest can own its declared contract. The conformance harness
 * asserts round-trip identity on this schema, which eliminates the class
 * of drift bug where the mapper and the central schema could diverge
 * (see Linear #1138 + #1142).
 *
 * The inline copy in `src/config/schema.ts` stays in place and is marked
 * `@deprecated` pointing here. Plan 5 replaces the inline copy with
 * `trelloConfigSchema` imported through the registry and deletes the
 * deprecated duplicate.
 *
 * Note: Trello API credentials (apiKey, token, apiSecret) live in the
 * `project_credentials` table, not in this config. This schema only
 * covers project-scoped settings.
 */

import { z } from 'zod';

export const trelloConfigSchema = z
	.object({
		/** Trello board ID for this project. */
		boardId: z.string().min(1),

		/**
		 * Mapping from CASCADE status keys (backlog/todo/inProgress/done/...)
		 * to Trello list IDs. Keys are provider-agnostic, values are provider-native.
		 * Recognized optional keys:
		 *   - `alerts` — the list for incoming alert work items (spec 019).
		 *   - `friction` — the list for incoming friction report work items.
		 */
		lists: z.record(z.string(), z.string()),

		/**
		 * Mapping from CASCADE label keys (bug/feature/...) to Trello label IDs.
		 * Recognized key: `cascade-alert` — the label applied to alert work items (spec 019).
		 */
		labels: z.record(z.string(), z.string()),

		/** Optional per-field custom field IDs (currently only `cost` is used). */
		customFields: z
			.object({
				cost: z.string().optional(),
			})
			.optional(),
	})
	.describe('Trello project integration config');

export type TrelloIntegrationConfig = z.infer<typeof trelloConfigSchema>;
