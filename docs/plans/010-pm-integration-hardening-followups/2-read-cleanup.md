---
id: 010
slug: pm-integration-hardening-followups
plan: 2
plan_slug: read-cleanup
level: plan
parent_spec: docs/specs/010-pm-integration-hardening-followups.md
depends_on: [1-mutations.md]
status: pending
---

# 010/2: Read Cleanup — Migrate Remaining PM Reads + `currentUser` + Restore Verification UX

> Part 2 of 3 in the 010-pm-integration-hardening-followups plan. See [parent spec](../../specs/010-pm-integration-hardening-followups.md).

## Summary

Finish the migration spec 009/5 started. Every per-provider read procedure still in `integrationsDiscovery.ts` (Trello boards / board details / by-project variants; JIRA projects / project details / by-project variants; Linear teams + by-project variant — roughly ten procedures total) gets routed through `pm.discover`. Callers in `pm-wizard-hooks.ts` migrate. The legacy procedures are deleted.

Same plan adds `currentUser` as a new `DiscoveryCapability` and implements it on all three providers. The wizard's "verify credentials" step is restored to the pre-009/5 UX — displaying the authenticated user's handle (e.g. "Verified as @username (Full Name)") — via the generic discover dispatch.

**Components delivered:**
- `src/pm/types.ts` — extend `DiscoveryCapability` union with `'currentUser'`; add `DiscoveryArgs<'currentUser'>` (empty) and `DiscoveryResult<'currentUser'>` (`{ id: string; name: string; displayName?: string }`).
- `src/integrations/pm/trello/manifest.ts` — declare `currentUser` in `discoveryCapabilities`; implement `discover('currentUser', {})` → `trelloClient.getMe()` mapped to `{ id, name: fullName, displayName: username }`.
- `src/integrations/pm/jira/manifest.ts` — declare `currentUser`; implement via `jiraClient.getMyself()` → `{ id: accountId, name: displayName, displayName: emailAddress }`.
- `src/integrations/pm/linear/manifest.ts` — declare `currentUser`; implement via `linearClient.getMe()` → `{ id, name, displayName }`.
- `tests/helpers/fakePMProvider.ts` — extend `createFakePMProvider` with `discover('currentUser')` returning a deterministic fixture.
- `web/src/components/projects/pm-wizard-hooks.ts` — update `useVerification` to call `pm.discovery.discover('currentUser')` after a successful credentials check (replacing the "found N boards/teams/projects" message). Migrate `useTrelloDiscovery`, `useJiraDiscovery`, `useLinearDiscovery` to route board/project/team reads through `pm.discover`.
- `src/api/routers/integrationsDiscovery.ts` — delete `trelloBoards`, `trelloBoardDetails`, `trelloBoardsByProject`, `trelloBoardDetailsByProject`, `jiraProjects`, `jiraProjectDetails`, `jiraProjectsByProject`, `jiraProjectDetailsByProject`, `linearTeams`, `linearTeamsByProject`. Add a jsdoc at the top: "Post-spec-010: SCM (GitHub) + alerting (Sentry) discovery only".
- `tests/unit/api/pm-discovery-legacy-removed.test.ts` — extend to assert the 10 read procedures are also **removed**.
- `tests/unit/integrations/pm-conformance.test.ts` — new behavioral group: for every manifest declaring `currentUser`, exercise the hook and assert the shape.
- `tests/unit/web/pm-wizard-verification.test.ts` — new file: verify the wizard's verification UX shows the username display (restored regression fix).

**Deferred to later plans in this spec:**
- Shared wizard step components — plan 3.
- `new-provider-surface` snapshot tightening — plan 3.
- Provider migration status table rewrite — plan 3.
- Root `CLAUDE.md` update + spec 009 forward-ref — plan 3.

---

## Spec ACs satisfied by this plan

- **Spec AC #3** (read discovery through single generic endpoint) — **full**
- **Spec AC #4** (`integrationsDiscovery.ts` is SCM+alerting only) — **full** — mutation cleanup from plan 1 + read cleanup here completes the AC
- **Spec AC #5** ("verified as @username" UX restored) — **full**
- **Spec AC #7** (conformance harness exercises mutations + `currentUser`) — **full** — `currentUser` conformance lands here; combined with plan 1's mutation conformance this AC is now fully covered
- **Spec AC #9, #10** — hygiene

---

## Depends On

- Plan 1 (`mutations`) — provides the `pm.discovery.createLabel` / `createCustomField` scaffolding. Plan 2 does not directly consume plan 1, but both plans touch `integrationsDiscovery.ts` and `pm-wizard-hooks.ts`; sequential ordering avoids merge conflicts on those files.

---

## Detailed Task List (TDD)

### 1. Extend `DiscoveryCapability` with `currentUser`

**Tests first** (`tests/unit/pm/types.test.ts` — extend existing):
- `DiscoveryCapability` accepts `'currentUser'` as a literal.
- `DiscoveryArgs<'currentUser'>` is `Record<string, never>` (no args).
- `DiscoveryResult<'currentUser'>` is `{ id: string; name: string; displayName?: string }`.

**Implementation** (`src/pm/types.ts`):
- Add `'currentUser'` to the `DiscoveryCapability` union.
- Add `K extends 'currentUser' ? Record<string, never> : ...` clause to `DiscoveryArgs<K>`.
- Add `K extends 'currentUser' ? { id: string; name: string; displayName?: string } : ...` clause to `DiscoveryResult<K>`.
- Order: `currentUser` sits between `containers` and the nested-under-container capabilities in the switch chain.

### 2. Trello: declare + implement `currentUser`

**Tests first** (`tests/unit/pm/trello/manifest-discovery.test.ts` — extend existing):
- `trelloManifest.discoveryCapabilities.currentUser` is `true`.
- `discover('currentUser', {})` calls `trelloClient.getMe()` and returns `{ id, name: fullName, displayName: username }`.

**Implementation** (`src/integrations/pm/trello/manifest.ts`):
- Add `currentUser: true` to `discoveryCapabilities`.
- Extend the `discover` switch to handle `'currentUser'`: `const me = await runWithCreds(() => trelloClient.getMe()); return { id: me.id, name: me.fullName, displayName: me.username }`.

### 3. JIRA: declare + implement `currentUser`

**Tests first** (`tests/unit/pm/jira/manifest-discovery.test.ts` — extend existing):
- `jiraManifest.discoveryCapabilities.currentUser` is `true`.
- `discover('currentUser', {})` returns `{ id: accountId, name: displayName, displayName: emailAddress }` from `jiraClient.getMyself()`.

**Implementation** (`src/integrations/pm/jira/manifest.ts`):
- Add `currentUser: true`.
- Extend `discover` switch: `const me = await runWithCreds(() => jiraClient.getMyself()); return { id: me.accountId ?? '', name: me.displayName ?? '', displayName: me.emailAddress }`.

### 4. Linear: declare + implement `currentUser`

**Tests first** (`tests/unit/pm/linear/manifest-discovery.test.ts` — extend existing):
- `linearManifest.discoveryCapabilities.currentUser` is `true`.
- `discover('currentUser', {})` returns `{ id, name, displayName }` from `linearClient.getMe()`.

**Implementation** (`src/integrations/pm/linear/manifest.ts`):
- Add `currentUser: true`.
- Extend `discover` switch: `const me = await runWithCreds(() => linearClient.getMe()); return { id: me.id, name: me.name, displayName: me.displayName }`.

### 5. Fake provider: implement `currentUser`

**Tests first** (`tests/unit/integrations/pm-fake-lifecycle.test.ts` — extend existing):
- `createFakePMProvider().provider.discover('currentUser', {})` returns `{ id: 'fake-user', name: 'Fake User', displayName: 'fake' }`.

**Implementation** (`tests/helpers/fakePMProvider.ts`):
- Extend the `discover` switch in `createFakePMProvider` to handle `'currentUser'` returning the fake's `getAuthenticatedUser()` equivalent in the `DiscoveryResult<'currentUser'>` shape.
- `createFakePMManifest().discoveryCapabilities.currentUser = true`.

### 6. Migrate wizard verification UX

**Tests first** (`tests/unit/web/pm-wizard-verification.test.ts` — new file):
- Mock `trpcClient.pm.discovery.discover` to return the fake's currentUser shape.
- Trigger the verify mutation — `SET_VERIFICATION` dispatch payload's `display` matches the expected format: `"Verified as @{displayName} ({name})"` for Trello, `"{name} ({displayName})"` for JIRA (email as secondary), `{displayName}` for Linear.

**Implementation** (`web/src/components/projects/pm-wizard-hooks.ts`):
- In `useVerification.mutationFn`, after the initial `pm.discovery.discover` call that proves credentials work, add a second call: `const me = await trpcClient.pm.discovery.discover.mutate({ providerId, capability: 'currentUser', args: {}, credentials })`. Return `{ provider, me }`.
- In `onSuccess`, compute a provider-specific display string from `me` and dispatch `SET_VERIFICATION` with the new shape. Remove the "Credentials verified — found N boards" fallback.
- Handle the case where `currentUser` returns a value missing `displayName`: fall back to `name` alone.

### 7. Migrate read-side callers: Trello boards / board details

**Tests first** (`tests/unit/web/pm-wizard-hooks-trello-reads.test.ts` — new file):
- `useTrelloDiscovery.boardsMutation` calls `pm.discovery.discover({ providerId: 'trello', capability: 'boards', credentials })`.
- Snapshot fixture matches pre-migration output shape so consumers don't break.

**Implementation** (`web/src/components/projects/pm-wizard-hooks.ts`):
- Replace `trpcClient.integrationsDiscovery.trelloBoards.mutate({ apiKey, token })` with `trpcClient.pm.discovery.discover.mutate({ providerId: 'trello', capability: 'boards', args: {}, credentials: { api_key, token } })`.
- Replace `trelloBoardDetails` + `trelloBoardsByProject` + `trelloBoardDetailsByProject` call sites. For the "by project" variants, resolve credentials from the project first (existing behavior) then call the generic endpoint.

### 8. Migrate read-side callers: JIRA projects / project details

**Tests first** (`tests/unit/web/pm-wizard-hooks-jira-reads.test.ts` — new file):
- `useJiraDiscovery.projectsMutation` calls `pm.discovery.discover({ providerId: 'jira', capability: 'projects', credentials })`.
- Project-details flow migrated.

**Implementation**:
- Replace the 4 JIRA call sites (`jiraProjects`, `jiraProjectDetails`, `jiraProjectsByProject`, `jiraProjectDetailsByProject`).

### 9. Migrate read-side callers: Linear teams

**Tests first** (`tests/unit/web/pm-wizard-hooks-linear-reads.test.ts` — new file):
- `useLinearDiscovery.teamsMutation` calls `pm.discovery.discover({ providerId: 'linear', capability: 'teams', credentials })`.
- `linearTeamsByProject` call site migrated.

**Implementation**:
- Replace the 2 Linear call sites (`linearTeams`, `linearTeamsByProject`).

### 10. Delete legacy read procedures

**Tests first** (`tests/unit/api/pm-discovery-legacy-removed.test.ts`):
- Assert each of the 10 read procedures is `undefined` on `integrationsDiscovery._def.procedures`.
- Update the describe blocks: the "deferred" block disappears entirely (all 5 mutations were deleted in plan 1); the new assertions cover the 10 reads.

**Implementation** (`src/api/routers/integrationsDiscovery.ts`):
- Delete `trelloBoards`, `trelloBoardDetails`, `trelloBoardsByProject`, `trelloBoardDetailsByProject`, `jiraProjects`, `jiraProjectDetails`, `jiraProjectsByProject`, `jiraProjectDetailsByProject`, `linearTeams`, `linearTeamsByProject`.
- Remove imports no longer referenced (`withTrelloCreds`, `withJiraCreds`, `withLinearCreds` unless SCM/Sentry use them).
- Add a jsdoc at the top of the file: "Post-spec-010 this router is SCM (GitHub) + alerting (Sentry) discovery only. All PM discovery flows through `pm.discovery.*`."

### 11. Update existing `integrationsDiscovery.test.ts`

**Tests first**:
- Remove the surviving tests for the 10 read procedures (mirror the pattern from plan 009/5 for `verify*` + plan 010/1 for mutations).
- Keep GitHub + Sentry tests intact.

**Implementation**:
- Delete `describe('trelloBoards')`, `describe('trelloBoardDetails')`, etc. from `tests/unit/api/routers/integrationsDiscovery.test.ts`.
- Leave a comment trail pointing to spec 010/2 for each deletion.

### 12. Conformance harness: `currentUser` group

**Tests first** (extend `tests/unit/integrations/pm-conformance.test.ts`):
- New `describe('behavioral: currentUser capability')` — for every manifest declaring `discoveryCapabilities.currentUser`, set up a mocked client fixture, call `discover('currentUser', {})`, assert the result has `id`, `name`, and optional `displayName` in the expected shape.

**Implementation**:
- Add the new describe block alongside the existing discovery-shape assertion.
- Wire the fake provider's `currentUser` fixture output as the expected baseline.

---

## Test Plan

### Unit tests
- [ ] `tests/unit/pm/types.test.ts` — +3 tests (DiscoveryCapability includes currentUser; args + result shapes).
- [ ] `tests/unit/pm/trello/manifest-discovery.test.ts` — +2 tests.
- [ ] `tests/unit/pm/jira/manifest-discovery.test.ts` — +2 tests.
- [ ] `tests/unit/pm/linear/manifest-discovery.test.ts` — +2 tests.
- [ ] `tests/unit/integrations/pm-fake-lifecycle.test.ts` — +1 test.
- [ ] `tests/unit/web/pm-wizard-verification.test.ts` — new file, ~4 tests covering the restored UX per-provider.
- [ ] `tests/unit/web/pm-wizard-hooks-trello-reads.test.ts` — new file, ~4 tests.
- [ ] `tests/unit/web/pm-wizard-hooks-jira-reads.test.ts` — new file, ~4 tests.
- [ ] `tests/unit/web/pm-wizard-hooks-linear-reads.test.ts` — new file, ~2 tests.
- [ ] `tests/unit/api/pm-discovery-legacy-removed.test.ts` — update; +10 assertions now cover reads.
- [ ] `tests/unit/api/routers/integrationsDiscovery.test.ts` — remove ~25 existing describe blocks for deleted procedures.
- [ ] `tests/unit/integrations/pm-conformance.test.ts` — +1 behavioral group (currentUser).

### Integration tests
- None — all reads exercised via mocked clients.

### Acceptance tests
- [ ] Dashboard wizard's "Verify credentials" step shows the user's handle again (manual smoke).
- [ ] `cascade-tools pm list --project <any>` continues to work (no changes expected, but verify no regressions).
- [ ] `npm run lint`, `npm test`, `npm run typecheck`, `npm run build` all green.

---

## Acceptance Criteria (per-plan, testable)

1. `DiscoveryCapability` includes `'currentUser'` with typed args + result.
2. Trello / JIRA / Linear / Fake manifests all declare `currentUser` in `discoveryCapabilities` and implement the `discover` switch case.
3. `web/src/components/projects/pm-wizard-hooks.ts` no longer calls any of the 10 legacy read procedures (`trelloBoards*`, `jiraProjects*`, `linearTeams*` and their "ByProject" variants).
4. `src/api/routers/integrationsDiscovery.ts` no longer defines any of the 10 legacy PM read procedures; contains only SCM + alerting procedures.
5. The file has a jsdoc header explicitly stating post-spec-010 scope (SCM + alerting only).
6. Wizard verification displays "Verified as @{handle} ({name})" (or equivalent per provider) — the pre-009/5 UX is restored.
7. `tests/unit/api/pm-discovery-legacy-removed.test.ts` asserts all 10 reads are removed (+ the 5 mutations from plan 1 remain removed).
8. Conformance harness's new `currentUser` group runs against every provider declaring the capability.
9. All new/modified code has tests.
10. `npm run build` passes.
11. `npm test` passes.
12. `npm run lint` passes.
13. `npm run typecheck` passes.
14. No user-visible regression in wizard or CLI.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `src/integrations/README.md` | In the capability table, add `currentUser` row. Note that read-side migration is complete. |
| `tests/README.md` | Document the `currentUser` conformance assertion. |
| `CHANGELOG.md` | `feat(pm): migrate remaining read procedures to pm.discover; add currentUser capability; restore wizard verification UX`. |

---

## Out of Scope (this plan)

Deferred to plan 3:
- Shared wizard step components for the 6 `StandardStepKind`s.
- Migrating per-provider wizard step files to use the shared components.
- `new-provider-surface` snapshot tightening.
- Provider-migration-status-table rewrite in `src/integrations/README.md`.
- Root `CLAUDE.md` update + spec 009 forward-reference.

Originally out of scope for the spec:
- Registry-driven `configMapper` rewrite.
- Extending manifest pattern to SCM / alerting.
- `tests/` tree typecheck widening.
- Fake PM provider as user-facing demo.
- Additional mutations beyond `createLabel` / `createCustomField`.
- Renaming `integrationsDiscovery.ts`.

---

## Progress

<!-- /implement updates these as it works. Do not edit manually. -->
- [ ] AC #1 (DiscoveryCapability.currentUser)
- [ ] AC #2 (all providers declare + implement currentUser)
- [ ] AC #3 (wizard read callers migrated)
- [ ] AC #4 (legacy read procedures deleted)
- [ ] AC #5 (integrationsDiscovery.ts SCM+alerting-only jsdoc)
- [ ] AC #6 (verification UX restored)
- [ ] AC #7 (legacy-removed test covers all 15 deletions)
- [ ] AC #8 (conformance currentUser group)
- [ ] AC #9 (tests)
- [ ] AC #10 (build)
- [ ] AC #11 (tests)
- [ ] AC #12 (lint)
- [ ] AC #13 (typecheck)
- [ ] AC #14 (no regression)
