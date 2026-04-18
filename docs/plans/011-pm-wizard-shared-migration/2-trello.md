---
id: 011
slug: pm-wizard-shared-migration
plan: 2
plan_slug: trello
level: plan
parent_spec: docs/specs/011-pm-wizard-shared-migration.md
depends_on: [1-shared-components.md]
status: pending
---

# 011/2: Trello Migration — First Consumer of Shared Wizard Components

> Part 2 of 5 in the 011-pm-wizard-shared-migration plan. See [parent spec](../../specs/011-pm-wizard-shared-migration.md).

## Summary

Migrates the Trello wizard from its per-provider step file (`pm-wizard-trello-steps.tsx`, 446 lines) onto the shared `StandardStepKind` components widened in plan 1. Declares Trello's standard steps (credentials via manual/OAuth selector, board picker with search, status mapping, label mapping, custom-field mapping, webhook URL display) in `trelloManifest.wizardSpec`. Keeps the **Trello OAuth popup flow** as an explicit `kind: 'custom'` step rendered from the Trello provider folder — `window.open` OAuth semantics are Trello-specific and can't be generalized into the shared `credentials` component.

**First real consumer** of the shared components. Validates that the widenings landed in plan 1 (searchable container-pick, custom-field-mapping kind) match real-provider requirements. If a gap surfaces during this plan, plan 1 gets destructively edited and the change carries forward; `git log` is the audit trail.

**Components delivered:**
- `src/integrations/pm/trello/manifest.ts` — replace the existing `wizardSpec.steps` with the migrated step list: `[credentials (custom — OAuth+manual), container-pick (searchable), status-mapping, label-mapping, custom-field-mapping, webhook-url-display]`.
- `web/src/components/projects/pm-providers/trello/wizard.ts` — rewrite `ProviderWizardDefinition.steps` to consume shared components via `renderStandardStep` + `STANDARD_STEP_COMPONENTS`. Pass Trello-specific props (discovered boards, label colors, custom-field slots, create hooks) via `useProviderHooks` → `ctx.providerHooks` bridge.
- `web/src/components/projects/pm-providers/trello/oauth-step.tsx` — **new file** — Trello-specific OAuth step component registered as the `kind: 'custom'` credentials step. Encapsulates the `window.open` popup + manual token-entry fallback that previously lived in `pm-wizard-trello-steps.tsx`.
- `web/src/components/projects/pm-providers/trello/adapters.tsx` — trimmed: remove adapters that bridged to the retired per-provider step components; keep any Trello-specific `providerHooks` plumbing.
- `tests/unit/web/trello-wizard-generator.test.ts` — extend: assert the Trello wizard dispatches through the generator to shared components for every standard step, and to the OAuth custom step for credentials.
- `tests/unit/web/trello-oauth-step.test.tsx` — **new file** — unit tests for the OAuth custom step (popup lifecycle, manual fallback, token capture).
- `tests/unit/pm/trello/manifest-wizard-spec.test.ts` — extend: update the expected step sequence to reflect `[custom (credentials/oauth), container-pick, status-mapping, label-mapping, custom-field-mapping, webhook-url-display]`.

**Deferred to later plans in this spec:**
- JIRA migration — plan 3.
- Linear migration — plan 4.
- Deletion of `pm-wizard-trello-steps.tsx` — plan 5 (once no test / import references it).
- Documentation updates — plan 5.

---

## Spec ACs satisfied by this plan

- Spec AC #1 (Trello wizard renders every standard step through shared components; OAuth as `kind: 'custom'`) — **full** (closes the chain started by plan 1).
- Spec AC #5 (no operator regression for Trello) — **full** (verified by pre/post DOM-parity tests).
- Spec AC #6 (UX normalized upward — Trello inherits searchable picker, inline custom-field create) — **partial** (Trello half; JIRA + Linear in plans 3, 4).
- Spec AC #10 (conformance harness stays green) — hygiene.
- Spec AC #11 (build / test / lint / typecheck) — hygiene.

---

## Depends On

- Plan 1 (`shared-components`) — provides:
  - 7th `StandardStepKind: 'custom-field-mapping'` + shared component (Trello's cost-field creation consumes this).
  - `container-pick` widened with `searchable: true` (Trello's board picker consumes this — search was legacy-exclusive and must survive migration).
  - `new-provider-surface` guard accepting the 7th file.

---

## Detailed Task List (TDD)

### 1. Re-read the legacy Trello wizard to enumerate behaviors to preserve

Not a code change — a planning pre-flight. Read `web/src/components/projects/pm-wizard-trello-steps.tsx` end-to-end and list:
- Every input, selection, and action the operator can perform today.
- Every error / loading / success banner.
- OAuth popup lifecycle (window.open URL, post-message handling, manual-token fallback UX).
- Create-label and create-custom-field affordances (form inputs, submit behavior, feedback).

Output: a checklist under this task in the `.wip` file — each legacy behavior traced to the shared component or custom step that will preserve it. Any behavior that falls through the cracks forces either a plan-1 widening (escalate), a new Trello custom step, or an explicit "deferred" note with user sign-off. **No implementation until this inventory is complete.**

### 2. Trello OAuth custom step

**Tests first** (`tests/unit/web/trello-oauth-step.test.tsx` — new file):
- `renders the OAuth button with Trello's authorize URL` — assert `data-action="trello-oauth-start"` and the correct URL host in the href or click handler.
- `renders a manual-token textarea as a fallback` — assert the textarea is present.
- `invokes onAuthenticated with { apiKey, token } when a postMessage arrives from the popup` — mock `window.postMessage`; assert the callback.
- `invokes onAuthenticated when the manual textarea is submitted` — simulate textarea change + submit.
- `shows a success indicator once onAuthenticated fires` — assert post-state DOM.

**Implementation** (`web/src/components/projects/pm-providers/trello/oauth-step.tsx`):
- Named export: `TrelloOAuthStep: React.FC<TrelloOAuthStepProps>` where props carry `{ step: CustomStep, providerId: 'trello', values: Record<'api_key' | 'token', string>, onChange: (role, value) => void }`.
- Lift the popup logic from `pm-wizard-trello-steps.tsx` verbatim; no semantic change.
- The `onChange` callback plugs into the shared wizard state (same `dispatch({type: 'SET_CREDENTIALS', ...})` the legacy component used).

### 3. Trello manifest wizardSpec migration

**Tests first** (`tests/unit/pm/trello/manifest-wizard-spec.test.ts`):
- `includes standard step kinds in the expected order` — update to `['custom', 'container-pick', 'status-mapping', 'label-mapping', 'custom-field-mapping', 'webhook-url-display']`. The first entry is now a `CustomStep` with `component: 'TrelloOAuthStep'`.
- `step ids are unique` — unchanged.
- `each declared step dispatches to the corresponding real component` — for standard kinds, use the `STANDARD_STEP_COMPONENTS` identity check (spec-010 pattern). For the custom step, assert the element's `data-step-kind="custom:TrelloOAuthStep"` placeholder (resolved by the Trello wizard definition at render time).

**Implementation** (`src/integrations/pm/trello/manifest.ts`):
- Replace the existing `wizardSpec.steps` with:
  ```ts
  steps: [
    { kind: 'custom', id: 'trello-credentials-oauth', component: 'TrelloOAuthStep' },
    { kind: 'container-pick', id: 'trello-board' },
    { kind: 'status-mapping', id: 'trello-status' },
    { kind: 'label-mapping', id: 'trello-label' },
    { kind: 'custom-field-mapping', id: 'trello-custom-field' },
    { kind: 'webhook-url-display', id: 'trello-webhook', config: { instructions: '<existing Trello-specific copy>' } },
  ]
  ```

### 4. Trello wizard definition rewrite

**Tests first** (`tests/unit/web/trello-wizard-generator.test.ts`):
- `each standard step dispatches to STANDARD_STEP_COMPONENTS[kind]` — existing test, now covering 5 standard kinds + 1 custom.
- `container-pick step receives searchable: true via providerHooks` — pin by asserting the rendered element has `data-combobox` present (when SSR'd) or via a provider-hooks spy that shows the prop.
- `custom-field-mapping step receives the createCustomField hook via providerHooks` — assert the prop flows through.
- `the custom OAuth step resolves to TrelloOAuthStep` — the Trello wizard's `resolveCustomStep('TrelloOAuthStep')` returns the component.

**Implementation** (`web/src/components/projects/pm-providers/trello/wizard.ts`):
- `useProviderHooks` returns an object including: `{ credentialRoles, boardOptions (via useDiscovery('boards')), cascadeStatuses, providerStates, statusMappings, providerLabels, labelMappings, cascadeCustomFieldSlots, providerCustomFields (via useDiscovery('customFields')), customFieldMappings, onCreateLabel, onCreateCustomField, webhookUrl, secretFieldRole: undefined }`.
- `steps` array now maps each `wizardSpec.step` through `renderStandardStep(step, { providerId: 'trello', providerHooks: <above> })`. For the custom OAuth step, short-circuit to `<TrelloOAuthStep {...} />`.
- `searchable: true` passed through `providerHooks` for `container-pick`.
- `isSetupComplete` logic preserved.

### 5. Retire Trello per-provider step adapters

**Tests first** (`tests/unit/web/trello-*-step.test.tsx` — legacy files):
- For each legacy step test that asserts DOM shapes now produced by shared components, decide per-test: (a) the shared component already has equivalent coverage in plan 1 tests → delete legacy test, or (b) the test validates Trello-specific behavior (OAuth, create-label button presence when Trello has it) → port to target the new OAuth step or the shared label-mapping with Trello's specific props.

**Implementation**:
- `web/src/components/projects/pm-providers/trello/adapters.tsx` — delete adapters that bridged to the retired legacy component functions. Keep `providerHooks` composition.
- `web/src/components/projects/pm-wizard-trello-steps.tsx` — **do not delete yet**; plan 5 is responsible for the deletion once all consumers migrate. Mark with a one-line comment `// Retained until plan 011/5 — see spec 011 AC #4.`

### 6. Smoke-run the conformance harness

No code change; verify:
- `npx vitest run --project unit-core tests/unit/integrations/pm-conformance.test.ts` passes.
- The Trello lifecycle scenario continues to pass through the same adapter (the manifest's back-end contract hasn't changed — only the wizard frontend).

### 7. Manual dashboard verification

Per CLAUDE.md: for UI changes, start the dev server and use the Trello wizard in a browser before reporting done. Verify:
- Every step renders.
- Searchable board picker works (type-ahead filters options).
- OAuth popup opens and returns tokens.
- Manual-token fallback works.
- Create-label + create-custom-field affordances fire the right mutation endpoints.
- Every error / loading state the legacy UI showed still appears at the same place.

If any regression surfaces, fix before marking plan done (or surface with the "mark done with caveats" option to the user).

---

## Test Plan

### Unit tests
- [ ] `tests/unit/web/trello-wizard-generator.test.ts` — ~4 tests extended.
- [ ] `tests/unit/web/trello-oauth-step.test.tsx` — new file, ~5 tests.
- [ ] `tests/unit/pm/trello/manifest-wizard-spec.test.ts` — updated to new step sequence; ~3 tests.
- [ ] Legacy `tests/unit/web/trello-*-step.test.tsx` files — each either deleted or rewritten to target shared components / Trello OAuth step.

### Integration tests
- None.

### Acceptance tests
- [ ] Conformance harness passes for Trello (behavioral contracts unchanged).
- [ ] Browser smoke test of the Trello wizard — every step functions as before.
- [ ] `npm run build`, `npm test`, `npm run lint`, `npm run typecheck` — all green.

---

## Acceptance Criteria (per-plan, testable)

1. `trelloManifest.wizardSpec.steps` lists `[custom(TrelloOAuthStep), container-pick, status-mapping, label-mapping, custom-field-mapping, webhook-url-display]` in that order.
2. Trello's `ProviderWizardDefinition` renders each standard step via `renderStandardStep` + `STANDARD_STEP_COMPONENTS` (identity check asserted).
3. `TrelloOAuthStep` is the new Trello-specific custom component and passes its own unit tests.
4. The Trello board picker uses the searchable `Combobox` mode (via `searchable: true` passed through `providerHooks`).
5. Trello's custom-field creation flows through `pm.discovery.createCustomField` via the shared `custom-field-mapping` component's `onCreateCustomField` callback.
6. Legacy `pm-wizard-trello-steps.tsx` still exists (deletion deferred to plan 5) but no longer has any production consumer.
7. All previously-tested Trello wizard behaviors (OAuth, manual token, create-label, create-custom-field, searchable board picker, status mapping, webhook URL copy) are covered by tests against the new components.
8. Conformance harness (`pm-conformance.test.ts`) passes for Trello.
9. No operator-visible regression — verified via browser smoke test.
10. `npm run build` passes.
11. `npm test` passes.
12. `npm run lint` passes.
13. `npm run typecheck` passes.

---

## Documentation Impact (this plan only)

None — deferred to plan 5 (cleanup).

| File | Change |
|---|---|
| — | Deferred. |

---

## Out of Scope (this plan)

Deferred to later plans in this spec:
- JIRA wizard migration — plan 3.
- Linear wizard migration — plan 4.
- Deletion of `pm-wizard-trello-steps.tsx` — plan 5.
- Deletion of `pm-wizard-jira-steps.tsx` / `pm-wizard-linear-steps.tsx` — plan 5.
- README / CLAUDE.md / CHANGELOG updates — plan 5.

Originally out of scope for the spec (repeated for clarity):
- Changes to operator wizard UX beyond the intentional normalize-upward moves.
- Extending the manifest/conformance pattern to SCM or alerting.
- Migrating composite `*Details(ByProject)` tRPC procedures.
- Changing the `ProviderWizardDefinition` contract.
- New shared UI primitives.
- Schema migrations.

---

## Progress

<!-- /implement updates these as it works. Do not edit manually. -->
- [ ] AC #1 (wizardSpec updated)
- [ ] AC #2 (standard steps dispatch through generator)
- [ ] AC #3 (OAuth custom step shipped + tested)
- [ ] AC #4 (searchable board picker)
- [ ] AC #5 (custom-field creation via shared)
- [ ] AC #6 (legacy file retained, no consumer)
- [ ] AC #7 (test coverage migrated)
- [ ] AC #8 (conformance harness green)
- [ ] AC #9 (no operator regression)
- [ ] AC #10 (build)
- [ ] AC #11 (test)
- [ ] AC #12 (lint)
- [ ] AC #13 (typecheck)
