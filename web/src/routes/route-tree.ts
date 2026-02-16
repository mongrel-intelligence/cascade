import { rootRoute } from './__root.js';
import { indexRoute } from './index.js';
import { loginRoute } from './login.js';
import { runDetailRoute } from './runs/$runId.js';

export const routeTree = rootRoute.addChildren([loginRoute, indexRoute, runDetailRoute]);
