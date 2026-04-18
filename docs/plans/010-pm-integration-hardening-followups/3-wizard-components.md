---
id: 010
slug: pm-integration-hardening-followups
plan: 3
plan_slug: wizard-components
level: plan
parent_spec: docs/specs/010-pm-integration-hardening-followups.md
depends_on: [2-read-cleanup.md]
status: pending
---

# 010/3: Wizard Components — Real Shared Components for Every StandardStepKind

> Part 3 of 3 in the 010-pm-integration-hardening-followups plan. See [parent spec](../../specs/010-pm-integration-hardening-followups.md).

## Summary

Replace the plan 009/1 placeholder-only `renderStandardStep` with real shared React components for each of the six `StandardStepKind` values: `credentials`, `container-pick`, `status-mapping`, `label-mapping`, `webhook-url-display`, `project-scope`. Each component is a standalone React component under a dedicated shared folder; each consumes data through `pm.discovery.discover` (hooks built in plan 2) + the wizard state shape the `pm-wizard-state.ts` module already defines.

Migrate Trello, JIRA, and Linear wizards to render their standard steps through the shared components via `renderStandardStep`. Shrink the per-provider `pm-wizard-<provider>-steps.tsx` files to contain only genuinely provider-specific custom steps (if any). This plan tightens the `new-provider-surface` snapshot to include the new shared-component folder, and finalizes documentation (provider migration status, root `CLAUDE.md`, spec 009 forward-reference).

**Components delivered:**
- `web/src/components/projects/pm-providers/steps/credentials.tsx` — standard credentials step.
- `web/src/components/projects/pm-providers/steps/container-pick.tsx` — standard container/board/project/team picker.
- `web/src/components/projects/pm-providers/steps/status-mapping.tsx` — CASCADE status → provider state mapping.
- `web/src/components/projects/pm-providers/steps/label-mapping.tsx` — CASCADE label → provider label mapping (accepts free text for providers that return no curated labels, like JIRA).
- `web/src/components/projects/pm-providers/steps/webhook-url-display.tsx` — shows the provider's webhook URL for manual setup.
- `web/src/components/projects/pm-providers/steps/project-scope.tsx` — Linear's optional project-scope narrowing (from spec 005).
- `web/src/components/projects/pm-providers/generator.tsx` — replace the placeholder switch with real component rendering; keep the unknown-kind warn-and-placeholder fallback intact.
- `web/src/components/projects/pm-providers/{trello,jira,linear}/wizard.ts` — update each provider's `ProviderWizardDefinition.steps` to use the shared components via `renderStandardStep`. Trello/JIRA/Linear-specific data (credential field names, discover capability args) passed through the shared `providerHooks` bridge.
- `web/src/components/projects/pm-wizard-{trello,jira,linear}-steps.tsx` — shrunk: remove standard-kind step components that are now shared; retain any custom UI. Files without custom UI end up effectively empty (delete them as a final cleanup).
- `tests/unit/web/steps/*.test.tsx` — one test file per shared component (~6 files).
- `tests/unit/web/wizard-generator.test.ts` — update existing to assert real components render, not placeholders.
- `tests/unit/integrations/new-provider-surface.test.ts` — extend the shared-surface list with the new shared-component folder.
- `src/integrations/README.md` — full rewrite of "Adding a new PM provider" section to reflect post-spec-010 state.
- `CLAUDE.md` — update PM-integration summary paragraph.
- `docs/specs/009-pm-integration-hardening.md.done` — add forward-reference to spec 010.

**Deferred to later plans in this spec:**
- Nothing — this plan closes the spec.

---

## Spec ACs satisfied by this plan

- **Spec AC #6** (standard wizard steps render from shared components) — **full**
- **Spec AC #8** (`new-provider-surface` snapshot tightened) — **full**
- **Spec AC #9** (provider-existing tests continue to pass) — verified for wizard scope here
- **Spec AC #10** — hygiene across the full plan

---

## Depends On

- Plan 2 (`read-cleanup`) — provides `pm.discovery.discover` for every discovery capability including `currentUser`; the shared components consume these via `providerHooks` hooks.

---

## Detailed Task List (TDD)

### 1. Shared `credentials` step component

**Tests first** (`tests/unit/web/steps/credentials.test.tsx` — new file):
- Renders input fields declared by `manifest.credentialRoles` (api_key, token, email, api_token, etc. — varies per provider).
- Fires `dispatch({ type: 'SET_CREDENTIALS', ... })` on input change.
- Shows the `Verify` button; clicking it triggers the `verifyMutation` hook from plan 2.
- Displays the restored "Verified as @{handle}" message on success.

**Implementation** (`web/src/components/projects/pm-providers/steps/credentials.tsx`):
- Export `CredentialsStep: React.FC<StandardStepProps>`. Read `manifest.credentialRoles` via `providerHooks` to render input fields generically.
- Use the `useVerification` hook (from plan 2) for the verify flow.
- Provider-specific credential field labels come from the manifest's `credentialRoles[*].label`.

### 2. Shared `container-pick` step component

**Tests first** (`tests/unit/web/steps/container-pick.test.tsx` — new file):
- Renders a dropdown populated via `pm.discovery.discover` with the provider's natural container capability (`boards` for Trello, `projects` for JIRA, `teams` for Linear).
- Fires `dispatch({ type: 'SET_CONTAINER_ID', ... })` on selection.
- Shows loading state while the discover call is in flight.
- Shows error state on discover failure.

**Implementation** (`web/src/components/projects/pm-providers/steps/container-pick.tsx`):
- Export `ContainerPickStep`. Read `manifest.discoveryCapabilities` to decide which capability to call — if `boards` is declared, use `boards`; if `projects`, use `projects`; if `teams`, use `teams`. Fall back to throwing an informative error if none of the three are declared.
- The generic step name "container-pick" hides the provider-native semantics — the shared component picks the right one.

### 3. Shared `status-mapping` step component

**Tests first** (`tests/unit/web/steps/status-mapping.test.tsx` — new file):
- Calls `pm.discovery.discover('states', { containerId })` (or falls back to rendering empty when the provider doesn't declare `states`).
- Renders CASCADE-status rows (backlog, todo, inProgress, done, …) each with a dropdown of provider states.
- Saves the selection to `dispatch({ type: 'SET_STATUS_MAPPINGS', ... })`.

**Implementation** (`web/src/components/projects/pm-providers/steps/status-mapping.tsx`):
- Export `StatusMappingStep`. Use `pm.discovery.discover('states', { containerId })` via a shared hook.
- CASCADE status list is a constant import from the existing `pm-wizard-state.ts` or a new shared constant file.

### 4. Shared `label-mapping` step component

**Tests first** (`tests/unit/web/steps/label-mapping.test.tsx` — new file):
- When `pm.discovery.discover('labels', { containerId })` returns a non-empty array, render dropdowns.
- When it returns empty (JIRA — free-form), render text inputs.
- Fires `dispatch({ type: 'SET_LABEL_MAPPINGS', ... })` on change.
- "Create new label" button appears when `manifest.createLabel` is declared (Trello + Linear); calls `pm.discovery.createLabel` on submit.

**Implementation** (`web/src/components/projects/pm-providers/steps/label-mapping.tsx`):
- Dual-mode rendering based on whether the label discovery returns an enumeration or empty.
- For providers with `manifest.createLabel`, expose the create-label button (from plan 1's generic endpoint).

### 5. Shared `webhook-url-display` step component

**Tests first** (`tests/unit/web/steps/webhook-url-display.test.tsx` — new file):
- Renders the webhook URL constructed from `manifest.webhookRoute` + the CASCADE router's public base URL.
- Shows a copy-to-clipboard button.
- Includes provider-specific setup instructions from `manifest.wizardSpec.steps[{kind:'webhook-url-display'}].config?.instructions` if declared.

**Implementation** (`web/src/components/projects/pm-providers/steps/webhook-url-display.tsx`):
- Read the CASCADE router base URL from an env/config; if unset, show a placeholder "configure `ROUTER_PUBLIC_URL`".
- The copy-to-clipboard uses `navigator.clipboard.writeText` (wrap for SSR safety).

### 6. Shared `project-scope` step component

**Tests first** (`tests/unit/web/steps/project-scope.test.tsx` — new file):
- For providers declaring `discoveryCapabilities.projects`, calls `pm.discovery.discover('projects', { containerId })`.
- Renders a dropdown with "No project scope" + one option per discovered project.
- Fires `dispatch({ type: 'SET_PROJECT_ID', ... })` on change.
- When `projects` capability is not declared, the step logs and renders a no-op banner (so a provider mistakenly declaring `project-scope` doesn't crash the wizard).

**Implementation** (`web/src/components/projects/pm-providers/steps/project-scope.tsx`):
- Read `manifest.discoveryCapabilities.projects` via `providerHooks`; if falsy, show the no-op banner.
- Otherwise standard dropdown + dispatch.

### 7. Update `renderStandardStep` to route to real components

**Tests first** (`tests/unit/web/wizard-generator.test.ts` — extend existing):
- For each `StandardStepKind`, `renderStandardStep(step, ctx)` returns the corresponding React component (not the placeholder div).
- Unknown `kind` continues to produce the warning placeholder (preserved behavior from plan 009/1).
- Snapshot: the rendered DOM matches the shared component output.

**Implementation** (`web/src/components/projects/pm-providers/generator.tsx`):
- Replace the switch's `return placeholder(...)` per kind with `return createElement(CredentialsStep, { step, ...ctx })`, etc.
- Preserve the unknown-kind fallback — still calls `warnOnce` + returns the placeholder.

### 8. Migrate Trello wizard to use shared components

**Tests first** (`tests/unit/web/trello-wizard-generator.test.ts` — extend existing):
- Rendering the Trello wizard through the generator produces the real components, not placeholders.
- Per-provider custom step (if any) continues to render from the Trello folder.

**Implementation**:
- `web/src/components/projects/pm-providers/trello/wizard.ts` — delete per-provider copies of `TrelloCredentialsStepAdapter`, `TrelloBoardStepAdapter`, `TrelloFieldMappingStepAdapter` — the shared components cover their job.
- `web/src/components/projects/pm-wizard-trello-steps.tsx` — shrink. Delete the step components for standard kinds. Leave the file if any Trello-specific custom UI remains; delete the file if nothing is left.
- Update `web/src/components/projects/pm-wizard-trello-steps.tsx` imports/exports accordingly. The existing tests at `tests/unit/web/trello-*-step.test.tsx` get updated or consolidated.

### 9. Migrate JIRA wizard

**Tests first** (`tests/unit/web/jira-wizard-generator.test.ts` — extend existing):
- Same assertions as Trello.
- JIRA's `label-mapping` step correctly enters free-text mode (because `discover('labels')` returns empty).

**Implementation**:
- `web/src/components/projects/pm-providers/jira/wizard.ts` — delete per-provider step adapters.
- `web/src/components/projects/pm-wizard-jira-steps.tsx` — shrink or delete.

### 10. Migrate Linear wizard

**Tests first** (`tests/unit/web/linear-wizard-generator.test.ts` — extend existing):
- Same assertions.
- `project-scope` step renders with the shared component.

**Implementation**:
- `web/src/components/projects/pm-providers/linear/wizard.ts` — delete per-provider step adapters.
- `web/src/components/projects/pm-wizard-linear-steps.tsx` — shrink or delete. Keep Linear-specific custom UI (reaction emoji config, etc.) if any exists.

### 11. Tighten the `new-provider-surface` snapshot

**Tests first** (`tests/unit/integrations/new-provider-surface.test.ts` — extend existing):
- Add new entries to `SHARED_SURFACE_FILES` — the 6 shared step files, the generator, the pm-discovery router (now also has `createLabel` + `createCustomField`).
- Run — assert the existing test passes with the new file list.

**Implementation**:
- Extend the `SHARED_SURFACE_FILES` array with:
  - `web/src/components/projects/pm-providers/steps/credentials.tsx`
  - `.../container-pick.tsx`
  - `.../status-mapping.tsx`
  - `.../label-mapping.tsx`
  - `.../webhook-url-display.tsx`
  - `.../project-scope.tsx`

### 12. Final docs rewrite

**Implementation**:
- `src/integrations/README.md`:
  - Update the provider migration status table: Trello/JIRA/Linear rows now all show "✅ shared components (no duplicates in provider folder)".
  - Rewrite "Adding a new PM provider" step 3 — the frontend folder now only needs `index.ts`, `wizard.ts`, `adapters.tsx` (thin bridge), and custom steps. The six standard kinds require zero per-provider code.
  - Add `currentUser` to the capability table (lift from plan 2).
  - Note `pm.discovery.createLabel` / `createCustomField` in the manifest-contract table (lift from plan 1).
- `CLAUDE.md` (project root) — brief update: "Post-spec-010, all PM surfaces (read + write + wizard UI) go through generic `pm.discovery.*` endpoints and shared components. Adding a new PM provider requires no edits to shared router/worker/CLI/dashboard/configMapper/central-schema/shared-component files."
- `docs/specs/009-pm-integration-hardening.md.done` — add forward-reference to spec 010 at the top (mirror the spec 006 → spec 009 pointer).
- `CHANGELOG.md` — entry for plan 3 and for the spec-010 closure.

---

## Test Plan

### Unit tests
- [ ] `tests/unit/web/steps/credentials.test.tsx` — new file, ~6 tests.
- [ ] `tests/unit/web/steps/container-pick.test.tsx` — new file, ~5 tests.
- [ ] `tests/unit/web/steps/status-mapping.test.tsx` — new file, ~5 tests.
- [ ] `tests/unit/web/steps/label-mapping.test.tsx` — new file, ~7 tests (enum mode + free-text mode + create-label path).
- [ ] `tests/unit/web/steps/webhook-url-display.test.tsx` — new file, ~3 tests.
- [ ] `tests/unit/web/steps/project-scope.test.tsx` — new file, ~4 tests (declared capability + no-op banner).
- [ ] `tests/unit/web/wizard-generator.test.ts` — update; ~5 extended assertions.
- [ ] `tests/unit/web/trello-wizard-generator.test.ts` — update.
- [ ] `tests/unit/web/jira-wizard-generator.test.ts` — update.
- [ ] `tests/unit/web/linear-wizard-generator.test.ts` — update.
- [ ] `tests/unit/integrations/new-provider-surface.test.ts` — extend SHARED_SURFACE_FILES.
- [ ] Existing per-provider step tests (`tests/unit/web/{trello,jira,linear}-*-step.test.tsx`) — audit + update or delete.

### Integration tests
- None — all wizard flows exercised through React Testing Library + SSR snapshots.

### Acceptance tests
- [ ] Dashboard wizard for all three providers renders the same UX as today (snapshot compare).
- [ ] `npm run lint`, `npm test`, `npm run typecheck`, `npm run build` all green.

---

## Acceptance Criteria (per-plan, testable)

1. Six new React components exist at `web/src/components/projects/pm-providers/steps/*.tsx`, one per `StandardStepKind`.
2. `renderStandardStep` in the generator returns the corresponding real component for each `StandardStepKind`; the unknown-kind fallback still warns and renders a placeholder.
3. All three provider wizards (Trello/JIRA/Linear) render their standard steps through the shared components via `renderStandardStep`.
4. Per-provider `pm-wizard-<provider>-steps.tsx` files retain only genuinely provider-specific custom steps; files with no custom UI are deleted.
5. `new-provider-surface` snapshot is tightened to include the 6 shared step files.
6. `src/integrations/README.md` is fully rewritten to reflect post-spec-010 state.
7. Root `CLAUDE.md` PM-integration summary reflects post-spec-010 state.
8. `docs/specs/009-pm-integration-hardening.md.done` has a forward-reference to spec 010.
9. No user-visible regression in the Trello/JIRA/Linear wizards (snapshot or manual smoke).
10. All new/modified code has tests.
11. `npm run build` passes.
12. `npm test` passes.
13. `npm run lint` passes.
14. `npm run typecheck` passes.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `src/integrations/README.md` | Full rewrite of provider migration status table + "Adding a new PM provider" section to reflect post-spec-010 (all surfaces generic). |
| `CLAUDE.md` | PM-integration summary updated to reference spec 010 alongside 009. |
| `docs/specs/009-pm-integration-hardening.md.done` | Forward-reference to spec 010 added at the top. |
| `CHANGELOG.md` | Entry: `feat(pm): shared wizard components for every StandardStepKind; provider wizards migrated; spec 010 complete`. |

---

## Out of Scope (this plan)

Deferred: nothing — this plan closes the spec.

Originally out of scope for the spec (repeated for clarity):
- Registry-driven `configMapper` rewrite.
- Extending manifest pattern to SCM (GitHub) or alerting (Sentry).
- `tests/` tree typecheck widening.
- Fake PM provider as user-facing demo.
- Additional mutations beyond `createLabel` / `createCustomField`.
- Renaming `integrationsDiscovery.ts`.

---

## Progress

<!-- /implement updates these as it works. Do not edit manually. -->
- [ ] AC #1 (6 shared step components exist)
- [ ] AC #2 (generator dispatches to real components)
- [ ] AC #3 (3 providers use shared components)
- [ ] AC #4 (per-provider step files shrunk/deleted)
- [ ] AC #5 (new-provider-surface tightened)
- [ ] AC #6 (README rewrite)
- [ ] AC #7 (CLAUDE.md update)
- [ ] AC #8 (spec 009 forward-ref)
- [ ] AC #9 (no regression)
- [ ] AC #10 (tests)
- [ ] AC #11 (build)
- [ ] AC #12 (tests)
- [ ] AC #13 (lint)
- [ ] AC #14 (typecheck)
