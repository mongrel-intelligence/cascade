import { distance } from 'fastest-levenshtein';

import type { EmitCliErrorOptions } from '../errorEnvelope.js';

const MAX_FLAG_SUGGESTION_DISTANCE = 2;
const MAX_FLAG_SUGGESTION_RATIO = 0.4;

/**
 * For the given unknown flag and the command's declared flag names + aliases,
 * return the Levenshtein-closest canonical declared name if it passes the
 * distance threshold; otherwise null.
 */
export function suggestFlag(
	unknown: string,
	candidates: { canonical: string; aliases: readonly string[] }[],
): string | null {
	let best: { canonical: string; dist: number } | null = null;
	for (const { canonical, aliases } of candidates) {
		for (const candidate of [canonical, ...aliases]) {
			const d = distance(unknown, candidate);
			if (best === null || d < best.dist) {
				best = { canonical, dist: d };
			}
		}
	}
	if (best === null) return null;
	const target = Math.max(unknown.length, best.canonical.length);
	if (best.dist > MAX_FLAG_SUGGESTION_DISTANCE) return null;
	if (target > 0 && best.dist / target > MAX_FLAG_SUGGESTION_RATIO) return null;
	return best.canonical;
}

/**
 * Detect whether an error coming out of `this.parse()` is oclif's
 * `NonExistentFlagsError`.
 */
export function isNonexistentFlagError(err: unknown): err is { flags: string[]; message: string } {
	if (!err || typeof err !== 'object') return false;
	const e = err as { name?: string; constructor?: { name?: string }; flags?: unknown };
	const ctorName = e.constructor?.name ?? '';
	const errName = e.name ?? '';
	const looksLikeCLIParse =
		errName === 'CLIParseError' ||
		errName === 'NonExistentFlagsError' ||
		ctorName === 'NonExistentFlagsError';
	return looksLikeCLIParse && Array.isArray(e.flags);
}

/**
 * Classify oclif parse-time errors into the structured CLI envelope contract.
 */
export function classifyParseError(
	err: unknown,
): Omit<EmitCliErrorOptions, 'stdout' | 'stderr' | 'exit'> | null {
	if (!err || typeof err !== 'object') return null;
	const e = err as { name?: string; constructor?: { name?: string }; message?: string };
	const ctorName = e.constructor?.name ?? '';
	const message = typeof e.message === 'string' ? e.message : '';

	if (ctorName === 'FailedFlagValidationError') {
		const m = message.match(/Missing required flag\s+([\w-]+)/);
		if (m) {
			return {
				type: 'missing-required',
				flag: m[1],
				message: `Missing required flag --${m[1]}`,
				hint: `pass --${m[1]} <value> (see --help for the full signature)`,
			};
		}
	}

	if (ctorName === 'FlagInvalidOptionError') {
		const m = message.match(/Expected --([\w-]+)=(\S+) to be one of:\s+(.+?)(?:\n|$)/);
		if (m) {
			return {
				type: 'enum-mismatch',
				flag: m[1],
				got: m[2],
				expected: m[3].trim(),
				message: `Flag --${m[1]} got '${m[2]}'; expected one of: ${m[3].trim()}`,
			};
		}
	}

	if (ctorName === 'UnexpectedArgsError') {
		const m = message.match(/Unexpected argument:\s+(.+?)(?:\n|$)/);
		if (m) {
			return {
				type: 'flag-parse',
				got: m[1].trim(),
				message,
			};
		}
	}

	if (ctorName.endsWith('Error') && /flag|argument|parse/i.test(message)) {
		return { type: 'flag-parse', message };
	}
	return null;
}
