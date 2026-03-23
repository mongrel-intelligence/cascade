/**
 * CORS configuration helper for the dashboard server.
 *
 * Selects the appropriate CORS middleware options based on environment:
 * - When CORS_ORIGIN is set: allow only those origins (comma-separated)
 * - When unset in production: warn and allow no origins (restrictive default)
 * - When unset outside production: default to localhost:5173 (dev convenience)
 */

import { cors } from 'hono/cors';

export interface CorsConfigOptions {
	corsOriginEnv: string | undefined;
	isProduction: boolean;
	warn?: (message: string) => void;
}

export interface CorsConfig {
	/** Resolved allowed origins for use in CORS middleware */
	origins: string | string[];
	/** Whether credentials are included in the CORS config */
	credentials: true;
}

/**
 * Resolves CORS middleware configuration based on environment.
 *
 * Returns a ready-to-use Hono `cors()` middleware configured for the current
 * environment:
 *  - If `corsOriginEnv` is set (comma-separated), only those origins are allowed.
 *  - If `corsOriginEnv` is unset in production, a warning is logged and an empty
 *    origin list is used (blocks all cross-origin requests).
 *  - If `corsOriginEnv` is unset outside production, `http://localhost:5173` is
 *    used as a dev-friendly default.
 */
export function buildCorsMiddleware({
	corsOriginEnv,
	isProduction,
	warn = console.warn,
}: CorsConfigOptions): ReturnType<typeof cors> {
	const origins = corsOriginEnv
		?.split(',')
		.map((o) => o.trim())
		.filter(Boolean);

	if (origins?.length) {
		return cors({ origin: origins, credentials: true });
	}

	if (isProduction) {
		warn(
			'[Dashboard] WARNING: CORS_ORIGIN is not set in production. ' +
				'Using restrictive default (no origins allowed). ' +
				'Set CORS_ORIGIN to your frontend URL (e.g., https://dashboard.example.com).',
		);
		return cors({ origin: [], credentials: true });
	}

	// Development default
	return cors({ origin: 'http://localhost:5173', credentials: true });
}
