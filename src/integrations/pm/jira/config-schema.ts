/**
 * JIRA provider integration config schema.
 *
 * Plan 009/3 extracts the JIRA Zod schema from its inline location
 * in `src/config/schema.ts` so the manifest can own its declared
 * contract. The conformance harness asserts round-trip identity on
 * this schema — eliminating the class of drift bug where the mapper
 * and the central schema could diverge (see Linear #1138 + #1142).
 *
 * The inline copy in `src/config/schema.ts` stays and is marked
 * `@deprecated` pointing here. Plan 5 routes `configMapper` through
 * the registry and deletes the duplicate.
 *
 * Note: JIRA API credentials (email, apiToken) live in the
 * `project_credentials` table, not in this config. This schema only
 * covers project-scoped settings.
 */

import { z } from 'zod';

export const jiraConfigSchema = z
	.object({
		/** JIRA project key (e.g. "CASCADE"). */
		projectKey: z.string().min(1),

		/** JIRA cloud base URL (e.g. "https://acme.atlassian.net"). */
		baseUrl: z.string().url(),

		/**
		 * Mapping from CASCADE status keys (backlog/todo/inProgress/done/...)
		 * to JIRA status names or transition IDs.
		 */
		statuses: z.record(z.string(), z.string()),

		/** Optional mapping from CASCADE issue-type keys to JIRA issue-type names. */
		issueTypes: z.record(z.string(), z.string()).optional(),

		/** Optional per-field custom field IDs (currently only `cost` is used). */
		customFields: z
			.object({
				cost: z.string().optional(),
			})
			.optional(),

		/**
		 * Optional CASCADE-managed label names. Each key defaults to its
		 * "cascade-*" conventional label name when the outer `labels` object
		 * is present in the input.
		 *
		 * `cascadeAlert` — recognized label for alert work items (spec 019).
		 * `statuses.alerts` is the recognized status key for the alerts slot.
		 * `statuses.friction` is the recognized status key for the friction report slot.
		 */
		labels: z
			.object({
				processing: z.string().default('cascade-processing'),
				processed: z.string().default('cascade-processed'),
				error: z.string().default('cascade-error'),
				readyToProcess: z.string().default('cascade-ready'),
				cascadeAlert: z.string().optional(),
			})
			.optional(),
	})
	.describe('JIRA project integration config');

export type JiraIntegrationConfig = z.infer<typeof jiraConfigSchema>;
