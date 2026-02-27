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

import ProjectsIntegrationCredentialRm from '../../../../../src/cli/dashboard/projects/override-rm.js';
import ProjectsIntegrationCredentialSet from '../../../../../src/cli/dashboard/projects/override-set.js';
import ProjectsIntegrationCredentials from '../../../../../src/cli/dashboard/projects/overrides.js';

// oclif's Command.parse() calls this.config.runHook internally
const oclifConfig = {
	runHook: vi.fn().mockResolvedValue({ successes: [], failures: [] }),
};

function makeClient(overrides: Record<string, unknown> = {}) {
	return {
		projects: {
			integrationCredentials: {
				list: { query: vi.fn().mockResolvedValue([]) },
				set: { mutate: vi.fn().mockResolvedValue(undefined) },
				remove: { mutate: vi.fn().mockResolvedValue(undefined) },
			},
		},
		...overrides,
	};
}

const baseConfig = { serverUrl: 'http://localhost:3000', sessionToken: 'tok' };

describe('ProjectsIntegrationCredentials (overrides)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('queries pm, scm, and email categories by default', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsIntegrationCredentials(['my-project'], oclifConfig as never);
		await cmd.run();

		expect(client.projects.integrationCredentials.list.query).toHaveBeenCalledTimes(3);
		expect(client.projects.integrationCredentials.list.query).toHaveBeenCalledWith({
			projectId: 'my-project',
			category: 'pm',
		});
		expect(client.projects.integrationCredentials.list.query).toHaveBeenCalledWith({
			projectId: 'my-project',
			category: 'scm',
		});
		expect(client.projects.integrationCredentials.list.query).toHaveBeenCalledWith({
			projectId: 'my-project',
			category: 'email',
		});
	});

	it('queries only email when --category email is passed', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsIntegrationCredentials(
			['my-project', '--category', 'email'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.projects.integrationCredentials.list.query).toHaveBeenCalledTimes(1);
		expect(client.projects.integrationCredentials.list.query).toHaveBeenCalledWith({
			projectId: 'my-project',
			category: 'email',
		});
	});

	it('queries only pm when --category pm is passed', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsIntegrationCredentials(
			['my-project', '--category', 'pm'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.projects.integrationCredentials.list.query).toHaveBeenCalledTimes(1);
		expect(client.projects.integrationCredentials.list.query).toHaveBeenCalledWith({
			projectId: 'my-project',
			category: 'pm',
		});
	});

	it('queries only scm when --category scm is passed', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsIntegrationCredentials(
			['my-project', '--category', 'scm'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.projects.integrationCredentials.list.query).toHaveBeenCalledTimes(1);
		expect(client.projects.integrationCredentials.list.query).toHaveBeenCalledWith({
			projectId: 'my-project',
			category: 'scm',
		});
	});

	it('rejects unknown category values', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new ProjectsIntegrationCredentials(
			['my-project', '--category', 'billing'],
			oclifConfig as never,
		);
		await expect(cmd.run()).rejects.toThrow();
	});

	it('outputs email creds in JSON when --json flag is set', async () => {
		const creds = [{ role: 'gmail_refresh_token', credentialId: 5, credentialName: 'Gmail' }];
		const client = makeClient();
		(client.projects.integrationCredentials.list.query as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce([]) // pm
			.mockResolvedValueOnce([]) // scm
			.mockResolvedValueOnce(creds); // email
		mockCreateDashboardClient.mockReturnValue(client);
		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		const cmd = new ProjectsIntegrationCredentials(['my-project', '--json'], oclifConfig as never);
		await cmd.run();

		const output = JSON.parse(consoleSpy.mock.calls[0][0] as string) as unknown[];
		expect(output).toEqual(
			expect.arrayContaining([expect.objectContaining({ category: 'email' })]),
		);
		consoleSpy.mockRestore();
	});
});

describe('ProjectsIntegrationCredentialSet (override-set)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('links an email credential role', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsIntegrationCredentialSet(
			['my-project', '--category', 'email', '--role', 'imap_password', '--credential-id', '7'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.projects.integrationCredentials.set.mutate).toHaveBeenCalledWith({
			projectId: 'my-project',
			category: 'email',
			role: 'imap_password',
			credentialId: 7,
		});
	});

	it('links a pm credential role', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsIntegrationCredentialSet(
			['my-project', '--category', 'pm', '--role', 'api_key', '--credential-id', '3'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.projects.integrationCredentials.set.mutate).toHaveBeenCalledWith({
			projectId: 'my-project',
			category: 'pm',
			role: 'api_key',
			credentialId: 3,
		});
	});

	it('links a scm credential role', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsIntegrationCredentialSet(
			['my-project', '--category', 'scm', '--role', 'implementer_token', '--credential-id', '1'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.projects.integrationCredentials.set.mutate).toHaveBeenCalledWith({
			projectId: 'my-project',
			category: 'scm',
			role: 'implementer_token',
			credentialId: 1,
		});
	});

	it('rejects unknown category values', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new ProjectsIntegrationCredentialSet(
			['my-project', '--category', 'billing', '--role', 'key', '--credential-id', '1'],
			oclifConfig as never,
		);
		await expect(cmd.run()).rejects.toThrow();
	});
});

describe('ProjectsIntegrationCredentialRm (override-rm)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('unlinks an email credential role', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsIntegrationCredentialRm(
			['my-project', '--category', 'email', '--role', 'imap_password'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.projects.integrationCredentials.remove.mutate).toHaveBeenCalledWith({
			projectId: 'my-project',
			category: 'email',
			role: 'imap_password',
		});
	});

	it('unlinks a pm credential role', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsIntegrationCredentialRm(
			['my-project', '--category', 'pm', '--role', 'api_key'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.projects.integrationCredentials.remove.mutate).toHaveBeenCalledWith({
			projectId: 'my-project',
			category: 'pm',
			role: 'api_key',
		});
	});

	it('unlinks a scm credential role', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsIntegrationCredentialRm(
			['my-project', '--category', 'scm', '--role', 'reviewer_token'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.projects.integrationCredentials.remove.mutate).toHaveBeenCalledWith({
			projectId: 'my-project',
			category: 'scm',
			role: 'reviewer_token',
		});
	});

	it('rejects unknown category values', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new ProjectsIntegrationCredentialRm(
			['my-project', '--category', 'billing', '--role', 'key'],
			oclifConfig as never,
		);
		await expect(cmd.run()).rejects.toThrow();
	});
});
