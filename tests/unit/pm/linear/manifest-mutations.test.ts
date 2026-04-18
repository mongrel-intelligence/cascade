/**
 * Linear manifest mutation hooks (plan 010/1 task 6).
 *
 * Linear declares `createLabel` only — Linear custom fields aren't
 * exposed through CASCADE's Linear client, so createCustomField stays
 * unimplemented.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/linear/client.js', () => ({
	withLinearCredentials: vi.fn(async (_creds: unknown, fn: () => unknown) => fn()),
	linearClient: {
		createLabel: vi.fn(async (_teamId: string, name: string, color?: string) => ({
			id: `linear-label-${name}`,
			name,
			color: color ?? '#888888',
		})),
	},
}));

import { linearManifest } from '../../../../src/integrations/pm/linear/manifest.js';

describe('linearManifest.createLabel (plan 010/1)', () => {
	it('is declared', () => {
		expect(typeof linearManifest.createLabel).toBe('function');
	});

	it('delegates to linearClient.createLabel via withLinearCredentials', async () => {
		const hook = linearManifest.createLabel;
		if (!hook) throw new Error('createLabel should be defined');
		const result = await hook({
			credentials: { api_key: 'lin_api_test' },
			containerId: 'team-uuid-1',
			name: 'bug',
			color: '#ff0000',
		});
		expect(result).toEqual({ id: 'linear-label-bug', name: 'bug', color: '#ff0000' });
	});

	it('omits color and passes through the client default', async () => {
		const hook = linearManifest.createLabel;
		if (!hook) throw new Error('createLabel should be defined');
		const result = await hook({
			credentials: { api_key: 'lin_api_test' },
			containerId: 'team-uuid-1',
			name: 'feature',
		});
		expect(result.name).toBe('feature');
		expect(result.color).toBeTruthy();
	});
});

describe('linearManifest does NOT declare createCustomField', () => {
	it('createCustomField hook is undefined', () => {
		expect(linearManifest.createCustomField).toBeUndefined();
	});
});
