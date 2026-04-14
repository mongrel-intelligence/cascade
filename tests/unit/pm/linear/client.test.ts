import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGraphQLResponse(data: unknown) {
	return {
		ok: true,
		json: vi.fn().mockResolvedValue({ data }),
	};
}

function makeGraphQLErrorResponse(message: string) {
	return {
		ok: true,
		json: vi.fn().mockResolvedValue({ errors: [{ message }] }),
	};
}

function makeHttpErrorResponse(status: number) {
	return {
		ok: false,
		status,
		json: vi.fn().mockResolvedValue({}),
	};
}

// ---------------------------------------------------------------------------
// Import the client under test
// ---------------------------------------------------------------------------

import { linearClient, withLinearCredentials } from '../../../../src/linear/client.js';

const TEST_CREDS = { apiKey: 'test-api-key' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('linearClient discovery methods', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// =========================================================================
	// getTeams
	// =========================================================================
	describe('getTeams', () => {
		it('returns an array of LinearTeam objects', async () => {
			mockFetch.mockResolvedValue(
				makeGraphQLResponse({
					teams: {
						nodes: [
							{ id: 'team-1', name: 'Engineering', key: 'ENG', description: 'Main team' },
							{ id: 'team-2', name: 'Design', key: 'DES', description: null },
						],
					},
				}),
			);

			const result = await withLinearCredentials(TEST_CREDS, () => linearClient.getTeams());

			expect(result).toHaveLength(2);
			expect(result[0]).toEqual({
				id: 'team-1',
				name: 'Engineering',
				key: 'ENG',
				description: 'Main team',
			});
			expect(result[1]).toEqual({
				id: 'team-2',
				name: 'Design',
				key: 'DES',
				description: null,
			});
		});

		it('returns an empty array when no teams are available', async () => {
			mockFetch.mockResolvedValue(
				makeGraphQLResponse({
					teams: { nodes: [] },
				}),
			);

			const result = await withLinearCredentials(TEST_CREDS, () => linearClient.getTeams());

			expect(result).toEqual([]);
		});

		it('uses defaults for missing fields in team nodes', async () => {
			mockFetch.mockResolvedValue(
				makeGraphQLResponse({
					teams: {
						nodes: [{}],
					},
				}),
			);

			const result = await withLinearCredentials(TEST_CREDS, () => linearClient.getTeams());

			expect(result[0]).toEqual({ id: '', name: '', key: '', description: null });
		});

		it('throws on GraphQL errors', async () => {
			mockFetch.mockResolvedValue(makeGraphQLErrorResponse('Unauthorized'));

			await expect(
				withLinearCredentials(TEST_CREDS, () => linearClient.getTeams()),
			).rejects.toThrow('Linear API error: Unauthorized');
		});

		it('throws on HTTP errors', async () => {
			mockFetch.mockResolvedValue(makeHttpErrorResponse(401));

			await expect(
				withLinearCredentials(TEST_CREDS, () => linearClient.getTeams()),
			).rejects.toThrow('Linear API HTTP error 401');
		});

		it('sends the correct Authorization header', async () => {
			mockFetch.mockResolvedValue(makeGraphQLResponse({ teams: { nodes: [] } }));

			await withLinearCredentials(TEST_CREDS, () => linearClient.getTeams());

			expect(mockFetch).toHaveBeenCalledWith(
				'https://api.linear.app/graphql',
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: 'Bearer test-api-key',
					}),
				}),
			);
		});
	});

	// =========================================================================
	// getTeamWorkflowStates
	// =========================================================================
	describe('getTeamWorkflowStates', () => {
		it('returns an array of LinearWorkflowState objects for the given team', async () => {
			mockFetch.mockResolvedValue(
				makeGraphQLResponse({
					team: {
						states: {
							nodes: [
								{ id: 'state-1', name: 'Backlog', type: 'backlog', color: '#aaa' },
								{ id: 'state-2', name: 'In Progress', type: 'started', color: '#00f' },
								{ id: 'state-3', name: 'Done', type: 'completed', color: '#0f0' },
							],
						},
					},
				}),
			);

			const result = await withLinearCredentials(TEST_CREDS, () =>
				linearClient.getTeamWorkflowStates('team-1'),
			);

			expect(result).toHaveLength(3);
			expect(result[0]).toEqual({ id: 'state-1', name: 'Backlog', type: 'backlog', color: '#aaa' });
			expect(result[1]).toEqual({
				id: 'state-2',
				name: 'In Progress',
				type: 'started',
				color: '#00f',
			});
			expect(result[2]).toEqual({ id: 'state-3', name: 'Done', type: 'completed', color: '#0f0' });
		});

		it('returns an empty array when team has no workflow states', async () => {
			mockFetch.mockResolvedValue(
				makeGraphQLResponse({
					team: { states: { nodes: [] } },
				}),
			);

			const result = await withLinearCredentials(TEST_CREDS, () =>
				linearClient.getTeamWorkflowStates('team-1'),
			);

			expect(result).toEqual([]);
		});

		it('uses defaults for missing fields in state nodes', async () => {
			mockFetch.mockResolvedValue(
				makeGraphQLResponse({
					team: { states: { nodes: [{}] } },
				}),
			);

			const result = await withLinearCredentials(TEST_CREDS, () =>
				linearClient.getTeamWorkflowStates('team-1'),
			);

			expect(result[0]).toEqual({ id: '', name: '', type: '', color: '' });
		});

		it('passes the teamId variable in the GraphQL request', async () => {
			mockFetch.mockResolvedValue(makeGraphQLResponse({ team: { states: { nodes: [] } } }));

			await withLinearCredentials(TEST_CREDS, () =>
				linearClient.getTeamWorkflowStates('my-team-id'),
			);

			const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
			expect(body.variables).toEqual({ id: 'my-team-id' });
		});

		it('throws on GraphQL errors', async () => {
			mockFetch.mockResolvedValue(makeGraphQLErrorResponse('Team not found'));

			await expect(
				withLinearCredentials(TEST_CREDS, () => linearClient.getTeamWorkflowStates('bad-id')),
			).rejects.toThrow('Linear API error: Team not found');
		});

		it('throws on HTTP errors', async () => {
			mockFetch.mockResolvedValue(makeHttpErrorResponse(500));

			await expect(
				withLinearCredentials(TEST_CREDS, () => linearClient.getTeamWorkflowStates('team-1')),
			).rejects.toThrow('Linear API HTTP error 500');
		});
	});

	// =========================================================================
	// getTeamLabels
	// =========================================================================
	describe('getTeamLabels', () => {
		it('returns an array of LinearLabel objects for the given team', async () => {
			mockFetch.mockResolvedValue(
				makeGraphQLResponse({
					team: {
						labels: {
							nodes: [
								{ id: 'label-1', name: 'Bug', color: '#f00', description: 'A bug' },
								{ id: 'label-2', name: 'Feature', color: '#0f0', description: null },
							],
						},
					},
				}),
			);

			const result = await withLinearCredentials(TEST_CREDS, () =>
				linearClient.getTeamLabels('team-1'),
			);

			expect(result).toHaveLength(2);
			expect(result[0]).toEqual({
				id: 'label-1',
				name: 'Bug',
				color: '#f00',
				description: 'A bug',
			});
			expect(result[1]).toEqual({
				id: 'label-2',
				name: 'Feature',
				color: '#0f0',
				description: null,
			});
		});

		it('returns an empty array when team has no labels', async () => {
			mockFetch.mockResolvedValue(
				makeGraphQLResponse({
					team: { labels: { nodes: [] } },
				}),
			);

			const result = await withLinearCredentials(TEST_CREDS, () =>
				linearClient.getTeamLabels('team-1'),
			);

			expect(result).toEqual([]);
		});

		it('uses defaults for missing fields in label nodes', async () => {
			mockFetch.mockResolvedValue(
				makeGraphQLResponse({
					team: { labels: { nodes: [{}] } },
				}),
			);

			const result = await withLinearCredentials(TEST_CREDS, () =>
				linearClient.getTeamLabels('team-1'),
			);

			expect(result[0]).toEqual({ id: '', name: '', color: '', description: null });
		});

		it('passes the teamId variable in the GraphQL request', async () => {
			mockFetch.mockResolvedValue(makeGraphQLResponse({ team: { labels: { nodes: [] } } }));

			await withLinearCredentials(TEST_CREDS, () => linearClient.getTeamLabels('my-team-id'));

			const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
			expect(body.variables).toEqual({ id: 'my-team-id' });
		});

		it('throws on GraphQL errors', async () => {
			mockFetch.mockResolvedValue(makeGraphQLErrorResponse('Permission denied'));

			await expect(
				withLinearCredentials(TEST_CREDS, () => linearClient.getTeamLabels('bad-id')),
			).rejects.toThrow('Linear API error: Permission denied');
		});

		it('throws on HTTP errors', async () => {
			mockFetch.mockResolvedValue(makeHttpErrorResponse(403));

			await expect(
				withLinearCredentials(TEST_CREDS, () => linearClient.getTeamLabels('team-1')),
			).rejects.toThrow('Linear API HTTP error 403');
		});
	});
});
