import { listProjectsForOrg } from '../../db/repositories/runsRepository.js';
import { protectedProcedure, router } from '../trpc.js';

export const projectsRouter = router({
	list: protectedProcedure.query(async ({ ctx }) => {
		return listProjectsForOrg(ctx.user.orgId);
	}),
});
