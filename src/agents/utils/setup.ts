import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runCommand as execCommand } from '../../utils/repo.js';

// ============================================================================
// Log Level Configuration
// ============================================================================

export const LOG_LEVELS: Record<string, number> = {
	trace: 0,
	debug: 1,
	info: 2,
	warn: 3,
	error: 4,
};

export function getLogLevel(): number {
	const level = process.env.LLMIST_LOG_LEVEL?.toLowerCase() || 'debug';
	return LOG_LEVELS[level] ?? LOG_LEVELS.debug;
}

// ============================================================================
// Context Files (CLAUDE.md, AGENTS.md)
// ============================================================================

export interface ContextFile {
	path: string;
	content: string;
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

	// Run install command with CI=true to skip unnecessary postinstall downloads
	// (e.g., camoufox browser download when it's already in the Docker image)
	// PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD skips camoufox-js browser download
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
