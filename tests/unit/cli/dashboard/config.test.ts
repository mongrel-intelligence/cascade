import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({
	existsSync: vi.fn(),
	mkdirSync: vi.fn(),
	readFileSync: vi.fn(),
	writeFileSync: vi.fn(),
}));

vi.mock('node:os', () => ({
	homedir: () => '/mock-home',
}));

import {
	clearConfig,
	loadConfig,
	saveConfig,
} from '../../../../src/cli/dashboard/_shared/config.js';

describe('config', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env = { ...originalEnv };
		process.env.CASCADE_SERVER_URL = undefined;
		process.env.CASCADE_SESSION_TOKEN = undefined;
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	describe('loadConfig', () => {
		it('returns env var config when both env vars are set', () => {
			process.env.CASCADE_SERVER_URL = 'http://env-server:3000';
			process.env.CASCADE_SESSION_TOKEN = 'env-token';

			const config = loadConfig();

			expect(config).toEqual({
				serverUrl: 'http://env-server:3000',
				sessionToken: 'env-token',
			});
			expect(existsSync).not.toHaveBeenCalled();
		});

		it('returns null when config file does not exist', () => {
			vi.mocked(existsSync).mockReturnValue(false);

			expect(loadConfig()).toBeNull();
		});

		it('reads config from file when no env vars set', () => {
			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFileSync).mockReturnValue(
				JSON.stringify({ serverUrl: 'http://localhost:3000', sessionToken: 'file-token' }),
			);

			const config = loadConfig();

			expect(config).toEqual({
				serverUrl: 'http://localhost:3000',
				sessionToken: 'file-token',
			});
			expect(readFileSync).toHaveBeenCalledWith(expect.stringContaining('cli.json'), 'utf-8');
		});

		it('returns null when file has incomplete config', () => {
			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ serverUrl: 'http://x' }));

			expect(loadConfig()).toBeNull();
		});

		it('returns null when file contains invalid JSON', () => {
			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFileSync).mockReturnValue('not json');

			expect(loadConfig()).toBeNull();
		});

		it('env var overrides file serverUrl but uses file sessionToken', () => {
			process.env.CASCADE_SERVER_URL = 'http://env-override:3000';
			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFileSync).mockReturnValue(
				JSON.stringify({ serverUrl: 'http://file:3000', sessionToken: 'file-token' }),
			);

			const config = loadConfig();

			expect(config).toEqual({
				serverUrl: 'http://env-override:3000',
				sessionToken: 'file-token',
			});
		});

		it('env var overrides file sessionToken but uses file serverUrl', () => {
			process.env.CASCADE_SESSION_TOKEN = 'env-token-override';
			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFileSync).mockReturnValue(
				JSON.stringify({ serverUrl: 'http://file:3000', sessionToken: 'file-token' }),
			);

			const config = loadConfig();

			expect(config).toEqual({
				serverUrl: 'http://file:3000',
				sessionToken: 'env-token-override',
			});
		});
	});

	describe('saveConfig', () => {
		it('creates config directory if it does not exist', () => {
			vi.mocked(existsSync).mockReturnValue(false);

			saveConfig({ serverUrl: 'http://x', sessionToken: 'tok' });

			expect(mkdirSync).toHaveBeenCalledWith(expect.stringContaining('.cascade'), {
				recursive: true,
			});
		});

		it('does not create directory if it already exists', () => {
			vi.mocked(existsSync).mockReturnValue(true);

			saveConfig({ serverUrl: 'http://x', sessionToken: 'tok' });

			expect(mkdirSync).not.toHaveBeenCalled();
		});

		it('writes JSON with trailing newline', () => {
			vi.mocked(existsSync).mockReturnValue(true);

			saveConfig({ serverUrl: 'http://localhost:3000', sessionToken: 'abc' });

			const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
			expect(written).toContain('"serverUrl"');
			expect(written).toContain('"sessionToken"');
			expect(written.endsWith('\n')).toBe(true);
			expect(JSON.parse(written)).toEqual({
				serverUrl: 'http://localhost:3000',
				sessionToken: 'abc',
			});
		});
	});

	describe('clearConfig', () => {
		it('writes empty object when config file exists', () => {
			vi.mocked(existsSync).mockReturnValue(true);

			clearConfig();

			expect(writeFileSync).toHaveBeenCalledWith(
				expect.stringContaining('cli.json'),
				'{}',
				'utf-8',
			);
		});

		it('does nothing when config file does not exist', () => {
			vi.mocked(existsSync).mockReturnValue(false);

			clearConfig();

			expect(writeFileSync).not.toHaveBeenCalled();
		});
	});
});
