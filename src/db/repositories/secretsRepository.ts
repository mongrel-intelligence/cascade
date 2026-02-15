import { and, eq } from 'drizzle-orm';
import { getDb } from '../client.js';
import { projectSecrets } from '../schema/index.js';

export async function getProjectSecret(projectId: string, key: string): Promise<string | null> {
	const db = getDb();
	const [row] = await db
		.select({ value: projectSecrets.value })
		.from(projectSecrets)
		.where(and(eq(projectSecrets.projectId, projectId), eq(projectSecrets.key, key)));
	return row?.value ?? null;
}

export async function getProjectSecrets(projectId: string): Promise<Record<string, string>> {
	const db = getDb();
	const rows = await db
		.select({ key: projectSecrets.key, value: projectSecrets.value })
		.from(projectSecrets)
		.where(eq(projectSecrets.projectId, projectId));

	const result: Record<string, string> = {};
	for (const row of rows) {
		result[row.key] = row.value;
	}
	return result;
}

export async function setProjectSecret(
	projectId: string,
	key: string,
	value: string,
): Promise<void> {
	const db = getDb();
	await db
		.insert(projectSecrets)
		.values({ projectId, key, value })
		.onConflictDoUpdate({
			target: [projectSecrets.projectId, projectSecrets.key],
			set: { value, updatedAt: new Date() },
		});
}

export async function deleteProjectSecret(projectId: string, key: string): Promise<void> {
	const db = getDb();
	await db
		.delete(projectSecrets)
		.where(and(eq(projectSecrets.projectId, projectId), eq(projectSecrets.key, key)));
}
