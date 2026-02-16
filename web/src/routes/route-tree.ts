import { rootRoute } from './__root.js';
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
]);
