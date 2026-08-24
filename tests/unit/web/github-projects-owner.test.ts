/**
 * Regression test for the GitHub Projects owner-resolution blocking bug.
 *
 * `toOwnerViewer` must derive the owner from the GitHub *login* (handle), never
 * the display `name`. Owner/project discovery calls `user(login: …)`, so using
 * the profile name (e.g. "Jane Smith" vs `janesmith`) resolves to a `null` user
 * and makes the provider unconfigurable via the wizard. It also surfaces the
 * viewer's organizations so org-owned projects become selectable.
 */

import { describe, expect, it, vi } from 'vitest';

// hooks.ts imports the tRPC client at module load; stub it so importing the
// pure helper doesn't drag the real client/query-client graph into the test.
vi.mock('@/lib/trpc.js', () => ({
	trpcClient: { pm: { discovery: { discover: { mutate: vi.fn() } } } },
	trpc: {},
}));

import { toOwnerViewer } from '../../../web/src/components/projects/pm-providers/github-projects/hooks.js';

describe('toOwnerViewer (github-projects owner resolution)', () => {
	it('uses the GitHub login, NOT the display name, as the owner', () => {
		const result = toOwnerViewer({
			id: 'U_1',
			name: 'Jane Smith',
			displayName: 'Jane Smith',
			login: 'janesmith',
			organizations: [],
		});
		// The blocking bug returned `displayName` ("Jane Smith"); the owner must
		// be the login ("janesmith") or `user(login: …)` resolves to null.
		expect(result).toEqual({ login: 'janesmith', organizations: [] });
	});

	it('surfaces the viewer organizations (login only, blanks filtered)', () => {
		const result = toOwnerViewer({
			id: 'U_1',
			name: 'Jane',
			login: 'janesmith',
			organizations: [{ login: 'acme' }, { login: '' }, { login: 'globex' }],
		});
		expect(result).toEqual({ login: 'janesmith', organizations: ['acme', 'globex'] });
	});

	it('falls back to name only when login is absent (older backend); never invents organizations', () => {
		const result = toOwnerViewer({ id: 'U_1', name: 'octocat', displayName: 'octocat' });
		expect(result).toEqual({ login: 'octocat', organizations: [] });
	});

	it('returns null when neither login nor name is present', () => {
		expect(toOwnerViewer({ id: 'U_1', name: '' })).toBeNull();
	});
});
