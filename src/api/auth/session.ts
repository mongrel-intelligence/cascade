import {
	type DashboardUser,
	getSessionByToken,
	getUserById,
} from '../../db/repositories/usersRepository.js';

/** The user behind a session token plus the session's active-org pointer. */
export interface ResolvedSession {
	user: DashboardUser;
	/**
	 * The org this session is currently acting in (spec 021 plan 2). `null` when
	 * the session predates a switch or the org was deleted — effective-org
	 * resolution falls back to the user's home org so nobody is logged out.
	 */
	activeOrgId: string | null;
}

export async function resolveUserFromSession(token: string): Promise<ResolvedSession | null> {
	const session = await getSessionByToken(token);
	if (!session) return null;
	const user = await getUserById(session.userId);
	if (!user) return null;
	return { user, activeOrgId: session.activeOrgId ?? null };
}
