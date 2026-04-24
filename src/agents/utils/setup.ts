import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';

import { runCommand as execCommand } from '../../utils/repo.js';

// ============================================================================
// Log Level Configuration
// ============================================================================

export const LOG_LEVELS: Record<string, number> = {
	silly: 0,
	trace: 1,
	debug: 2,
	info: 3,
	warn: 4,
	error: 5,
	fatal: 6,
};

export function getLogLevel(): number {
	const level =
		process.env.LLMIST_LOG_LEVEL?.toLowerCase() || process.env.LOG_LEVEL?.toLowerCase() || 'debug';
	return LOG_LEVELS[level] ?? LOG_LEVELS.debug;
}

// ============================================================================
// Context Files (CLAUDE.md, AGENTS.md)
// ============================================================================

export interface ContextFile {
	path: string;
	content: string;
}

/**
 * Checks whether two context files are duplicates — either because one is a
 * symlink pointing at the other, or because their trimmed content is identical.
 *
 * The symlink check is a fast path: `lstat` does NOT follow symlinks, so it
 * reliably detects the symlink target. The content comparison is the fallback
 * for copy-paste duplicates or cases where `lstat`/`readlink` fail.
 */
function areDuplicateContextFiles(cwd: string, a: ContextFile, b: ContextFile): boolean {
	// Fast path: check if one file is a symlink pointing to the other
	try {
		const aPath = join(cwd, a.path);
		const bPath = join(cwd, b.path);
		const aStat = lstatSync(aPath);
		const bStat = lstatSync(bPath);

		if (aStat.isSymbolicLink()) {
			const target = readlinkSync(aPath);
			if (target === b.path || join(cwd, target) === bPath) return true;
		}
		if (bStat.isSymbolicLink()) {
			const target = readlinkSync(bPath);
			if (target === a.path || join(cwd, target) === aPath) return true;
		}
	} catch {
		// Fall through to content comparison on permission errors or race conditions
	}

	// Fallback: compare trimmed content strings
	return a.content === b.content;
}

export async function readContextFiles(cwd: string): Promise<ContextFile[]> {
	const files = ['CLAUDE.md', 'AGENTS.md'];
	const results: ContextFile[] = [];

	for (const file of files) {
		try {
			const result = await execCommand('cat', [file], cwd);
			if (result.stdout.trim()) {
				results.push({ path: file, content: result.stdout.trim() });
			}
		} catch {
			// File doesn't exist, skip
		}
	}

	// Deduplicate: when both files exist and have identical content (or one is a
	// symlink of the other), keep only the CLAUDE.md entry (canonical reference).
	if (results.length === 2 && areDuplicateContextFiles(cwd, results[0], results[1])) {
		return [results[0]];
	}

	return results;
}

// ============================================================================
// Dependency Installation
// ============================================================================

export interface DependencyInstallResult {
	packageManager: string;
	success: boolean;
	output: string;
	error?: string;
}

export async function installDependencies(cwd: string): Promise<DependencyInstallResult | null> {
	// Check if package.json exists
	const packageJsonPath = join(cwd, 'package.json');
	if (!existsSync(packageJsonPath)) {
		return null; // No package.json, skip
	}

	// Detect package manager from lockfiles (priority order)
	const lockfiles = [
		{ file: 'bun.lockb', pm: 'bun' },
		{ file: 'pnpm-lock.yaml', pm: 'pnpm' },
		{ file: 'yarn.lock', pm: 'yarn' },
		{ file: 'package-lock.json', pm: 'npm' },
	];

	let packageManager = 'npm'; // default

	for (const { file, pm } of lockfiles) {
		if (existsSync(join(cwd, file))) {
			packageManager = pm;
			break;
		}
	}

	// Check packageManager field in package.json as fallback
	if (packageManager === 'npm') {
		try {
			const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
			if (pkg.packageManager) {
				const match = pkg.packageManager.match(/^(npm|yarn|pnpm|bun)@/);
				if (match) {
					packageManager = match[1];
				}
			}
		} catch {
			// Ignore parse errors
		}
	}

	// Run install command with CI=true to skip unnecessary postinstall downloads.
	// PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD prevents repos with Playwright from
	// downloading browsers inside the worker container.
	try {
		const result = await execCommand(packageManager, ['install'], cwd, {
			CI: 'true',
			PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
		});
		return {
			packageManager,
			success: true,
			output: result.stdout + result.stderr,
		};
	} catch (err) {
		return {
			packageManager,
			success: false,
			output: '',
			error: String(err),
		};
	}
}

// ============================================================================
// TypeScript Cache Warming
// ============================================================================

export interface TypeScriptWarmResult {
	success: boolean;
	durationMs: number;
	error?: string;
}

export async function warmTypeScriptCache(cwd: string): Promise<TypeScriptWarmResult | null> {
	// Check if tsconfig.json exists
	const tsconfigPath = join(cwd, 'tsconfig.json');
	if (!existsSync(tsconfigPath)) {
		return null; // No TypeScript config, skip
	}

	const startTime = Date.now();

	try {
		// Run tsc --noEmit to warm the cache without generating output files
		// We don't care if there are type errors - the agent will handle those
		await execCommand('npx', ['tsc', '--noEmit'], cwd);
		return {
			success: true,
			durationMs: Date.now() - startTime,
		};
	} catch (err) {
		// TypeScript errors are expected - the agent may need to fix them
		// We still warmed the cache, so consider this a success
		return {
			success: true,
			durationMs: Date.now() - startTime,
			error: String(err),
		};
	}
}
