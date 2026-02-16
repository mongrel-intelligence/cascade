import { TRPCError, initTRPC } from '@trpc/server';

export interface TRPCUser {
	id: string;
	orgId: string;
	email: string;
	name: string;
	role: string;
}

export interface TRPCContext {
	user: TRPCUser | null;
}

const t = initTRPC.context<TRPCContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(async (opts) => {
	if (!opts.ctx.user) {
		throw new TRPCError({ code: 'UNAUTHORIZED' });
	}
	return opts.next({ ctx: { user: opts.ctx.user } });
});
