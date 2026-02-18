import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { AppRouter } from '../../../src/api/router';
import { API_URL } from './api.js';
import { queryClient } from './query-client';

let getOrgContext: () => string | null = () => null;

export function setOrgContextGetter(fn: () => string | null) {
	getOrgContext = fn;
}

export const trpcClient = createTRPCClient<AppRouter>({
	links: [
		httpBatchLink({
			url: `${API_URL}/trpc`,
			headers() {
				const orgId = getOrgContext();
				return orgId ? { 'x-org-context': orgId } : {};
			},
			fetch(url, options) {
				return fetch(url, { ...options, credentials: 'include' });
			},
		}),
	],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({
	client: trpcClient,
	queryClient,
});
