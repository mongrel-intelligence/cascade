/**
 * Syntactic validation for a Docker image reference (spec 022 plan 3/4).
 *
 * The set-image mutation validates the operator-supplied reference grammar
 * SYNCHRONOUSLY (rejecting malformed refs with `BAD_REQUEST`, nothing persisted)
 * before recording it as `pending` and enqueueing the router-side validation job
 * that actually pulls + smoke-tests the image. This is a cheap structural gate,
 * not a guarantee the image exists — that is the router handler's job.
 *
 * The grammar follows the canonical distribution reference spec (a simplified,
 * validation-only subset):
 *
 *   reference := name [ ":" tag ] [ "@" digest ]
 *   name      := [ domain "/" ] path-component ("/" path-component)*
 *   domain    := domain-component ("." domain-component)* [ ":" port ]
 *   tag       := [\w][\w.-]{0,127}
 *   digest    := algorithm ":" hex(>=32)
 *
 * Path components are lowercase (matching Docker), so obviously-bad input like
 * "Not A Ref!!" (spaces, uppercase, "!") is rejected.
 */

const ALPHANUMERIC = '[a-z0-9]+';
const SEPARATOR = '(?:[._]|__|[-]+)';
const PATH_COMPONENT = `${ALPHANUMERIC}(?:${SEPARATOR}${ALPHANUMERIC})*`;
const DOMAIN_COMPONENT = '(?:[a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9])';
const PORT = '(?::[0-9]+)?';
const DOMAIN = `${DOMAIN_COMPONENT}(?:\\.${DOMAIN_COMPONENT})*${PORT}`;
const NAME = `(?:${DOMAIN}\\/)?${PATH_COMPONENT}(?:\\/${PATH_COMPONENT})*`;
const TAG = '[\\w][\\w.-]{0,127}';
const DIGEST = '[A-Za-z][A-Za-z0-9]*(?:[-_+.][A-Za-z][A-Za-z0-9]*)*:[0-9a-fA-F]{32,}';

const IMAGE_REFERENCE_RE = new RegExp(`^${NAME}(?::${TAG})?(?:@${DIGEST})?$`);

/** Hard cap so a pathological input can't drive catastrophic regex backtracking. */
const MAX_REFERENCE_LENGTH = 512;

/**
 * Returns true when `ref` is a syntactically valid Docker image reference.
 *
 * Trims surrounding whitespace; an empty/whitespace-only string, any internal
 * whitespace, or an over-long input is invalid.
 */
export function isValidImageReference(ref: string): boolean {
	if (typeof ref !== 'string') return false;
	const trimmed = ref.trim();
	if (trimmed.length === 0 || trimmed.length > MAX_REFERENCE_LENGTH) return false;
	if (/\s/.test(trimmed)) return false;
	return IMAGE_REFERENCE_RE.test(trimmed);
}
