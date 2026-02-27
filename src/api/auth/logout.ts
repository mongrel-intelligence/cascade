import type { Context } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import { deleteSession } from '../../db/repositories/usersRepository.js';
import { SESSION_COOKIE_NAME } from './cookie.js';

export async function logoutHandler(c: Context) {
	const token = getCookie(c, SESSION_COOKIE_NAME);
	if (token) {
		await deleteSession(token);
	}

	const cookieDomain = process.env.COOKIE_DOMAIN;
	deleteCookie(c, SESSION_COOKIE_NAME, {
		path: '/',
		...(cookieDomain && { domain: cookieDomain }),
	});
	return c.json({ ok: true });
}
