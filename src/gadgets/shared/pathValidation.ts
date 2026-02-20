/**
 * Path validation for file editing gadgets.
 *
 * Validates that file paths are within the current working directory
 * or allowed directories (e.g., /tmp).
 */

import { realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import { getWorkspaceDir } from '../../utils/repo.js';

const ALLOWED_PATHS = ['/tmp', getWorkspaceDir()];

/**
 * Validate and resolve a file path.
 *
 * @param inputPath The input path (relative or absolute)
 * @returns The validated absolute path
 * @throws Error if the path is outside allowed directories
 */
export function validatePath(inputPath: string): string {
	const cwd = process.cwd();
	const resolvedPath = resolve(cwd, inputPath);

	let finalPath: string;
	try {
		finalPath = realpathSync(resolvedPath);
	} catch (error) {
		const nodeError = error as NodeJS.ErrnoException;
		if (nodeError.code === 'ENOENT') {
			finalPath = resolvedPath;
		} else {
			throw error;
		}
	}

	// Check if within CWD
	const cwdWithSep = cwd + sep;
	if (finalPath.startsWith(cwdWithSep) || finalPath === cwd) {
		return finalPath;
	}

	// Check if within allowed paths
	for (const allowedPath of ALLOWED_PATHS) {
		const allowedWithSep = allowedPath + sep;
		if (finalPath.startsWith(allowedWithSep) || finalPath === allowedPath) {
			return finalPath;
		}
	}

	throw new Error(
		`Path access denied: ${inputPath}. Path must be within working directory or allowed paths (${ALLOWED_PATHS.join(', ')})`,
	);
}
