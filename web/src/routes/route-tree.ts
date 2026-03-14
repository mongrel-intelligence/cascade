import { rootRoute } from './__root.js';
import { globalDefinitionsRoute } from './global/definitions.js';
import { globalOrganizationsRoute } from './global/organizations.js';
import { globalRunsRoute } from './global/runs.js';
import { globalWebhookLogsRoute } from './global/webhook-logs.js';
import { indexRoute } from './index.js';
import { loginRoute } from './login.js';
import { projectAgentConfigsRoute } from './projects/$projectId.agent-configs.js';
import { projectGeneralRoute } from './projects/$projectId.general.js';
import { projectHarnessRoute } from './projects/$projectId.harness.js';
import { projectIntegrationsRoute } from './projects/$projectId.integrations.js';
import { projectDetailRoute } from './projects/$projectId.js';
import { projectWorkRoute } from './projects/$projectId.work.js';
import { projectsIndexRoute } from './projects/index.js';
import { prRunsRoute } from './prs/$projectId.$prNumber.js';
import { runDetailRoute } from './runs/$runId.js';
import { settingsCredentialsRoute } from './settings/credentials.js';
import { settingsGeneralRoute } from './settings/general.js';
import { settingsUsersRoute } from './settings/users.js';
import { workItemRunsRoute } from './work-items/$projectId.$workItemId.js';

export const routeTree = rootRoute.addChildren([
	loginRoute,
	indexRoute,
	runDetailRoute,
	projectsIndexRoute,
	projectDetailRoute.addChildren([
		projectGeneralRoute,
		projectHarnessRoute,
		projectWorkRoute,
		projectIntegrationsRoute,
		projectAgentConfigsRoute,
	]),
	settingsGeneralRoute,
	settingsCredentialsRoute,
	settingsUsersRoute,
	globalDefinitionsRoute,
	globalWebhookLogsRoute,
	globalOrganizationsRoute,
	globalRunsRoute,
	workItemRunsRoute,
	prRunsRoute,
]);
