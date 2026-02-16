import type { Context } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import { deleteSession } from '../../db/repositories/usersRepository.js';

export async function logoutHandler(c: Context) {
	const token = getCookie(c, 'cascade_session');
	if (token) {
		await deleteSession(token);
	}

	deleteCookie(c, 'cascade_session', { path: '/' });
	return c.json({ ok: true });
}
