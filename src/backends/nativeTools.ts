/**
 * Re-export shim — implementation moved to shared module.
 * Kept for backward compatibility.
 */
export {
	buildSystemPrompt,
	buildTaskPrompt,
	buildToolGuidance,
} from './shared/nativeToolPrompts.js';

export type { BuildTaskPromptResult } from './shared/nativeToolPrompts.js';
