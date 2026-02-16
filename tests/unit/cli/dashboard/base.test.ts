import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoadConfig = vi.fn();
const mockCreateDashboardClient = vi.fn();

vi.mock('../../../../src/cli/dashboard/_shared/config.js', () => ({
	loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
}));

vi.mock('../../../../src/cli/dashboard/_shared/client.js', () => ({
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

import { DashboardCommand } from '../../../../src/cli/dashboard/_shared/base.js';

// Concrete subclass for testing
class TestCommand extends DashboardCommand {
	static override id = 'test';
	static override description = 'Test command';

	async run(): Promise<void> {
		// Access client to trigger lazy initialization
		const _client = this.client;
	}
}

class TestErrorCommand extends DashboardCommand {
	static override id = 'test-error';
	static override description = 'Test error command';

	errorToThrow: unknown = null;

	async run(): Promise<void> {
		this.handleError(this.errorToThrow as Error);
	}
}

describe('DashboardCommand', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('config loading', () => {
		it('errors when not logged in (no config)', async () => {
			mockLoadConfig.mockReturnValue(null);

			const cmd = new TestCommand([], {} as never);
			await expect(cmd.run()).rejects.toThrow('Not logged in');
		});

		it('creates client from loaded config', async () => {
			const config = { serverUrl: 'http://localhost:3000', sessionToken: 'tok' };
			mockLoadConfig.mockReturnValue(config);
			mockCreateDashboardClient.mockReturnValue({});

			const cmd = new TestCommand([], {} as never);
			await cmd.run();

			expect(mockCreateDashboardClient).toHaveBeenCalledWith(config);
		});
	});

	describe('outputJson', () => {
		it('prints JSON to console', () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

			const cmd = new TestCommand([], {} as never);
			cmd.outputJson({ hello: 'world' });

			expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({ hello: 'world' }, null, 2));
			consoleSpy.mockRestore();
		});
	});

	describe('handleError', () => {
		it('shows login message for UNAUTHORIZED tRPC errors', async () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			// Simulate TRPCClientError shape
			const err = Object.assign(new Error('UNAUTHORIZED'), {
				data: { code: 'UNAUTHORIZED' },
			});
			// Manually set constructor name to match instanceof check
			Object.defineProperty(err.constructor, 'name', { value: 'TRPCClientError' });

			const cmd = new TestErrorCommand([], {} as never);
			cmd.errorToThrow = err;

			// handleError calls this.error() which throws oclif CLIError
			await expect(cmd.run()).rejects.toThrow();
		});

		it('rethrows non-TRPCClientError errors', async () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const err = new TypeError('something else');

			const cmd = new TestErrorCommand([], {} as never);
			cmd.errorToThrow = err;

			await expect(cmd.run()).rejects.toThrow('something else');
		});
	});
});
