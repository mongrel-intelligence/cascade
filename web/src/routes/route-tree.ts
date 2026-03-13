import { rootRoute } from './__root.js';
import { globalCredentialsRoute } from './global/credentials.js';
import { globalDefinitionsRoute } from './global/definitions.js';
import { globalOrganizationsRoute } from './global/organizations.js';
import { globalRunsRoute } from './global/runs.js';
import { globalWebhookLogsRoute } from './global/webhook-logs.js';
import { indexRoute } from './index.js';
import { loginRoute } from './login.js';
import { projectDetailRoute } from './projects/$projectId.js';
import { projectsIndexRoute } from './projects/index.js';
import { runDetailRoute } from './runs/$runId.js';
import { settingsAgentsRoute } from './settings/agents.js';
import { settingsCredentialsRoute } from './settings/credentials.js';
import { settingsGeneralRoute } from './settings/general.js';

export const routeTree = rootRoute.addChildren([
	loginRoute,
	indexRoute,
	runDetailRoute,
	projectsIndexRoute,
	projectDetailRoute,
	settingsGeneralRoute,
	settingsCredentialsRoute,
	settingsAgentsRoute,
	globalDefinitionsRoute,
	globalWebhookLogsRoute,
	globalOrganizationsRoute,
	globalCredentialsRoute,
	globalRunsRoute,
]);
