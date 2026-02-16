import { protectedProcedure, router } from '../trpc.js';

export const authRouter = router({
	me: protectedProcedure.query(({ ctx }) => {
		return {
			id: ctx.user.id,
			email: ctx.user.email,
			name: ctx.user.name,
			role: ctx.user.role,
			orgId: ctx.user.orgId,
		};
	}),
});
