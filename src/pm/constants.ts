/**
 * PM provider constants shared across the config layer.
 *
 * Centralises the provider → identifier-key mapping so that
 * `configRepository.ts`, `router/config.ts`, and any future callers
 * only need to update one place when a new PM provider is added.
 */

/**
 * Maps a PM provider name to the JSONB field that uniquely identifies
 * a project in that provider's `project_integrations.config`.
 *
 * | Provider | Identifier key  |
 * |----------|-----------------|
 * | trello   | boardId         |
 * | jira     | projectKey      |
 * | linear   | teamId          |
 */
export const PM_IDENTIFIER_KEYS: Record<string, string> = {
	trello: 'boardId',
	jira: 'projectKey',
	linear: 'teamId',
};
