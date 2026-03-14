/**
 * Re-export shim — implementation moved to shared module.
 * Kept for backward compatibility.
 */
export {
	buildInlineContextSection,
	cleanupContextFiles,
	offloadLargeContext,
} from '../shared/contextFiles.js';

export type { ContextOffloadResult, OffloadedFile } from '../shared/contextFiles.js';
