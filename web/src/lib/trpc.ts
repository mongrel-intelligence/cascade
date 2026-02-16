import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { AppRouter } from '../../../src/api/router';
import { queryClient } from './query-client';

export const trpcClient = createTRPCClient<AppRouter>({
	links: [
		httpBatchLink({
			url: '/trpc',
		}),
	],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({
	client: trpcClient,
	queryClient,
});
