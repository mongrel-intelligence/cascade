import { getOrganization, listAllOrganizations } from '../../db/repositories/settingsRepository.js';
import { protectedProcedure, router } from '../trpc.js';

export const authRouter = router({
	me: protectedProcedure.query(async ({ ctx }) => {
		const org = await getOrganization(ctx.effectiveOrgId);
		const base = {
			id: ctx.user.id,
			email: ctx.user.email,
			name: ctx.user.name,
			role: ctx.user.role,
			orgId: ctx.user.orgId,
			effectiveOrgId: ctx.effectiveOrgId,
			orgName: org?.name ?? null,
		};
		if (ctx.user.role === 'superadmin') {
			const orgs = await listAllOrganizations();
			return { ...base, availableOrgs: orgs };
		}
		return { ...base, availableOrgs: undefined as { id: string; name: string }[] | undefined };
	}),
});
