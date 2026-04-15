import { initTRPC, TRPCError } from '@trpc/server';

export interface TRPCUser {
	id: string;
	orgId: string;
	email: string;
	name: string;
	role: 'member' | 'admin' | 'superadmin';
}

export interface TRPCContext {
	user: TRPCUser | null;
	effectiveOrgId: string | null;
}

const t = initTRPC.context<TRPCContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async (opts) => {
	if (!opts.ctx.user || !opts.ctx.effectiveOrgId) {
		throw new TRPCError({ code: 'UNAUTHORIZED' });
	}
	return opts.next({
		ctx: { user: opts.ctx.user, effectiveOrgId: opts.ctx.effectiveOrgId },
	});
});

export const adminProcedure = t.procedure.use(async (opts) => {
	if (!opts.ctx.user || !opts.ctx.effectiveOrgId) {
		throw new TRPCError({ code: 'UNAUTHORIZED' });
	}
	if (!['admin', 'superadmin'].includes(opts.ctx.user.role)) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
	}
	return opts.next({
		ctx: { user: opts.ctx.user, effectiveOrgId: opts.ctx.effectiveOrgId },
	});
});

export const superAdminProcedure = t.procedure.use(async (opts) => {
	if (!opts.ctx.user || !opts.ctx.effectiveOrgId) {
		throw new TRPCError({ code: 'UNAUTHORIZED' });
	}
	if (opts.ctx.user.role !== 'superadmin') {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Superadmin access required' });
	}
	return opts.next({
		ctx: { user: opts.ctx.user, effectiveOrgId: opts.ctx.effectiveOrgId },
	});
});
