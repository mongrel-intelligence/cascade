import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({
	existsSync: vi.fn(),
	readFileSync: vi.fn(),
}));

import { existsSync, readFileSync } from 'node:fs';
import {
	type EnvSnapshot,
	loadCascadeEnv,
	parseEnvFile,
	unloadCascadeEnv,
} from '../../../src/utils/cascadeEnv.js';

const mockLog = {
	info: vi.fn(),
	warn: vi.fn(),
};

describe('cascadeEnv', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	describe('parseEnvFile', () => {
		it('parses KEY=VALUE lines', () => {
			const result = parseEnvFile('FOO=bar\nBAZ=qux');
			expect(result).toEqual(
				new Map([
					['FOO', 'bar'],
					['BAZ', 'qux'],
				]),
			);
		});

		it('skips blank lines and comments', () => {
			const result = parseEnvFile('FOO=bar\n\n# this is a comment\nBAZ=qux\n');
			expect(result).toEqual(
				new Map([
					['FOO', 'bar'],
					['BAZ', 'qux'],
				]),
			);
		});

		it('strips surrounding double quotes', () => {
			const result = parseEnvFile('FOO="hello world"');
			expect(result.get('FOO')).toBe('hello world');
		});

		it('strips surrounding single quotes', () => {
			const result = parseEnvFile("FOO='hello world'");
			expect(result.get('FOO')).toBe('hello world');
		});

		it('handles empty values', () => {
			const result = parseEnvFile('FOO=');
			expect(result.get('FOO')).toBe('');
		});

		it('handles = in values', () => {
			const result = parseEnvFile('FOO=a=b=c');
			expect(result.get('FOO')).toBe('a=b=c');
		});

		it('skips malformed lines without =', () => {
			const result = parseEnvFile('INVALID_LINE\nFOO=bar');
			expect(result.size).toBe(1);
			expect(result.get('FOO')).toBe('bar');
		});
	});

	describe('loadCascadeEnv', () => {
		it('returns null when no .cascade/env exists', () => {
			vi.mocked(existsSync).mockReturnValue(false);

			const result = loadCascadeEnv('/repo', mockLog);

			expect(result).toBeNull();
			expect(readFileSync).not.toHaveBeenCalled();
		});

		it('loads vars into process.env and returns snapshot', () => {
			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFileSync).mockReturnValue('CI=true\nNODE_ENV=test');

			const result = loadCascadeEnv('/repo', mockLog);

			expect(process.env.CI).toBe('true');
			expect(process.env.NODE_ENV).toBe('test');
			expect(result).not.toBeNull();
			expect(mockLog.info).toHaveBeenCalledWith('Loaded env vars from .cascade/env', {
				keys: ['CI', 'NODE_ENV'],
			});
		});

		it('tracks added vs overwritten keys in snapshot', () => {
			process.env.EXISTING_VAR = 'original';
			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFileSync).mockReturnValue('NEW_VAR=new\nEXISTING_VAR=changed');

			const result = loadCascadeEnv('/repo', mockLog);

			expect(result?.addedKeys).toEqual(['NEW_VAR']);
			expect(result?.overwritten).toEqual(new Map([['EXISTING_VAR', 'original']]));
			expect(process.env.NEW_VAR).toBe('new');
			expect(process.env.EXISTING_VAR).toBe('changed');
		});

		it('skips protected keys with warning', () => {
			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFileSync).mockReturnValue('GITHUB_TOKEN=hacked\nCASCADE_TEST_SAFE_VAR=yes');

			const result = loadCascadeEnv('/repo', mockLog);

			expect(process.env.GITHUB_TOKEN).not.toBe('hacked');
			expect(process.env.CASCADE_TEST_SAFE_VAR).toBe('yes');
			expect(mockLog.warn).toHaveBeenCalledWith('Skipping protected env var from .cascade/env', {
				key: 'GITHUB_TOKEN',
			});
			expect(result?.addedKeys).toEqual(['CASCADE_TEST_SAFE_VAR']);
		});

		it('returns null for empty file', () => {
			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFileSync).mockReturnValue('');

			const result = loadCascadeEnv('/repo', mockLog);

			expect(result).toBeNull();
		});

		it('returns null for file with only comments', () => {
			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFileSync).mockReturnValue('# just a comment\n# another');

			const result = loadCascadeEnv('/repo', mockLog);

			expect(result).toBeNull();
		});
	});

	describe('unloadCascadeEnv', () => {
		it('removes added keys', () => {
			process.env.ADDED_KEY = 'value';

			const snapshot: EnvSnapshot = {
				addedKeys: ['ADDED_KEY'],
				overwritten: new Map(),
			};

			unloadCascadeEnv(snapshot);

			expect(process.env.ADDED_KEY).toBeUndefined();
		});

		it('restores overwritten keys', () => {
			process.env.RESTORED_KEY = 'new-value';

			const snapshot: EnvSnapshot = {
				addedKeys: [],
				overwritten: new Map([['RESTORED_KEY', 'original-value']]),
			};

			unloadCascadeEnv(snapshot);

			expect(process.env.RESTORED_KEY).toBe('original-value');
		});

		it('is a no-op for null', () => {
			const envBefore = { ...process.env };

			unloadCascadeEnv(null);

			expect(process.env).toEqual(envBefore);
		});

		it('full round-trip: load then unload leaves process.env unchanged', () => {
			const envBefore = { ...process.env };

			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFileSync).mockReturnValue('ROUND_TRIP_VAR=hello');

			const snapshot = loadCascadeEnv('/repo', mockLog);

			expect(process.env.ROUND_TRIP_VAR).toBe('hello');

			unloadCascadeEnv(snapshot);

			expect(process.env.ROUND_TRIP_VAR).toBeUndefined();
			expect(process.env).toEqual(envBefore);
		});
	});
});
