import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { SESSION_COOKIE_NAME } from '../../../api/auth/cookie.js';
import type { AppRouter } from '../../../api/router.js';
import type { CliConfig } from './config.js';

export type DashboardClient = ReturnType<typeof createDashboardClient>;

export function createDashboardClient(config: CliConfig) {
	return createTRPCClient<AppRouter>({
		links: [
			httpBatchLink({
				url: `${config.serverUrl}/trpc`,
				headers() {
					const headers: Record<string, string> = {
						Cookie: `${SESSION_COOKIE_NAME}=${config.sessionToken}`,
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
