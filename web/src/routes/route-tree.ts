import { rootRoute } from './__root.js';
import { indexRoute } from './index.js';
import { loginRoute } from './login.js';
import { gmailCallbackRoute } from './oauth/gmail-callback.js';
import { projectDetailRoute } from './projects/$projectId.js';
import { projectsIndexRoute } from './projects/index.js';
import { prsRoute } from './prs.js';
import { runDetailRoute } from './runs/$runId.js';
import { settingsAgentsRoute } from './settings/agents.js';
import { settingsCredentialsRoute } from './settings/credentials.js';
import { settingsDefinitionsRoute } from './settings/definitions.js';
import { settingsGeneralRoute } from './settings/general.js';
import { webhookLogsRoute } from './webhooklogs.js';
import { workItemsRoute } from './workitems.js';

export const routeTree = rootRoute.addChildren([
	loginRoute,
	indexRoute,
	runDetailRoute,
	projectsIndexRoute,
	projectDetailRoute,
	settingsGeneralRoute,
	settingsCredentialsRoute,
	settingsAgentsRoute,
	settingsDefinitionsRoute,
	webhookLogsRoute,
	workItemsRoute,
	prsRoute,
	gmailCallbackRoute,
]);
