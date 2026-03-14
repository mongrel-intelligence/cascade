import { cleanupLogDirectory, cleanupLogFile } from '../../utils/fileLogger.js';
import { clearWatchdogCleanup } from '../../utils/lifecycle.js';
import { logger } from '../../utils/logging.js';
import { cleanupTempDir } from '../../utils/repo.js';
import type { FileLogger } from './executionPipeline.js';

/**
 * Clean up temporary resources after agent execution.
 *
 * Shared by both the llmist lifecycle (agents/shared/lifecycle.ts) and the
 * adapter-based backends (backends/adapter.ts).
 *
 * @param repoDir - The temp repo directory to remove (null if not set up)
 * @param fileLogger - The file logger whose log files should be cleaned up
 * @param skipRepoDeletion - When true, skip removing the repoDir (e.g., for debug agents using a pre-existing logDir)
 */
export function cleanupAgentResources(
	repoDir: string | null,
	fileLogger: FileLogger,
	skipRepoDeletion = false,
): void {
	clearWatchdogCleanup();

	const isLocalMode = process.env.CASCADE_LOCAL_MODE === 'true';

	if (repoDir && !isLocalMode && !skipRepoDeletion) {
		try {
			cleanupTempDir(repoDir);
		} catch (err) {
			logger.warn('Failed to cleanup temp directory', { repoDir, error: String(err) });
		}
	}
	if (!isLocalMode) {
		cleanupLogFile(fileLogger.logPath);
		cleanupLogFile(fileLogger.engineLogPath);
		cleanupLogDirectory(fileLogger.llmCallLogger.logDir);
	}
}
