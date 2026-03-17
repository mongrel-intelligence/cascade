import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSaveConfig = vi.fn();
const mockClearConfig = vi.fn();
const mockLoadConfig = vi.fn();
const mockCreateDashboardClient = vi.fn();

vi.mock('../../../../src/cli/dashboard/_shared/config.js', () => ({
	saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
	clearConfig: (...args: unknown[]) => mockClearConfig(...args),
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

import Login from '../../../../src/cli/dashboard/login.js';
import Logout from '../../../../src/cli/dashboard/logout.js';
import Whoami from '../../../../src/cli/dashboard/whoami.js';

// oclif's Command.parse() calls this.config.runHook internally
const oclifConfig = {
	runHook: vi.fn().mockResolvedValue({ successes: [], failures: [] }),
};

// Helper to create a mock fetch response
function mockFetchResponse(opts: {
	ok: boolean;
	status?: number;
	json?: unknown;
	setCookie?: string;
	error?: string;
}): Response {
	const { ok, status = 200, json, setCookie, error } = opts;
	const headers = new Headers();
	if (setCookie) {
		headers.set('set-cookie', setCookie);
	}
	return {
		ok,
		status,
		headers,
		json: vi.fn().mockResolvedValue(json ?? (error ? { error } : {})),
	} as unknown as Response;
}

describe('Login command', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn());
	});

	it('success path: saves config with serverUrl, sessionToken, cookieName, and orgId extracted from Set-Cookie header', async () => {
		const mockFetch = vi.mocked(fetch);
		mockFetch.mockResolvedValue(
			mockFetchResponse({
				ok: true,
				setCookie: 'cascade_session=abc123; Path=/; HttpOnly',
				json: { email: 'user@example.com', name: 'Test User' },
			}),
		);

		const cmd = new Login(
			['--server', 'http://localhost:3001', '--email', 'user@example.com', '--password', 'secret'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(mockSaveConfig).toHaveBeenCalledWith({
			serverUrl: 'http://localhost:3001',
			sessionToken: 'abc123',
			cookieName: 'cascade_session',
			orgId: undefined,
		});
	});

	it('failure path: throws with error message from server response', async () => {
		const mockFetch = vi.mocked(fetch);
		mockFetch.mockResolvedValue(
			mockFetchResponse({
				ok: false,
				status: 401,
				json: { error: 'Invalid credentials' },
			}),
		);

		const cmd = new Login(
			['--server', 'http://localhost:3001', '--email', 'user@example.com', '--password', 'wrong'],
			oclifConfig as never,
		);
		await expect(cmd.run()).rejects.toThrow('Invalid credentials');
	});

	it('org flag is passed through to saveConfig', async () => {
		const mockFetch = vi.mocked(fetch);
		mockFetch.mockResolvedValue(
			mockFetchResponse({
				ok: true,
				setCookie: 'cascade_session=tok999; Path=/; HttpOnly',
				json: { email: 'admin@example.com', name: 'Admin' },
			}),
		);

		const cmd = new Login(
			[
				'--server',
				'http://localhost:3001',
				'--email',
				'admin@example.com',
				'--password',
				'secret',
				'--org',
				'my-org',
			],
			oclifConfig as never,
		);
		await cmd.run();

		expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'my-org' }));
	});

	it('trailing slash is stripped from --server URL', async () => {
		const mockFetch = vi.mocked(fetch);
		mockFetch.mockResolvedValue(
			mockFetchResponse({
				ok: true,
				setCookie: 'cascade_session=tok123; Path=/; HttpOnly',
				json: { email: 'user@example.com', name: 'User' },
			}),
		);

		const cmd = new Login(
			['--server', 'http://localhost:3001/', '--email', 'user@example.com', '--password', 'secret'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(mockSaveConfig).toHaveBeenCalledWith(
			expect.objectContaining({ serverUrl: 'http://localhost:3001' }),
		);
		expect(mockFetch).toHaveBeenCalledWith(
			'http://localhost:3001/api/auth/login',
			expect.anything(),
		);
	});

	it('failure path: uses generic message when server response has no error field', async () => {
		const mockFetch = vi.mocked(fetch);
		mockFetch.mockResolvedValue(
			mockFetchResponse({
				ok: false,
				status: 503,
				json: {},
			}),
		);

		const cmd = new Login(
			['--server', 'http://localhost:3001', '--email', 'user@example.com', '--password', 'secret'],
			oclifConfig as never,
		);
		await expect(cmd.run()).rejects.toThrow('Login failed (503)');
	});

	it('errors when no session cookie is returned on success', async () => {
		const mockFetch = vi.mocked(fetch);
		mockFetch.mockResolvedValue(
			mockFetchResponse({
				ok: true,
				// No set-cookie header
				json: { email: 'user@example.com', name: 'User' },
			}),
		);

		const cmd = new Login(
			['--server', 'http://localhost:3001', '--email', 'user@example.com', '--password', 'secret'],
			oclifConfig as never,
		);
		await expect(cmd.run()).rejects.toThrow();
	});
});

describe('Logout command', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn());
	});

	it('calls clearConfig and logs success message', async () => {
		mockLoadConfig.mockReturnValue(null);
		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		const cmd = new Logout([], oclifConfig as never);
		await cmd.run();

		expect(mockClearConfig).toHaveBeenCalled();
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Logged out'));
		consoleSpy.mockRestore();
	});

	it('makes best-effort server-side logout fetch (ignores errors)', async () => {
		mockLoadConfig.mockReturnValue({
			serverUrl: 'http://localhost:3001',
			sessionToken: 'tok123',
			cookieName: 'cascade_session',
		});
		const mockFetch = vi.mocked(fetch);
		mockFetch.mockRejectedValue(new Error('Network error'));

		const cmd = new Logout([], oclifConfig as never);
		// Should not throw even though fetch fails
		await expect(cmd.run()).resolves.toBeUndefined();
		expect(mockClearConfig).toHaveBeenCalled();
	});

	it('calls clearConfig even when config is null (no active session)', async () => {
		mockLoadConfig.mockReturnValue(null);
		const mockFetch = vi.mocked(fetch);

		const cmd = new Logout([], oclifConfig as never);
		await cmd.run();

		// Should not attempt to fetch when there is no config
		expect(mockFetch).not.toHaveBeenCalled();
		expect(mockClearConfig).toHaveBeenCalled();
	});

	it('sends logout request using the cookie name from config', async () => {
		mockLoadConfig.mockReturnValue({
			serverUrl: 'http://localhost:3001',
			sessionToken: 'mysessiontoken',
			cookieName: 'cascade_session_development',
		});
		const mockFetch = vi.mocked(fetch);
		mockFetch.mockResolvedValue({ ok: true } as Response);

		const cmd = new Logout([], oclifConfig as never);
		await cmd.run();

		expect(mockFetch).toHaveBeenCalledWith(
			'http://localhost:3001/api/auth/logout',
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({
					Cookie: 'cascade_session_development=mysessiontoken',
				}),
			}),
		);
	});
});

describe('Whoami command', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue({
			serverUrl: 'http://localhost:3001',
			sessionToken: 'tok',
		});
	});

	function makeClient(userOverrides: Record<string, unknown> = {}) {
		return {
			auth: {
				me: {
					query: vi.fn().mockResolvedValue({
						name: 'Test User',
						email: 'user@example.com',
						role: 'admin',
						orgId: 'my-org',
						...userOverrides,
					}),
				},
			},
		};
	}

	it('queries client.auth.me and displays table output', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);
		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		const cmd = new Whoami([], oclifConfig as never);
		await cmd.run();

		expect(client.auth.me.query).toHaveBeenCalled();
		// Table output: should include labels
		const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
		expect(output).toContain('Name');
		expect(output).toContain('Email');
		expect(output).toContain('Role');
		consoleSpy.mockRestore();
	});

	it('outputs JSON when --json flag is set', async () => {
		const user = {
			name: 'Test User',
			email: 'user@example.com',
			role: 'admin',
			orgId: 'my-org',
		};
		const client = makeClient(user);
		mockCreateDashboardClient.mockReturnValue(client);
		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		const cmd = new Whoami(['--json'], oclifConfig as never);
		await cmd.run();

		expect(client.auth.me.query).toHaveBeenCalled();
		// JSON output: first call should be JSON
		const jsonOutput = consoleSpy.mock.calls[0]?.[0];
		expect(() => JSON.parse(jsonOutput)).not.toThrow();
		const parsed = JSON.parse(jsonOutput);
		expect(parsed.email).toBe('user@example.com');
		consoleSpy.mockRestore();
	});

	it('shows effectiveOrgId when it differs from orgId', async () => {
		const client = makeClient({
			orgId: 'my-org',
			effectiveOrgId: 'other-org',
		});
		mockCreateDashboardClient.mockReturnValue(client);
		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		const cmd = new Whoami([], oclifConfig as never);
		await cmd.run();

		expect(client.auth.me.query).toHaveBeenCalled();
		const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
		expect(output).toContain('Effective Org');
		consoleSpy.mockRestore();
	});

	it('does not show effectiveOrgId when it equals orgId', async () => {
		const client = makeClient({
			orgId: 'my-org',
			effectiveOrgId: 'my-org',
		});
		mockCreateDashboardClient.mockReturnValue(client);
		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		const cmd = new Whoami([], oclifConfig as never);
		await cmd.run();

		const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
		expect(output).not.toContain('Effective Org');
		consoleSpy.mockRestore();
	});
});
