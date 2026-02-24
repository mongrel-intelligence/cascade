import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { getDb } from '../../../db/client.js';
import { getRunById } from '../../../db/repositories/runsRepository.js';
import { projects } from '../../../db/schema/index.js';

/**
 * Verify that a project belongs to the given org.
 * Throws `NOT_FOUND` if the project does not exist or belongs to a different org.
 */
export async function verifyProjectOrgAccess(projectId: string, orgId: string): Promise<void> {
	const db = getDb();
	const [project] = await db
		.select({ orgId: projects.orgId })
		.from(projects)
		.where(eq(projects.id, projectId));
	if (!project || project.orgId !== orgId) {
		throw new TRPCError({ code: 'NOT_FOUND' });
	}
}

/**
 * Verify that a run belongs to the given org (via its associated project).
 * Throws `NOT_FOUND` if the run does not exist or belongs to a different org.
 * Runs without a projectId are allowed through (no org scoping needed).
 */
export async function verifyRunOrgAccess(runId: string, orgId: string): Promise<void> {
	const run = await getRunById(runId);
	if (!run) throw new TRPCError({ code: 'NOT_FOUND' });
	if (run.projectId) {
		await verifyProjectOrgAccess(run.projectId, orgId);
	}
}
