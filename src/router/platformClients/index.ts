/**
 * Barrel export for the platform clients sub-module.
 *
 * Re-exports all public symbols from the focused sub-modules, preserving the
 * same public API surface as the original `platformClients.ts` monolith.
 * All existing imports (`from './platformClients.js'`) continue to work
 * unchanged since Node.js resolves `./platformClients/index.js` from the
 * directory path.
 */

export type { JiraCredentialsWithAuth, PlatformCommentClient, TrelloCredentials } from './types.js';
export {
	resolveGitHubHeaders,
	resolveJiraCredentials,
	resolveTrelloCredentials,
} from './credentials.js';
export { TrelloPlatformClient } from './trello.js';
export { GitHubPlatformClient } from './github.js';
export { JiraPlatformClient, _resetJiraCloudIdCache } from './jira.js';
