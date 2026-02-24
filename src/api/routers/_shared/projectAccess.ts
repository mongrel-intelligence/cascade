import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { getDb } from '../../../db/client.js';
import { projects } from '../../../db/schema/index.js';

/**
 * Verify that a project exists and belongs to the given org.
 * Throws TRPCError NOT_FOUND if the project is missing or owned by a different org.
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
