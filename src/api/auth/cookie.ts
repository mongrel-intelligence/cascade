/**
 * Session cookie name, optionally suffixed with COOKIE_NAME_SUFFIX env var.
 *
 * Set COOKIE_NAME_SUFFIX=dev in the dev environment to avoid cookie conflicts
 * when both dev and prod dashboards share a parent domain
 * (e.g. dev.ca.sca.de.com and ca.sca.de.com).
 *
 * Without the env var the name is `cascade_session` — identical to the
 * previous hard-coded value, so existing production deployments are unaffected.
 */
const COOKIE_SUFFIX = process.env.COOKIE_NAME_SUFFIX;
export const SESSION_COOKIE_NAME = COOKIE_SUFFIX
	? `cascade_session_${COOKIE_SUFFIX}`
	: 'cascade_session';
