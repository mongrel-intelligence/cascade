import { agentConfigsRouter } from './routers/agentConfigs.js';
import { agentDefinitionsRouter } from './routers/agentDefinitions.js';
import { agentTriggerConfigsRouter } from './routers/agentTriggerConfigs.js';
import { authRouter } from './routers/auth.js';
import { credentialsRouter } from './routers/credentials.js';
import { integrationsDiscoveryRouter } from './routers/integrationsDiscovery.js';
import { organizationRouter } from './routers/organization.js';
import { projectsRouter } from './routers/projects.js';
import { promptsRouter } from './routers/prompts.js';
import { prsRouter } from './routers/prs.js';
import { runsRouter } from './routers/runs.js';
import { usersRouter } from './routers/users.js';
import { webhookLogsRouter } from './routers/webhookLogs.js';
import { webhooksRouter } from './routers/webhooks.js';
import { workItemsRouter } from './routers/workItems.js';
import { router } from './trpc.js';

export const appRouter = router({
	auth: authRouter,
	runs: runsRouter,
	projects: projectsRouter,
	organization: organizationRouter,
	credentials: credentialsRouter,
	agentConfigs: agentConfigsRouter,
	agentDefinitions: agentDefinitionsRouter,
	agentTriggerConfigs: agentTriggerConfigsRouter,
	prompts: promptsRouter,
	webhooks: webhooksRouter,
	webhookLogs: webhookLogsRouter,
	integrationsDiscovery: integrationsDiscoveryRouter,
	prs: prsRouter,
	workItems: workItemsRouter,
	users: usersRouter,
});

export type AppRouter = typeof appRouter;
