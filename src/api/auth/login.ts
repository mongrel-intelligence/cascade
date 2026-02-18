import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import type { Context } from 'hono';
import { setCookie } from 'hono/cookie';
import { createSession, getUserByEmail } from '../../db/repositories/usersRepository.js';

const SESSION_EXPIRY_DAYS = 30;

export async function loginHandler(c: Context) {
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

	const token = randomBytes(64).toString('hex');
	const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

	await createSession(user.id, token, expiresAt);

	const isProduction = process.env.NODE_ENV === 'production';
	const cookieDomain = process.env.COOKIE_DOMAIN;
	setCookie(c, 'cascade_session', token, {
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
