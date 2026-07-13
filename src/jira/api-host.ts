/**
 * Shared JIRA REST v3 host resolver.
 *
 * Every REST v3 call site must route through `resolveJiraApiBaseUrl(creds)` so
 * scoped API tokens hit the Atlassian gateway consistently and no divergent
 * host-selection copies exist. Consuming this single resolver (rather than
 * hand-picking a host per call site) is the JIRA analogue of the shared
 * auth-header helper enforced by `auth-header-provenance.test.ts`.
 *
 * Host selection (confirmed live in MNG-1735):
 * - `authType` basic / absent ⇒ the tenant's site URL (`creds.baseUrl`, e.g.
 *   `https://acme.atlassian.net`). Classic site-token behavior, unchanged.
 * - `authType === 'scoped'`    ⇒ the Atlassian REST gateway URL
 *   `https://api.atlassian.com/ex/jira/{cloudId}`, where `cloudId` is resolved
 *   from the tenant's site `/_edge/tenant_info` endpoint and cached per
 *   `baseUrl` (via `jiraClient.getCloudId`).
 *
 * Note: both modes still authenticate via HTTP Basic with `email:api_token`;
 * `authType` selects the host, not the auth scheme. `accessible-resources` is
 * intentionally NOT used as a cloudId fallback for scoped API tokens — it is
 * OAuth 2.0 / 3LO guidance and returns 401 for scoped API tokens (MNG-1735).
 */

import { jiraClient } from './client.js';
import type { JiraCredentials } from './types.js';

/** Atlassian REST gateway origin used to route scoped API tokens. */
const ATLASSIAN_GATEWAY_ORIGIN = 'https://api.atlassian.com';

/**
 * Resolve the REST v3 base host for a set of JIRA credentials.
 *
 * @param creds - JIRA credentials, including the optional `authType`.
 * @returns For basic / absent auth, the tenant site URL (`creds.baseUrl`). For
 *   scoped auth, the Atlassian gateway URL
 *   `https://api.atlassian.com/ex/jira/{cloudId}`.
 */
export async function resolveJiraApiBaseUrl(creds: JiraCredentials): Promise<string> {
	if (creds.authType !== 'scoped') {
		return creds.baseUrl;
	}

	const cloudId = await jiraClient.getCloudId(creds);
	return `${ATLASSIAN_GATEWAY_ORIGIN}/ex/jira/${cloudId}`;
}
