## Summary

Refactors `src/router/platformClients.ts` — a 367-line god module mixing 5 unrelated concerns — into a focused directory structure following the existing `pm/` layer pattern.

- **Extracts** `PlatformCommentClient` interface and `JiraCredentialsWithAuth` type into `platformClients/types.ts`
- **Extracts** credential resolution helpers (`resolveTrelloCredentials`, `resolveJiraCredentials`, `resolveGitHubHeaders`) into `platformClients/credentials.ts`
- **Extracts** `TrelloPlatformClient` class into `platformClients/trello.ts`
- **Extracts** `GitHubPlatformClient` class into `platformClients/github.ts`
- **Extracts** `JiraPlatformClient` + `_jiraCloudIdCache` + `_resetJiraCloudIdCache` into `platformClients/jira.ts`
- **Creates** `platformClients/index.ts` barrel that re-exports every previously-public symbol
- **Deletes** original `src/router/platformClients.ts` monolith
- **Updates** all 6 consumer import paths (acknowledgments, notifications, reactions, pre-actions, adapters/jira, adapters/trello) to `./platformClients/index.js` (required by TypeScript NodeNext module resolution)
- **Updates** test import path in `tests/unit/router/platformClients.test.ts`

Zero behavioral changes — public API surface is fully preserved via the barrel export.

## Test plan

- [x] All 17 existing `platformClients.test.ts` tests pass unchanged
- [x] All 300 router unit tests pass (acknowledgments, notifications, reactions, pre-actions, adapters, etc.)
- [x] `npm run typecheck` passes with zero errors
- [x] `npm run lint` passes (pre-existing warning in unrelated file)

Trello card: https://trello.com/c/uAgPL8o1/114-find-top-candidate-for-refactoring-and-plan-clean-refactoring-of-it-look-for-god-classes-modules-functions-files-code-duplicatio

🤖 Generated with [Claude Code](https://claude.com/claude-code)
