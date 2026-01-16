/**
 * Shared tracking for file and directory reads within an agent session.
 *
 * Prevents duplicate reads of the same files/directories since their content
 * is already in the context. Cleared on compaction when context is summarized.
 */

const readFiles = new Set<string>();
const listedDirectories = new Set<string>();

/**
 * Check if a file has already been read in this session.
 */
export function hasReadFile(path: string): boolean {
	return readFiles.has(path);
}

/**
 * Mark a file as read.
 */
export function markFileRead(path: string): void {
	readFiles.add(path);
}

/**
 * Check if a directory has already been listed in this session.
 * Key includes path + maxDepth + includeGitIgnored to differentiate listings.
 */
export function hasListedDirectory(key: string): boolean {
	return listedDirectories.has(key);
}

/**
 * Mark a directory listing as done.
 */
export function markDirectoryListed(key: string): void {
	listedDirectories.add(key);
}

/**
 * Invalidate read tracking for a specific file.
 * Called after EditFile or WriteFile modifies a file.
 */
export function invalidateFileRead(path: string): void {
	readFiles.delete(path);
}

/**
 * Clear all read tracking. Called on context compaction.
 */
export function clearReadTracking(): void {
	readFiles.clear();
	listedDirectories.clear();
}
