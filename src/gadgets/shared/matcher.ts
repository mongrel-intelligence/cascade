/**
 * Backward compatibility re-exports from the modular matcher implementation.
 * This file maintains the existing API while delegating to the refactored modules.
 */

export {
	adjustIndentation,
	applyReplacement,
	findAllMatches,
	findMatch,
	formatContext,
	getMatchFailure,
} from './matcher/index.js';
