import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { buildCorsMiddleware } from '../../../src/utils/corsConfig.js';

/**
 * Helper: sends a cross-origin request to a minimal Hono app with the
 * given CORS middleware and returns the `Access-Control-Allow-Origin` header.
 */
async function fetchWithOrigin(
	middleware: ReturnType<typeof buildCorsMiddleware>,
	origin: string,
): Promise<Response> {
	const app = new Hono();
	app.use('*', middleware);
	app.get('/test', (c) => c.text('ok'));

	return app.request('/test', {
		method: 'GET',
		headers: { Origin: origin },
	});
}

describe('buildCorsMiddleware', () => {
	describe('when CORS_ORIGIN is set', () => {
		it('allows a single configured origin', async () => {
			const middleware = buildCorsMiddleware({
				corsOriginEnv: 'https://dashboard.example.com',
				isProduction: true,
			});

			const res = await fetchWithOrigin(middleware, 'https://dashboard.example.com');
			expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://dashboard.example.com');
		});

		it('allows the first of multiple comma-separated origins when matched', async () => {
			const middleware = buildCorsMiddleware({
				corsOriginEnv: 'https://app.example.com,https://dev.example.com',
				isProduction: true,
			});

			const res = await fetchWithOrigin(middleware, 'https://dev.example.com');
			expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://dev.example.com');
		});

		it('does not allow an origin not in the list', async () => {
			const middleware = buildCorsMiddleware({
				corsOriginEnv: 'https://dashboard.example.com',
				isProduction: true,
			});

			const res = await fetchWithOrigin(middleware, 'https://evil.example.com');
			// Hono cors returns null (no header) when origin is not allowed
			expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
		});

		it('trims whitespace around comma-separated origins', async () => {
			const middleware = buildCorsMiddleware({
				corsOriginEnv: '  https://app.example.com  ,  https://dev.example.com  ',
				isProduction: false,
			});

			const res = await fetchWithOrigin(middleware, 'https://app.example.com');
			expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
		});

		it('does not emit a production warning when CORS_ORIGIN is set', () => {
			const warn = vi.fn();
			buildCorsMiddleware({
				corsOriginEnv: 'https://dashboard.example.com',
				isProduction: true,
				warn,
			});

			expect(warn).not.toHaveBeenCalled();
		});
	});

	describe('when CORS_ORIGIN is not set AND NODE_ENV=production', () => {
		it('throws an error at startup', () => {
			expect(() =>
				buildCorsMiddleware({
					corsOriginEnv: undefined,
					isProduction: true,
				}),
			).toThrowError(/CORS_ORIGIN is not set/);
		});

		it('throws an error with an actionable message', () => {
			expect(() =>
				buildCorsMiddleware({
					corsOriginEnv: undefined,
					isProduction: true,
				}),
			).toThrowError(/Set CORS_ORIGIN to your frontend URL/);
		});
	});

	describe('when CORS_ORIGIN is not set AND NODE_ENV!=production', () => {
		it('defaults to localhost:5173 with credentials', async () => {
			const middleware = buildCorsMiddleware({
				corsOriginEnv: undefined,
				isProduction: false,
			});

			const res = await fetchWithOrigin(middleware, 'http://localhost:5173');
			expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
		});

		it('does not allow other origins when defaulting to localhost:5173', async () => {
			const middleware = buildCorsMiddleware({
				corsOriginEnv: undefined,
				isProduction: false,
			});

			const res = await fetchWithOrigin(middleware, 'https://evil.example.com');
			expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
		});

		it('does not log a warning in development', () => {
			const warn = vi.fn();
			buildCorsMiddleware({
				corsOriginEnv: undefined,
				isProduction: false,
				warn,
			});

			expect(warn).not.toHaveBeenCalled();
		});
	});
});
