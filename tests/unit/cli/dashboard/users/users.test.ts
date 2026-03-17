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

import UsersCreate from '../../../../../src/cli/dashboard/users/create.js';
import UsersDelete from '../../../../../src/cli/dashboard/users/delete.js';
import UsersList from '../../../../../src/cli/dashboard/users/list.js';
import UsersUpdate from '../../../../../src/cli/dashboard/users/update.js';

// oclif's Command.parse() calls this.config.runHook internally
const oclifConfig = {
	runHook: vi.fn().mockResolvedValue({ successes: [], failures: [] }),
};

const sampleUser = {
	id: 'user-uuid-123',
	email: 'test@example.com',
	name: 'Test User',
	role: 'member',
	createdAt: '2024-01-01T00:00:00.000Z',
};

function makeClient(overrides: Record<string, unknown> = {}) {
	return {
		users: {
			list: { query: vi.fn().mockResolvedValue([]) },
			create: { mutate: vi.fn().mockResolvedValue(sampleUser) },
			update: { mutate: vi.fn().mockResolvedValue(undefined) },
			delete: { mutate: vi.fn().mockResolvedValue(undefined) },
		},
		...overrides,
	};
}

const baseConfig = { serverUrl: 'http://localhost:3000', sessionToken: 'tok' };

// ---------------------------------------------------------------------------
// users list
// ---------------------------------------------------------------------------
describe('UsersList (list)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('calls client.users.list.query', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new UsersList([], oclifConfig as never);
		await cmd.run();

		expect(client.users.list.query).toHaveBeenCalledWith();
	});

	it('calls client.users.list.query with --json flag', async () => {
		const client = makeClient();
		(client.users.list.query as ReturnType<typeof vi.fn>).mockResolvedValue([sampleUser]);
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new UsersList(['--json'], oclifConfig as never);
		await cmd.run();

		expect(client.users.list.query).toHaveBeenCalledWith();
	});

	it('handles empty user list', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new UsersList([], oclifConfig as never);
		await expect(cmd.run()).resolves.toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// users create
// ---------------------------------------------------------------------------
describe('UsersCreate (create)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('passes --email, --password, --name flags to client.users.create.mutate', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new UsersCreate(
			['--email', 'test@example.com', '--password', 'secret123', '--name', 'Test User'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.users.create.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				email: 'test@example.com',
				password: 'secret123',
				name: 'Test User',
			}),
		);
	});

	it('defaults role to "member" when not specified', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new UsersCreate(
			['--email', 'test@example.com', '--password', 'secret123', '--name', 'Test User'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.users.create.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				role: 'member',
			}),
		);
	});

	it('passes --role flag to client.users.create.mutate', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new UsersCreate(
			[
				'--email',
				'admin@example.com',
				'--password',
				'secret123',
				'--name',
				'Admin User',
				'--role',
				'admin',
			],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.users.create.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				email: 'admin@example.com',
				name: 'Admin User',
				role: 'admin',
			}),
		);
	});

	it('outputs json when --json flag is set', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new UsersCreate(
			['--email', 'test@example.com', '--password', 'secret123', '--name', 'Test User', '--json'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.users.create.mutate).toHaveBeenCalled();
	});

	it('requires --email, --password, and --name flags', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new UsersCreate(['--email', 'test@example.com'], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// users update
// ---------------------------------------------------------------------------
describe('UsersUpdate (update)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('passes user ID with --name flag to client.users.update.mutate', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new UsersUpdate(['user-uuid-123', '--name', 'New Name'], oclifConfig as never);
		await cmd.run();

		expect(client.users.update.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'user-uuid-123',
				name: 'New Name',
			}),
		);
	});

	it('passes user ID with --email flag to client.users.update.mutate', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new UsersUpdate(
			['user-uuid-123', '--email', 'new@example.com'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.users.update.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'user-uuid-123',
				email: 'new@example.com',
			}),
		);
	});

	it('passes user ID with --role flag to client.users.update.mutate', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new UsersUpdate(['user-uuid-123', '--role', 'admin'], oclifConfig as never);
		await cmd.run();

		expect(client.users.update.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'user-uuid-123',
				role: 'admin',
			}),
		);
	});

	it('passes user ID with --password flag to client.users.update.mutate', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new UsersUpdate(
			['user-uuid-123', '--password', 'newpassword'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.users.update.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'user-uuid-123',
				password: 'newpassword',
			}),
		);
	});

	it('passes multiple partial flags together', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new UsersUpdate(
			['user-uuid-123', '--name', 'Updated Name', '--email', 'updated@example.com'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.users.update.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'user-uuid-123',
				name: 'Updated Name',
				email: 'updated@example.com',
			}),
		);
	});

	it('requires user ID argument', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new UsersUpdate(['--name', 'Test'], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// users delete
// ---------------------------------------------------------------------------
describe('UsersDelete (delete)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('passes user ID with --yes flag to client.users.delete.mutate', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new UsersDelete(['user-uuid-123', '--yes'], oclifConfig as never);
		await cmd.run();

		expect(client.users.delete.mutate).toHaveBeenCalledWith({ id: 'user-uuid-123' });
	});

	it('auto-accepts without --yes in non-TTY environments', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new UsersDelete(['user-uuid-123'], oclifConfig as never);
		await expect(cmd.run()).resolves.toBeUndefined();
		expect(client.users.delete.mutate).toHaveBeenCalledWith({ id: 'user-uuid-123' });
	});

	it('requires user ID argument', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new UsersDelete(['--yes'], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});
