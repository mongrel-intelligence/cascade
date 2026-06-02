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

export interface SuggestionCandidate {
	name: string;
	/**
	 * Optional spelling to use for the ratio gate after the candidate wins by
	 * edit distance. Defaults to `name`.
	 */
	ratioBasis?: string;
}

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
 * (lowest) distance wins.
 */
export function suggestClosest(unknown: string, candidates: readonly string[]): string | null {
	const closest = suggestClosestCandidate(
		unknown,
		candidates.map((name) => ({ name })),
	);
	return closest?.name ?? null;
}

/**
 * Return the closest structured candidate using `name` for distance scoring.
 * `ratioBasis` lets callers keep legacy canonical-name gating while matching
 * aliases by edit distance.
 */
export function suggestClosestCandidate<TCandidate extends SuggestionCandidate>(
	unknown: string,
	candidates: readonly TCandidate[],
): TCandidate | null {
	let best: { candidate: TCandidate; dist: number } | null = null;
	for (const candidate of candidates) {
		const d = distance(unknown, candidate.name);
		if (best === null || d < best.dist) {
			best = { candidate, dist: d };
		}
	}
	if (best === null) return null;
	const ratioBasis = best.candidate.ratioBasis ?? best.candidate.name;
	const target = Math.max(unknown.length, ratioBasis.length);
	if (best.dist > MAX_SUGGESTION_DISTANCE) return null;
	if (target > 0 && best.dist / target > MAX_SUGGESTION_RATIO) return null;
	return best.candidate;
}
