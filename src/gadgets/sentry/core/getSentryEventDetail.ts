import { getSentryClient } from '../../../sentry/client.js';
import { formatSentryEvent } from './format.js';

export async function getSentryEventDetail(
	organizationId: string,
	issueId: string,
	eventId = 'latest',
): Promise<string> {
	const client = getSentryClient();
	const event = await client.getIssueEvent(organizationId, issueId, eventId);
	return formatSentryEvent(event);
}
