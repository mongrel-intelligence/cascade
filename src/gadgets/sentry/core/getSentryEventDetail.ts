import { getSentryClient } from '../../../sentry/client.js';
import { formatSentryEvent } from './format.js';

export async function getSentryEventDetail(
	organizationId: string,
	issueId: string,
	eventId = 'latest',
): Promise<string> {
	const client = getSentryClient();
	const event = await client.getIssueEvent(organizationId, issueId, eventId);
	const issue = await client.getIssue(organizationId, issueId).catch(() => undefined);
	return formatSentryEvent(event, issue);
}
