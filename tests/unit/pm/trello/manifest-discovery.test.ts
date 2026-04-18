/**
 * Trello manifest discovery (plan 009/2 task 2).
 *
 * The manifest declares `discoveryCapabilities: { boards, labels,
 * containers, customFields }` and wires `createDiscoveryProvider` to
 * return a PMProvider whose `discover(capability, args)` method serves
 * each capability via the existing trelloClient. Credentials scope is
 * established via `withTrelloCredentials` so the singleton client
 * doesn't need per-call credential passing.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/trello/client.js', () => {
	const fakeBoards = [
		{ id: 'board-1', name: 'Board One', url: 'https://trello.com/b/1' },
		{ id: 'board-2', name: 'Board Two', url: 'https://trello.com/b/2' },
	];
	const fakeLabels = [
		{ id: 'label-1', name: 'bug', color: 'red' },
		{ id: 'label-2', name: 'feature', color: 'green' },
	];
	const fakeLists = [
		{ id: 'list-1', name: 'Backlog' },
		{ id: 'list-2', name: 'Todo' },
	];
	const fakeCustomFields = [{ id: 'cf-1', name: 'Cost', type: 'number' }];

	return {
		withTrelloCredentials: vi.fn(async (_creds, fn) => fn()),
		trelloClient: {
			getBoards: vi.fn(async () => fakeBoards),
			getBoardLabels: vi.fn(async () => fakeLabels),
			getBoardLists: vi.fn(async () => fakeLists),
			getBoardCustomFields: vi.fn(async () => fakeCustomFields),
			getMe: vi.fn(async () => ({
				id: 'trello-user-abc',
				fullName: 'Trello User',
				username: 'trellouser',
			})),
		},
	};
});

import { trelloManifest } from '../../../../src/integrations/pm/trello/manifest.js';

describe('trelloManifest.discoveryCapabilities', () => {
	it('declares boards, labels, customFields, currentUser', () => {
		const caps = trelloManifest.discoveryCapabilities;
		expect(caps?.boards).toBe(true);
		expect(caps?.labels).toBe(true);
		expect(caps?.customFields).toBe(true);
		expect(caps?.currentUser).toBe(true);
		// Trello doesn't declare containers or states — see manifest docstring.
		expect(caps?.containers).toBeUndefined();
		expect(caps?.states).toBeUndefined();
	});

	it('declares createDiscoveryProvider factory', () => {
		expect(typeof trelloManifest.createDiscoveryProvider).toBe('function');
	});
});

describe('trelloManifest.discover via createDiscoveryProvider', () => {
	function makeProvider() {
		if (!trelloManifest.createDiscoveryProvider) {
			throw new Error('createDiscoveryProvider missing on trelloManifest');
		}
		return trelloManifest.createDiscoveryProvider({
			credentials: { api_key: 'k', token: 't' },
		});
	}

	it('discover("boards") returns { id, name }[] with ContainerId', async () => {
		const provider = makeProvider();
		const result = await provider.discover?.('boards', {});
		expect(Array.isArray(result)).toBe(true);
		expect(result?.length).toBe(2);
		expect(result?.[0]).toEqual(expect.objectContaining({ id: 'board-1', name: 'Board One' }));
	});

	it('discover("labels", {containerId: boardId}) returns { id, name, color? }[]', async () => {
		const provider = makeProvider();
		const result = await provider.discover?.('labels', {
			containerId: 'board-1' as never,
		});
		expect(Array.isArray(result)).toBe(true);
		expect(result?.length).toBe(2);
		expect(result?.[0]).toEqual(
			expect.objectContaining({ id: 'label-1', name: 'bug', color: 'red' }),
		);
	});

	it('discover("customFields") returns { id, name, type }[]', async () => {
		const provider = makeProvider();
		const result = await provider.discover?.('customFields', {
			containerId: 'board-1' as never,
		});
		expect(Array.isArray(result)).toBe(true);
		expect(result?.length).toBe(1);
		expect(result?.[0]).toEqual(
			expect.objectContaining({ id: 'cf-1', name: 'Cost', type: 'number' }),
		);
	});

	it('discover("currentUser") returns { id, name, displayName } (plan 010/2)', async () => {
		const provider = makeProvider();
		const result = await provider.discover?.('currentUser', {});
		expect(result).toEqual({
			id: 'trello-user-abc',
			name: 'Trello User',
			displayName: 'trellouser',
		});
	});
});
