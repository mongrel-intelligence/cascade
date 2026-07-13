/**
 * JIRA authentication mode — shared type + env-var normalization.
 *
 * `authType` is a NON-secret connection setting (mirrors `baseUrl`, NOT a
 * credential role) that selects which host in-worker JIRA REST calls route
 * through:
 *   - `'basic'`  — classic site-token mode (host = the project `baseUrl`). The
 *                  historical default; every pre-MNG-1736 config maps here.
 *   - `'scoped'` — scoped gateway-token mode (host = the scoped Atlassian
 *                  gateway). Both modes still authenticate via HTTP Basic
 *                  `email:api_token` (confirmed live in MNG-1735) — the enum
 *                  distinguishes the effective host, not the auth scheme.
 *
 * The worker/CLI credential scope carries this value across process boundaries
 * via the `CASCADE_JIRA_AUTH_TYPE` env var (injected by
 * `secretBuilder.augmentProjectSecrets`). `normalizeJiraAuthType` validates a
 * raw env-var string back into the `'basic' | 'scoped'` domain, falling back to
 * `'basic'` for absent/unknown values so existing projects keep working
 * untouched (MNG-1741; see the MNG-1735 research note on the card).
 */

export type JiraAuthType = 'basic' | 'scoped';

/**
 * Normalize a raw `CASCADE_JIRA_AUTH_TYPE` env-var value into the
 * `'basic' | 'scoped'` domain. Absent, empty, or unrecognized values fall back
 * to `'basic'` — preserving pre-MNG-1736 behavior for projects that never set
 * an explicit auth mode.
 */
export function normalizeJiraAuthType(value: string | undefined | null): JiraAuthType {
	return value === 'scoped' ? 'scoped' : 'basic';
}
