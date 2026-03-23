import { getSentryClient } from '../../../sentry/client.js';
import { formatSentryEventList } from './format.js';

export async function listSentryEvents(
	organizationId: string,
	issueId: string,
	limit = 5,
): Promise<string> {
	const client = getSentryClient();
	const events = await client.listIssueEvents(organizationId, issueId, { limit });
	return formatSentryEventList(events);
}
