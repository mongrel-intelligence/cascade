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

import ProjectsCredentialsDelete from '../../../../../src/cli/dashboard/projects/credentials-delete.js';
import ProjectsCredentialsList from '../../../../../src/cli/dashboard/projects/credentials-list.js';
import ProjectsCredentialsSet from '../../../../../src/cli/dashboard/projects/credentials-set.js';

// oclif's Command.parse() calls this.config.runHook internally
const oclifConfig = {
	runHook: vi.fn().mockResolvedValue({ successes: [], failures: [] }),
};

function makeClient(overrides: Record<string, unknown> = {}) {
	return {
		projects: {
			credentials: {
				list: { query: vi.fn().mockResolvedValue([]) },
				set: { mutate: vi.fn().mockResolvedValue(undefined) },
				delete: { mutate: vi.fn().mockResolvedValue(undefined) },
			},
		},
		...overrides,
	};
}

const baseConfig = { serverUrl: 'http://localhost:3000', sessionToken: 'tok' };

describe('ProjectsCredentialsList (credentials-list)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('lists project credentials', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsCredentialsList(['my-project'], oclifConfig as never);
		await cmd.run();

		expect(client.projects.credentials.list.query).toHaveBeenCalledWith({
			projectId: 'my-project',
		});
	});

	it('outputs json when --json flag is set', async () => {
		const client = makeClient();
		(client.projects.credentials.list.query as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ envVarKey: 'GITHUB_TOKEN_IMPLEMENTER', name: 'Implementer', maskedValue: '****abc' },
		]);
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsCredentialsList(['my-project', '--json'], oclifConfig as never);
		await cmd.run();

		expect(client.projects.credentials.list.query).toHaveBeenCalledWith({
			projectId: 'my-project',
		});
	});
});

describe('ProjectsCredentialsSet (credentials-set)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('sets a project credential', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsCredentialsSet(
			['my-project', '--key', 'GITHUB_TOKEN_IMPLEMENTER', '--value', 'ghp_abc123'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.projects.credentials.set.mutate).toHaveBeenCalledWith({
			projectId: 'my-project',
			envVarKey: 'GITHUB_TOKEN_IMPLEMENTER',
			value: 'ghp_abc123',
			name: undefined,
		});
	});

	it('sets a project credential with a name', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsCredentialsSet(
			[
				'my-project',
				'--key',
				'GITHUB_TOKEN_REVIEWER',
				'--value',
				'ghp_def456',
				'--name',
				'Reviewer Bot',
			],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.projects.credentials.set.mutate).toHaveBeenCalledWith({
			projectId: 'my-project',
			envVarKey: 'GITHUB_TOKEN_REVIEWER',
			value: 'ghp_def456',
			name: 'Reviewer Bot',
		});
	});

	it('requires --key and --value flags', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new ProjectsCredentialsSet(['my-project'], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});

describe('ProjectsCredentialsDelete (credentials-delete)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('deletes a project credential with --yes', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsCredentialsDelete(
			['my-project', '--key', 'GITHUB_TOKEN_IMPLEMENTER', '--yes'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.projects.credentials.delete.mutate).toHaveBeenCalledWith({
			projectId: 'my-project',
			envVarKey: 'GITHUB_TOKEN_IMPLEMENTER',
		});
	});

	it('auto-accepts without --yes flag in non-TTY environments', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsCredentialsDelete(
			['my-project', '--key', 'GITHUB_TOKEN_IMPLEMENTER'],
			oclifConfig as never,
		);
		// In non-TTY environments (CI, piped), confirm() auto-accepts without prompting
		await expect(cmd.run()).resolves.toBeUndefined();
		expect(client.projects.credentials.delete.mutate).toHaveBeenCalledWith({
			projectId: 'my-project',
			envVarKey: 'GITHUB_TOKEN_IMPLEMENTER',
		});
	});

	it('requires --key flag', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new ProjectsCredentialsDelete(['my-project', '--yes'], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});
