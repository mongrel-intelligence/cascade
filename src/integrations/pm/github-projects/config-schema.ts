/**
 * GitHub Projects provider integration config schema.
 */

import { z } from 'zod';

export const githubProjectsConfigSchema = z
	.object({
		/** GitHub Project node ID (PVT_xxx). */
		projectId: z.string().min(1),

		/** GitHub username or organization login that owns the project. */
		owner: z.string().min(1),

		/** Whether the owner is a user or an organization. */
		ownerType: z.enum(['user', 'organization']),

		/**
		 * Mapping from CASCADE status keys (todo/inProgress/done/etc.) to
		 * GitHub Projects Status single-select option node IDs (PVTSSF_xxx).
		 */
		statuses: z.record(z.string(), z.string()),

		/**
		 * Optional GitHub label node IDs for lifecycle automation.
		 */
		labels: z
			.object({
				processing: z.string().optional(),
				readyToProcess: z.string().optional(),
			})
			.optional(),
	})
	.describe('GitHub Projects integration config');

export type GitHubProjectsIntegrationConfig = z.infer<typeof githubProjectsConfigSchema>;
