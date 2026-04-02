import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({
	existsSync: vi.fn(),
	readFileSync: vi.fn(),
}));

vi.mock('../../../../src/utils/repo.js', () => ({
	runCommand: vi.fn(),
}));

import { existsSync, readFileSync } from 'node:fs';
import {
	getLogLevel,
	installDependencies,
	LOG_LEVELS,
	readContextFiles,
	warmTypeScriptCache,
} from '../../../../src/agents/utils/setup.js';
import { runCommand } from '../../../../src/utils/repo.js';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockRunCommand = vi.mocked(runCommand);

beforeEach(() => {
	Reflect.deleteProperty(process.env, 'LLMIST_LOG_LEVEL');
	Reflect.deleteProperty(process.env, 'LOG_LEVEL');
});

afterEach(() => {
	Reflect.deleteProperty(process.env, 'LLMIST_LOG_LEVEL');
	Reflect.deleteProperty(process.env, 'LOG_LEVEL');
});

// ============================================================================
// getLogLevel
// ============================================================================

describe('getLogLevel', () => {
	it('returns debug level (2) by default when no env vars set', () => {
		expect(getLogLevel()).toBe(LOG_LEVELS.debug);
	});

	it('reads from LLMIST_LOG_LEVEL env var first', () => {
		process.env.LLMIST_LOG_LEVEL = 'info';
		expect(getLogLevel()).toBe(LOG_LEVELS.info);
	});

	it('reads from LOG_LEVEL env var when LLMIST_LOG_LEVEL is not set', () => {
		process.env.LOG_LEVEL = 'warn';
		expect(getLogLevel()).toBe(LOG_LEVELS.warn);
	});

	it('LLMIST_LOG_LEVEL takes precedence over LOG_LEVEL', () => {
		process.env.LLMIST_LOG_LEVEL = 'error';
		process.env.LOG_LEVEL = 'info';
		expect(getLogLevel()).toBe(LOG_LEVELS.error);
	});

	it('is case-insensitive', () => {
		process.env.LOG_LEVEL = 'DEBUG';
		expect(getLogLevel()).toBe(LOG_LEVELS.debug);
	});

	it('returns debug level for unknown log level strings', () => {
		process.env.LOG_LEVEL = 'unknown-level';
		expect(getLogLevel()).toBe(LOG_LEVELS.debug);
	});

	it('has correct numeric values for standard log levels', () => {
		expect(LOG_LEVELS.silly).toBe(0);
		expect(LOG_LEVELS.trace).toBe(1);
		expect(LOG_LEVELS.debug).toBe(2);
		expect(LOG_LEVELS.info).toBe(3);
		expect(LOG_LEVELS.warn).toBe(4);
		expect(LOG_LEVELS.error).toBe(5);
		expect(LOG_LEVELS.fatal).toBe(6);
	});
});

// ============================================================================
// readContextFiles
// ============================================================================

describe('readContextFiles', () => {
	it('returns CLAUDE.md and AGENTS.md content when both exist', async () => {
		mockRunCommand
			.mockResolvedValueOnce({ stdout: '# Claude docs', stderr: '' })
			.mockResolvedValueOnce({ stdout: '# Agents docs', stderr: '' });

		const result = await readContextFiles('/repo');

		expect(result).toEqual([
			{ path: 'CLAUDE.md', content: '# Claude docs' },
			{ path: 'AGENTS.md', content: '# Agents docs' },
		]);
	});

	it('skips files that produce empty stdout', async () => {
		mockRunCommand
			.mockResolvedValueOnce({ stdout: '', stderr: '' })
			.mockResolvedValueOnce({ stdout: '# Agents docs', stderr: '' });

		const result = await readContextFiles('/repo');

		expect(result).toEqual([{ path: 'AGENTS.md', content: '# Agents docs' }]);
	});

	it('skips files that throw (file not found)', async () => {
		mockRunCommand
			.mockRejectedValueOnce(new Error('ENOENT'))
			.mockResolvedValueOnce({ stdout: '# Agents docs', stderr: '' });

		const result = await readContextFiles('/repo');

		expect(result).toEqual([{ path: 'AGENTS.md', content: '# Agents docs' }]);
	});

	it('returns empty array when all files are missing', async () => {
		mockRunCommand.mockRejectedValue(new Error('ENOENT'));

		const result = await readContextFiles('/repo');

		expect(result).toEqual([]);
	});

	it('trims whitespace from file content', async () => {
		mockRunCommand
			.mockResolvedValueOnce({ stdout: '  # Claude docs  \n', stderr: '' })
			.mockRejectedValueOnce(new Error('ENOENT'));

		const result = await readContextFiles('/repo');

		expect(result[0].content).toBe('# Claude docs');
	});
});

// ============================================================================
// installDependencies
// ============================================================================

describe('installDependencies', () => {
	it('returns null when package.json does not exist', async () => {
		mockExistsSync.mockReturnValue(false);

		const result = await installDependencies('/repo');

		expect(result).toBeNull();
	});

	it('uses npm by default when no lockfile found', async () => {
		// package.json exists
		mockExistsSync.mockImplementation((path) => {
			return String(path).endsWith('package.json');
		});
		mockReadFileSync.mockReturnValue('{}' as never);
		mockRunCommand.mockResolvedValue({ stdout: 'installed', stderr: '' });

		const result = await installDependencies('/repo');

		expect(result?.packageManager).toBe('npm');
		expect(mockRunCommand).toHaveBeenCalledWith('npm', ['install'], '/repo', expect.any(Object));
	});

	it('detects pnpm from pnpm-lock.yaml', async () => {
		mockExistsSync.mockImplementation((path) => {
			const p = String(path);
			return p.endsWith('package.json') || p.endsWith('pnpm-lock.yaml');
		});
		mockRunCommand.mockResolvedValue({ stdout: '', stderr: '' });

		const result = await installDependencies('/repo');

		expect(result?.packageManager).toBe('pnpm');
	});

	it('detects yarn from yarn.lock', async () => {
		mockExistsSync.mockImplementation((path) => {
			const p = String(path);
			return p.endsWith('package.json') || p.endsWith('yarn.lock');
		});
		// pnpm-lock.yaml should not exist (checked first)
		mockRunCommand.mockResolvedValue({ stdout: '', stderr: '' });

		const result = await installDependencies('/repo');

		expect(result?.packageManager).toBe('yarn');
	});

	it('returns success=true when install succeeds', async () => {
		mockExistsSync.mockImplementation((path) => String(path).endsWith('package.json'));
		mockReadFileSync.mockReturnValue('{}' as never);
		mockRunCommand.mockResolvedValue({ stdout: 'ok', stderr: '' });

		const result = await installDependencies('/repo');

		expect(result?.success).toBe(true);
	});

	it('returns success=false when install throws', async () => {
		mockExistsSync.mockImplementation((path) => String(path).endsWith('package.json'));
		mockReadFileSync.mockReturnValue('{}' as never);
		mockRunCommand.mockRejectedValue(new Error('install failed'));

		const result = await installDependencies('/repo');

		expect(result?.success).toBe(false);
		expect(result?.error).toContain('install failed');
	});

	it('passes CI=true environment variable to install', async () => {
		mockExistsSync.mockImplementation((path) => String(path).endsWith('package.json'));
		mockReadFileSync.mockReturnValue('{}' as never);
		mockRunCommand.mockResolvedValue({ stdout: '', stderr: '' });

		await installDependencies('/repo');

		expect(mockRunCommand).toHaveBeenCalledWith(
			expect.any(String),
			['install'],
			'/repo',
			expect.objectContaining({ CI: 'true' }),
		);
	});

	it('reads packageManager field from package.json as fallback', async () => {
		mockExistsSync.mockImplementation((path) => String(path).endsWith('package.json'));
		mockReadFileSync.mockReturnValue(JSON.stringify({ packageManager: 'pnpm@8.0.0' }) as never);
		mockRunCommand.mockResolvedValue({ stdout: '', stderr: '' });

		const result = await installDependencies('/repo');

		expect(result?.packageManager).toBe('pnpm');
	});
});

// ============================================================================
// warmTypeScriptCache
// ============================================================================

describe('warmTypeScriptCache', () => {
	it('returns null when tsconfig.json does not exist', async () => {
		mockExistsSync.mockReturnValue(false);

		const result = await warmTypeScriptCache('/repo');

		expect(result).toBeNull();
	});

	it('runs tsc --noEmit when tsconfig.json exists', async () => {
		mockExistsSync.mockReturnValue(true);
		mockRunCommand.mockResolvedValue({ stdout: '', stderr: '' });

		await warmTypeScriptCache('/repo');

		expect(mockRunCommand).toHaveBeenCalledWith('npx', ['tsc', '--noEmit'], '/repo');
	});

	it('returns success=true when tsc succeeds', async () => {
		mockExistsSync.mockReturnValue(true);
		mockRunCommand.mockResolvedValue({ stdout: '', stderr: '' });

		const result = await warmTypeScriptCache('/repo');

		expect(result?.success).toBe(true);
		expect(result?.durationMs).toBeGreaterThanOrEqual(0);
	});

	it('returns success=true even when tsc fails (type errors expected)', async () => {
		mockExistsSync.mockReturnValue(true);
		mockRunCommand.mockRejectedValue(new Error('Type error in foo.ts'));

		const result = await warmTypeScriptCache('/repo');

		expect(result?.success).toBe(true);
		expect(result?.error).toContain('Type error in foo.ts');
	});

	it('includes durationMs in the result', async () => {
		mockExistsSync.mockReturnValue(true);
		mockRunCommand.mockResolvedValue({ stdout: '', stderr: '' });

		const result = await warmTypeScriptCache('/repo');

		expect(typeof result?.durationMs).toBe('number');
	});
});
