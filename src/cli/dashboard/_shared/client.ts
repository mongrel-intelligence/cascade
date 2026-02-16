import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '../../../api/router.js';
import type { CliConfig } from './config.js';

export type DashboardClient = ReturnType<typeof createDashboardClient>;

export function createDashboardClient(config: CliConfig) {
	return createTRPCClient<AppRouter>({
		links: [
			httpBatchLink({
				url: `${config.serverUrl}/trpc`,
				headers() {
					return {
						Cookie: `cascade_session=${config.sessionToken}`,
					};
				},
			}),
		],
	});
}
