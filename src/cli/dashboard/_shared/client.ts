import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '../../../api/router.js';
import type { CliConfig } from './config.js';

export type DashboardClient = ReturnType<typeof createDashboardClient>;

export function createDashboardClient(config: CliConfig) {
	// Use the cookie name from config (set during login) to match the server's environment
	const cookieName = config.cookieName ?? 'cascade_session';

	return createTRPCClient<AppRouter>({
		links: [
			httpBatchLink({
				url: `${config.serverUrl}/trpc`,
				headers() {
					const headers: Record<string, string> = {
						Cookie: `${cookieName}=${config.sessionToken}`,
					};
					if (config.orgId) {
						headers['x-org-context'] = config.orgId;
					}
					return headers;
				},
			}),
		],
	});
}
