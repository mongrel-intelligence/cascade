export interface JiraCredentials {
	email: string;
	apiToken: string;
	baseUrl: string;
	/**
	 * Optional JIRA authentication mode carried through `withJiraCredentials`.
	 * Non-secret config (mirrors `baseUrl`), NOT a separate credential role.
	 * `'basic'` = classic site-token mode; `'scoped'` = scoped gateway-token
	 * mode. Absent ⇒ treated as `'basic'`. Later stories consume this field.
	 */
	authType?: 'basic' | 'scoped';
}
