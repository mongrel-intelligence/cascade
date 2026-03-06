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

import EmailIntegrationSet from '../../../../../src/cli/dashboard/email/integration-set.js';

// oclif's Command.parse() calls this.config.runHook internally
const oclifConfig = {
	runHook: vi.fn().mockResolvedValue({ successes: [], failures: [] }),
};

function makeClient() {
	return {
		projects: {
			integrations: {
				upsert: { mutate: vi.fn().mockResolvedValue(undefined) },
			},
		},
	};
}

const baseConfig = { serverUrl: 'http://localhost:3000', sessionToken: 'tok' };

describe('EmailIntegrationSet', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('upserts a gmail integration and prints oauth guidance', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const logMessages: string[] = [];
		const cmd = new EmailIntegrationSet(
			['my-project', '--provider', 'gmail'],
			oclifConfig as never,
		);
		vi.spyOn(cmd, 'log').mockImplementation((msg?: string) => {
			if (msg) logMessages.push(msg);
		});

		await cmd.run();

		expect(client.projects.integrations.upsert.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: 'my-project',
				category: 'email',
				provider: 'gmail',
			}),
		);

		const oauthGuidance = logMessages.find((m) => m.includes('cascade email oauth'));
		expect(oauthGuidance).toBeDefined();
	});

	it('upserts an imap integration and prints credential-set guidance with --category email', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const logMessages: string[] = [];
		const cmd = new EmailIntegrationSet(['my-project', '--provider', 'imap'], oclifConfig as never);
		vi.spyOn(cmd, 'log').mockImplementation((msg?: string) => {
			if (msg) logMessages.push(msg);
		});

		await cmd.run();

		expect(client.projects.integrations.upsert.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: 'my-project',
				category: 'email',
				provider: 'imap',
			}),
		);

		const credGuidance = logMessages.find((m) => m.includes('integration-credential-set'));
		expect(credGuidance).toBeDefined();
		expect(credGuidance).toContain('--category email');
	});

	it('upserts with custom config JSON', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new EmailIntegrationSet(
			['my-project', '--provider', 'imap', '--config', '{"host":"mail.example.com"}'],
			oclifConfig as never,
		);
		vi.spyOn(cmd, 'log').mockImplementation(() => {});
		await cmd.run();

		expect(client.projects.integrations.upsert.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				config: { host: 'mail.example.com' },
			}),
		);
	});

	it('errors on invalid JSON config', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new EmailIntegrationSet(
			['my-project', '--provider', 'imap', '--config', 'not-json'],
			oclifConfig as never,
		);
		await expect(cmd.run()).rejects.toThrow();
	});
});
