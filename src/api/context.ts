import { getOrganization } from '../db/repositories/settingsRepository.js';
import type { TRPCUser } from './trpc.js';

export async function computeEffectiveOrgId(
	user: TRPCUser | null,
	requestedOrgId: string | undefined,
): Promise<string | null> {
	if (!user) return null;
	if (
		requestedOrgId &&
		requestedOrgId !== user.orgId &&
		(user.role === 'admin' || user.role === 'superadmin')
	) {
		const org = await getOrganization(requestedOrgId);
		return org ? requestedOrgId : user.orgId;
	}
	return user.orgId;
}
