import {
	type DashboardUser,
	getSessionByToken,
	getUserById,
} from '../../db/repositories/usersRepository.js';

export async function resolveUserFromSession(token: string): Promise<DashboardUser | null> {
	const session = await getSessionByToken(token);
	if (!session) return null;
	return getUserById(session.userId);
}
