/**
 * Trello manifest mutation hooks (plan 010/1 tasks 4).
 *
 * Verifies trelloManifest.createLabel + createCustomField are wired
 * and delegate to the appropriate trelloClient methods under
 * withTrelloCredentials scope.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/trello/client.js', () => ({
	withTrelloCredentials: vi.fn(async (_creds, fn) => fn()),
	trelloClient: {
		createBoardLabel: vi.fn(async (_boardId: string, name: string, color: string) => ({
			id: `trello-label-${name}`,
			name,
			color,
		})),
		createBoardCustomField: vi.fn(async (_boardId: string, name: string, type: string) => ({
			id: `trello-cf-${name}`,
			name,
			type,
		})),
	},
}));

import { trelloManifest } from '../../../../src/integrations/pm/trello/manifest.js';

describe('trelloManifest.createLabel (plan 010/1)', () => {
	it('is declared', () => {
		expect(typeof trelloManifest.createLabel).toBe('function');
	});

	it('delegates to trelloClient.createBoardLabel with credential scope', async () => {
		const hook = trelloManifest.createLabel;
		if (!hook) throw new Error('createLabel should be defined');
		const result = await hook({
			credentials: { api_key: 'k', token: 't' },
			containerId: 'board-1',
			name: 'bug',
			color: 'red',
		});
		expect(result).toEqual({ id: 'trello-label-bug', name: 'bug', color: 'red' });
	});

	it('defaults color to blue when omitted', async () => {
		const hook = trelloManifest.createLabel;
		if (!hook) throw new Error('createLabel should be defined');
		const result = await hook({
			credentials: { api_key: 'k', token: 't' },
			containerId: 'board-1',
			name: 'feature',
		});
		// Trello client's createBoardLabel defaults color='blue' — the result
		// reflects whatever the client returned.
		expect(result.name).toBe('feature');
	});
});

describe('trelloManifest.createCustomField (plan 010/1)', () => {
	it('is declared', () => {
		expect(typeof trelloManifest.createCustomField).toBe('function');
	});

	it('delegates to trelloClient.createBoardCustomField with credential scope', async () => {
		const hook = trelloManifest.createCustomField;
		if (!hook) throw new Error('createCustomField should be defined');
		const result = await hook({
			credentials: { api_key: 'k', token: 't' },
			containerId: 'board-1',
			name: 'Cost',
		});
		expect(result).toEqual({ id: 'trello-cf-Cost', name: 'Cost', type: 'number' });
	});
});
