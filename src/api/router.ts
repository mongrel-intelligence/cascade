import { authRouter } from './routers/auth.js';
import { projectsRouter } from './routers/projects.js';
import { runsRouter } from './routers/runs.js';
import { router } from './trpc.js';

export const appRouter = router({
	auth: authRouter,
	runs: runsRouter,
	projects: projectsRouter,
});

export type AppRouter = typeof appRouter;
