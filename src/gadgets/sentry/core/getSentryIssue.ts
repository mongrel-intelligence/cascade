import { getSentryClient } from '../../../sentry/client.js';
import { formatSentryIssue } from './format.js';

export async function getSentryIssue(organizationId: string, issueId: string): Promise<string> {
	const client = getSentryClient();
	const issue = await client.getIssue(organizationId, issueId);
	return formatSentryIssue(issue);
}
