import { listAllOrganizations } from '../../db/repositories/settingsRepository.js';
import { protectedProcedure, router } from '../trpc.js';

export const authRouter = router({
	me: protectedProcedure.query(async ({ ctx }) => {
		const base = {
			id: ctx.user.id,
			email: ctx.user.email,
			name: ctx.user.name,
			role: ctx.user.role,
			orgId: ctx.user.orgId,
			effectiveOrgId: ctx.effectiveOrgId,
		};
		if (ctx.user.role === 'superadmin') {
			const orgs = await listAllOrganizations();
			return { ...base, availableOrgs: orgs };
		}
		return { ...base, availableOrgs: undefined as { id: string; name: string }[] | undefined };
	}),
});
