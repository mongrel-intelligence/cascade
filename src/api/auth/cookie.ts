/**
 * Session cookie name, automatically suffixed with the environment name
 * when not running in production.
 *
 * In non-production environments (e.g. NODE_ENV=development) the cookie is
 * named `cascade_session_development`, which avoids cookie collisions when
 * dev and prod dashboards share a parent domain
 * (e.g. dev.ca.sca.de.com and ca.sca.de.com).
 *
 * In production (or when NODE_ENV is unset) the name is `cascade_session` —
 * identical to the previous hard-coded value, so existing deployments are
 * unaffected.
 */
const nodeEnv = process.env.NODE_ENV;
export const SESSION_COOKIE_NAME =
	nodeEnv && nodeEnv !== 'production' ? `cascade_session_${nodeEnv}` : 'cascade_session';
