import type { JiraAuthType } from '../integrations/pm/jira/config-schema.js';

export type { JiraAuthType };

export interface JiraCredentials {
	email: string;
	apiToken: string;
	baseUrl: string;
	/**
	 * Optional JIRA authentication mode. Non-secret config (mirrors `baseUrl`),
	 * NOT a separate credential role. `'basic'` = classic site-token mode;
	 * `'scoped'` = scoped gateway-token mode. Absent ⇒ treated as `'basic'`.
	 *
	 * Reserved on the credentials shape so `withJiraCredentials` can carry it once
	 * a later story populates it — no call site sets it yet (`JiraIntegration.withCredentials`
	 * still builds `{ email, apiToken, baseUrl }` only). Later stories consume this field.
	 */
	authType?: JiraAuthType;
}
