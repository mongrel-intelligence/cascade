import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoadConfig = vi.fn();
const mockCreateDashboardClient = vi.fn();

vi.mock('../../../../../src/cli/dashboard/_shared/config.js', () => ({
	loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
}));

vi.mock('../../../../../src/cli/dashboard/_shared/client.js', () => ({
	createDashboardClient: (...args: unknown[]) => mockCreateDashboardClient(...args),
}));

vi.mock('chalk', () => ({
	default: {
		bold: (s: string) => s,
		blue: (s: string) => s,
		green: (s: string) => s,
		red: (s: string) => s,
		yellow: (s: string) => s,
		dim: (s: string) => s,
	},
}));

import OrgShow from '../../../../../src/cli/dashboard/org/show.js';
import OrgUpdate from '../../../../../src/cli/dashboard/org/update.js';

// oclif's Command.parse() calls this.config.runHook internally
const oclifConfig = {
	runHook: vi.fn().mockResolvedValue({ successes: [], failures: [] }),
};

const sampleOrg = {
	id: 'org-uuid-123',
	name: 'My Organization',
};

function makeClient(overrides: Record<string, unknown> = {}) {
	return {
		organization: {
			get: { query: vi.fn().mockResolvedValue(sampleOrg) },
			update: { mutate: vi.fn().mockResolvedValue(undefined) },
		},
		...overrides,
	};
}

const baseConfig = { serverUrl: 'http://localhost:3000', sessionToken: 'tok' };

// ---------------------------------------------------------------------------
// org show
// ---------------------------------------------------------------------------
describe('OrgShow (show)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('calls client.organization.get.query', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new OrgShow([], oclifConfig as never);
		await cmd.run();

		expect(client.organization.get.query).toHaveBeenCalledWith();
	});

	it('outputs json when --json flag is set', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new OrgShow(['--json'], oclifConfig as never);
		await cmd.run();

		expect(client.organization.get.query).toHaveBeenCalledWith();
	});

	it('handles null org response gracefully', async () => {
		const client = makeClient();
		(client.organization.get.query as ReturnType<typeof vi.fn>).mockResolvedValue(null);
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new OrgShow([], oclifConfig as never);
		await expect(cmd.run()).resolves.toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// org update
// ---------------------------------------------------------------------------
describe('OrgUpdate (update)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('passes --name flag to client.organization.update.mutate', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new OrgUpdate(['--name', 'New Org Name'], oclifConfig as never);
		await cmd.run();

		expect(client.organization.update.mutate).toHaveBeenCalledWith({ name: 'New Org Name' });
	});

	it('outputs json when --json flag is set', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new OrgUpdate(['--name', 'New Org Name', '--json'], oclifConfig as never);
		await cmd.run();

		expect(client.organization.update.mutate).toHaveBeenCalledWith({ name: 'New Org Name' });
	});

	it('requires --name flag', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new OrgUpdate([], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});
