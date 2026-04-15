/**
 * ListDirectory gadget - List files and directories with gitignore support.
 *
 * By default, excludes files matching .gitignore patterns.
 * Use includeGitIgnored=true to include all files.
 */
import { execSync } from 'node:child_process';
import { type Stats, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { Gadget, z } from 'llmist';

import { hasListedDirectory, markDirectoryListed } from './readTracking.js';
import { validatePath } from './shared/pathValidation.js';

interface FileEntry {
	relativePath: string;
	type: 'file' | 'directory';
	size: number;
	modified: Date;
}

function formatAge(date: Date): string {
	const now = Date.now();
	const diffMs = now - date.getTime();
	const diffSec = Math.floor(diffMs / 1000);
	const diffMin = Math.floor(diffSec / 60);
	const diffHour = Math.floor(diffMin / 60);
	const diffDay = Math.floor(diffHour / 24);

	if (diffDay > 0) return `${diffDay}d`;
	if (diffHour > 0) return `${diffHour}h`;
	if (diffMin > 0) return `${diffMin}m`;
	return `${diffSec}s`;
}

function encodeName(name: string): string {
	// Escape pipe characters in names
	return name.replace(/\|/g, '\\|');
}

function isGitRepo(cwd: string): boolean {
	try {
		execSync('git rev-parse --git-dir', { cwd, stdio: 'pipe' });
		return true;
	} catch {
		return false;
	}
}

function getGitFiles(basePath: string, maxDepth: number): Set<string> {
	const files = new Set<string>();

	try {
		// Get tracked files
		const tracked = execSync('git ls-files', {
			cwd: basePath,
			encoding: 'utf-8',
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		// Get untracked but not ignored files
		const untracked = execSync('git ls-files --others --exclude-standard', {
			cwd: basePath,
			encoding: 'utf-8',
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		const allFiles = [...tracked.split('\n'), ...untracked.split('\n')].filter(Boolean);

		for (const file of allFiles) {
			// Check depth
			const depth = file.split('/').length;
			if (depth <= maxDepth) {
				files.add(file);
			}

			// Also add parent directories up to maxDepth
			const parts = file.split('/');
			for (let i = 1; i < parts.length && i <= maxDepth; i++) {
				const dirPath = parts.slice(0, i).join('/');
				files.add(`${dirPath}/`); // Mark as directory with trailing slash
			}
		}
	} catch {
		// Git command failed, return empty set
	}

	return files;
}

function shouldIncludeInGitFilter(relativePath: string, gitFiles: Set<string>): boolean {
	const asDir = `${relativePath}/`;
	if (gitFiles.has(relativePath) || gitFiles.has(asDir)) {
		return true;
	}
	// Check if any git file is under this directory
	for (const gitFile of gitFiles) {
		if (gitFile.startsWith(asDir)) {
			return true;
		}
	}
	return false;
}

function processDirectoryEntry(
	fullPath: string,
	relativePath: string,
	stats: Stats,
	entries: FileEntry[],
	basePath: string,
	maxDepth: number,
	currentDepth: number,
	gitFiles: Set<string> | null,
): void {
	entries.push({
		relativePath,
		type: 'directory',
		size: 0,
		modified: stats.mtime,
	});

	if (currentDepth < maxDepth) {
		const subEntries = listFilesRecursive(fullPath, basePath, maxDepth, currentDepth + 1, gitFiles);
		entries.push(...subEntries);
	}
}

function listFilesRecursive(
	dirPath: string,
	basePath: string,
	maxDepth: number,
	currentDepth: number,
	gitFiles: Set<string> | null,
): FileEntry[] {
	const entries: FileEntry[] = [];

	if (currentDepth > maxDepth) {
		return entries;
	}

	try {
		const items = readdirSync(dirPath);

		for (const item of items) {
			if (item.startsWith('.')) continue;

			const fullPath = join(dirPath, item);
			const relativePath = relative(basePath, fullPath);

			if (gitFiles !== null && !shouldIncludeInGitFilter(relativePath, gitFiles)) {
				continue;
			}

			try {
				const stats = statSync(fullPath);

				if (stats.isDirectory()) {
					processDirectoryEntry(
						fullPath,
						relativePath,
						stats,
						entries,
						basePath,
						maxDepth,
						currentDepth,
						gitFiles,
					);
				} else if (stats.isFile()) {
					entries.push({
						relativePath,
						type: 'file',
						size: stats.size,
						modified: stats.mtime,
					});
				}
			} catch {
				// Skip files we can't stat
			}
		}
	} catch {
		// Skip directories we can't read
	}

	return entries;
}

function formatEntries(entries: FileEntry[]): string {
	// Sort: directories first, then files, alphabetically within each group
	const sorted = entries.sort((a, b) => {
		if (a.type !== b.type) {
			return a.type === 'directory' ? -1 : 1;
		}
		return a.relativePath.localeCompare(b.relativePath);
	});

	const header = '#T|N|S|A';
	const rows = sorted.map((e) => {
		const typeCode = e.type === 'directory' ? 'D' : 'F';
		return `${typeCode}|${encodeName(e.relativePath)}|${e.size}|${formatAge(e.modified)}`;
	});

	return [header, ...rows].join('\n');
}

export class ListDirectory extends Gadget({
	name: 'ListDirectory',
	description: `List files and directories with full details (names, types, sizes, modification dates).

By default, excludes files matching .gitignore patterns (node_modules, build outputs, etc.).
Set includeGitIgnored=true to include all files.

Use maxDepth to explore subdirectories recursively.

Allowed paths:
- Current working directory and subdirectories
- /tmp directory`,
	schema: z.object({
		comment: z.string().min(1).describe('Brief rationale for this gadget call'),
		directoryPath: z.string().default('.').describe('Path to the directory to list'),
		maxDepth: z
			.number()
			.int()
			.min(1)
			.max(10)
			.default(1)
			.describe('Maximum depth to recurse (1 = immediate children only)'),
		includeGitIgnored: z
			.boolean()
			.default(false)
			.describe('Include files that match .gitignore patterns (default: false)'),
	}),
	examples: [
		{
			params: {
				comment: 'Getting overview of project structure',
				directoryPath: '.',
				maxDepth: 1,
				includeGitIgnored: false,
			},
			output:
				'path=. maxDepth=1 includeGitIgnored=false\n\n#T|N|S|A\nD|src|0|2h\nD|tests|0|1d\nF|package.json|2841|3h',
			comment: 'List current directory (excluding gitignored files)',
		},
		{
			params: {
				comment: 'Exploring src directory to find component files',
				directoryPath: 'src',
				maxDepth: 2,
				includeGitIgnored: true,
			},
			output:
				'path=src maxDepth=2 includeGitIgnored=true\n\n#T|N|S|A\nD|components|0|1d\nF|index.ts|512|1h',
			comment: 'List src directory including all files',
		},
	],
}) {
	override execute(params: this['params']): string {
		const { directoryPath, maxDepth, includeGitIgnored } = params;

		const validatedPath = validatePath(directoryPath);

		const stats = statSync(validatedPath);
		if (!stats.isDirectory()) {
			throw new Error(`Path is not a directory: ${directoryPath}`);
		}

		// Create a key that includes all parameters to differentiate listings
		const listingKey = `${validatedPath}:${maxDepth}:${includeGitIgnored}`;

		// Check if already listed in this session (content is in context)
		if (hasListedDirectory(listingKey)) {
			return `path=${directoryPath} maxDepth=${maxDepth} includeGitIgnored=${includeGitIgnored}\n\n[Already listed - refer to previous content in context]`;
		}

		// Determine if we should use git filtering
		let gitFiles: Set<string> | null = null;
		if (!includeGitIgnored && isGitRepo(validatedPath)) {
			gitFiles = getGitFiles(validatedPath, maxDepth);
		}

		const entries = listFilesRecursive(validatedPath, validatedPath, maxDepth, 1, gitFiles);
		const formatted = formatEntries(entries);

		markDirectoryListed(listingKey);
		return `path=${directoryPath} maxDepth=${maxDepth} includeGitIgnored=${includeGitIgnored}\n\n${formatted}`;
	}
}
