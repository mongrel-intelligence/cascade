/**
 * Shared PM credential scoping utility for webhook handlers.
 *
 * Wraps the `withPMCredentials(…, () => withPMProvider(…, fn))` pattern
 * used by GitHub (webhook-handler.ts L190-206) and Sentry (webhook-handler.ts L68-81)
 * into a single reusable function.
 *
 * Usage:
 *   await withPMScope(project, () => runTheAgent());
 */

import { withPMCredentials, withPMProvider } from '../../pm/context.js';
import { createPMProvider, pmRegistry } from '../../pm/index.js';
import type { ProjectConfig } from '../../types/index.js';

/**
 * Execute `fn` within the PM credential and PM provider scope for a project.
 *
 * Sets up:
 *   withPMCredentials → withPMProvider → fn()
 *
 * This is the standard PM scope needed for agents that perform PM lifecycle
 * operations (labels, status moves, PR links). Falls through gracefully if
 * no PM type is configured on the project.
 *
 * @param project  Project config (used to determine PM type and credentials).
 * @param fn       Async function to run inside the PM scope.
 */
export async function withPMScope<T>(project: ProjectConfig, fn: () => Promise<T>): Promise<T> {
	const pmProvider = createPMProvider(project);
	return withPMCredentials(
		project.id,
		project.pm?.type,
		(t) => pmRegistry.getOrNull(t),
		() => withPMProvider(pmProvider, fn),
	);
}
