/**
 * Barrel export for the platform clients sub-module.
 *
 * Re-exports all public symbols from the focused sub-modules, preserving the
 * same public API surface as the original `platformClients.ts` monolith.
 * All existing imports (`from './platformClients.js'`) continue to work
 * unchanged since Node.js resolves `./platformClients/index.js` from the
 * directory path.
 */

export {
	resolveGitHubHeaders,
	resolveJiraCredentials,
	resolveTrelloCredentials,
} from './credentials.js';
export { GitHubPlatformClient } from './github.js';
export { _resetJiraCloudIdCache, JiraPlatformClient } from './jira.js';
export { TrelloPlatformClient } from './trello.js';
export type { JiraCredentialsWithAuth, PlatformCommentClient, TrelloCredentials } from './types.js';
