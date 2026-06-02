import { distance } from 'fastest-levenshtein';

/**
 * Maximum Levenshtein distance allowed between an unknown input and a
 * suggested candidate. Distances above this are treated as "too far" and
 * suppress the suggestion entirely.
 */
export const MAX_SUGGESTION_DISTANCE = 2;

/**
 * Maximum ratio of (distance / longer length) between an unknown input and a
 * suggested candidate. Guards against weak matches on very short candidates
 * (e.g. a distance of 2 on a 3-letter word, which would otherwise pass the
 * distance gate but is statistically meaningless).
 */
export const MAX_SUGGESTION_RATIO = 0.4;

/**
 * Return the Levenshtein-closest candidate to `unknown`, provided the
 * distance falls within the suggestion budget (distance `<= 2` and ratio
 * `< 0.4` of the longer length). Returns `null` when no candidate is close
 * enough to be a plausible typo or when the candidate list is empty.
 *
 * The helper is intentionally pure and string-only so it can power flag
 * suggestions, command-name suggestions, and any other CLI ergonomics
 * without loading oclif command classes.
 *
 * Ties are broken by input order: the first candidate matching the best
 * (lowest) distance wins. Callers that need a canonical-vs-alias mapping
 * (e.g. `suggestFlag()`) should pass a flat name list and map the returned
 * string back to its canonical form themselves.
 */
export function suggestClosest(unknown: string, candidates: readonly string[]): string | null {
	let best: { name: string; dist: number } | null = null;
	for (const candidate of candidates) {
		const d = distance(unknown, candidate);
		if (best === null || d < best.dist) {
			best = { name: candidate, dist: d };
		}
	}
	if (best === null) return null;
	const target = Math.max(unknown.length, best.name.length);
	if (best.dist > MAX_SUGGESTION_DISTANCE) return null;
	if (target > 0 && best.dist / target > MAX_SUGGESTION_RATIO) return null;
	return best.name;
}
