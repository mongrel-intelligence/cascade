import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { AppRouter } from '../../../src/api/router';
import { queryClient } from './query-client';

let getOrgContext: () => string | null = () => null;

export function setOrgContextGetter(fn: () => string | null) {
	getOrgContext = fn;
}

export const trpcClient = createTRPCClient<AppRouter>({
	links: [
		httpBatchLink({
			url: '/trpc',
			headers() {
				const orgId = getOrgContext();
				return orgId ? { 'x-org-context': orgId } : {};
			},
		}),
	],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({
	client: trpcClient,
	queryClient,
});
