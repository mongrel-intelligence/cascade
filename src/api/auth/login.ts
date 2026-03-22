import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import type { Context } from 'hono';
import { setCookie } from 'hono/cookie';
import { createSession, getUserByEmail } from '../../db/repositories/usersRepository.js';
import { SESSION_COOKIE_NAME } from './cookie.js';
import { checkRateLimit, recordSuccessfulLogin } from './rateLimiter.js';

const SESSION_EXPIRY_DAYS = 30;

/**
 * Extract the client IP from a Hono context.
 * Checks x-forwarded-for first (for reverse-proxy deployments), then falls
 * back to the raw remote address.
 */
function getClientIp(c: Context): string {
	const forwarded = c.req.header('x-forwarded-for');
	if (forwarded) {
		// x-forwarded-for may contain a comma-separated list; take the first value
		return forwarded.split(',')[0].trim();
	}
	// Hono exposes the raw Request; in Node.js the remote address isn't directly
	// available on Request, so fall back to a sentinel value that still works for
	// rate limiting purposes in environments that don't set x-forwarded-for.
	return 'unknown';
}

export async function loginHandler(c: Context) {
	const ip = getClientIp(c);

	// Rate-limit check (before parsing credentials to avoid wasted work)
	const rateCheck = checkRateLimit(ip);
	if (rateCheck.limited) {
		c.header('Retry-After', String(rateCheck.retryAfterSeconds));
		return c.json({ error: 'Too many login attempts. Please try again later.' }, 429);
	}

	const body = await c.req.json<{ email?: string; password?: string }>();
	if (!body.email || !body.password) {
		return c.json({ error: 'Email and password are required' }, 400);
	}

	const user = await getUserByEmail(body.email);
	if (!user) {
		return c.json({ error: 'Invalid credentials' }, 401);
	}

	const valid = await bcrypt.compare(body.password, user.passwordHash);
	if (!valid) {
		return c.json({ error: 'Invalid credentials' }, 401);
	}

	// Successful login — reset the rate-limit counter for this IP
	recordSuccessfulLogin(ip);

	const token = randomBytes(64).toString('hex');
	const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

	await createSession(user.id, token, expiresAt);

	const isProduction = process.env.NODE_ENV === 'production';
	const cookieDomain = process.env.COOKIE_DOMAIN;
	setCookie(c, SESSION_COOKIE_NAME, token, {
		httpOnly: true,
		sameSite: 'Lax',
		secure: isProduction,
		path: '/',
		maxAge: SESSION_EXPIRY_DAYS * 24 * 60 * 60,
		...(cookieDomain && { domain: cookieDomain }),
	});

	return c.json({
		id: user.id,
		email: user.email,
		name: user.name,
		role: user.role,
	});
}
