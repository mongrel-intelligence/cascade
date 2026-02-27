import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@trpc/client', () => ({
	createTRPCClient: vi.fn(() => ({ mock: 'client' })),
	httpBatchLink: vi.fn((opts) => ({ type: 'httpBatchLink', ...opts })),
}));

import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { SESSION_COOKIE_NAME } from '../../../../src/api/auth/cookie.js';
import { createDashboardClient } from '../../../../src/cli/dashboard/_shared/client.js';

describe('createDashboardClient', () => {
	it('creates a tRPC client with links', () => {
		const config = { serverUrl: 'http://localhost:3000', sessionToken: 'my-token' };

		createDashboardClient(config);

		expect(createTRPCClient).toHaveBeenCalledTimes(1);
		const callArgs = vi.mocked(createTRPCClient).mock.calls[0][0];
		expect(callArgs.links).toHaveLength(1);
	});

	it('configures httpBatchLink with /trpc endpoint', () => {
		const config = { serverUrl: 'http://myserver:4000', sessionToken: 'tok' };

		createDashboardClient(config);

		expect(httpBatchLink).toHaveBeenCalledWith(
			expect.objectContaining({
				url: 'http://myserver:4000/trpc',
			}),
		);
	});

	it('includes session cookie in headers', () => {
		const config = { serverUrl: 'http://localhost:3000', sessionToken: 'secret-token' };

		createDashboardClient(config);

		const linkOpts = vi.mocked(httpBatchLink).mock.calls[0][0] as {
			headers: () => Record<string, string>;
		};
		const headers = linkOpts.headers();
		expect(headers).toEqual({
			Cookie: `${SESSION_COOKIE_NAME}=secret-token`,
		});
	});

	it('includes x-org-context header when orgId is set', () => {
		const config = { serverUrl: 'http://localhost:3000', sessionToken: 'tok', orgId: 'my-org' };

		createDashboardClient(config);

		const linkOpts = vi.mocked(httpBatchLink).mock.calls[0][0] as {
			headers: () => Record<string, string>;
		};
		const headers = linkOpts.headers();
		expect(headers).toEqual({
			Cookie: `${SESSION_COOKIE_NAME}=tok`,
			'x-org-context': 'my-org',
		});
	});

	it('returns the created client', () => {
		const config = { serverUrl: 'http://localhost:3000', sessionToken: 'tok' };

		const client = createDashboardClient(config);

		expect(client).toEqual({ mock: 'client' });
	});
});
