---
id: 011
slug: pm-wizard-shared-migration
plan: 1
plan_slug: shared-components
level: plan
parent_spec: docs/specs/011-pm-wizard-shared-migration.md
depends_on: []
status: pending
---

# 011/1: Shared Components — Widen Existing Steps + Add 7th Kind

> Part 1 of 5 in the 011-pm-wizard-shared-migration plan. See [parent spec](../../specs/011-pm-wizard-shared-migration.md).

## Summary

Foundation plan for the wizard migration. Widens three existing shared step components (`container-pick`, `project-scope`, `webhook-url-display`) with **additive** optional props so they meet real-provider requirements, and adds a **7th `StandardStepKind`** (`custom-field-mapping`) that consumes the `manifest.createCustomField` hook shipped by spec 010/1. Widens the generator's step registry to dispatch the new kind. Updates the `new-provider-surface` guard to pin the new component file.

**Dormant plan.** Ships no user-visible changes — the widened components have zero real-provider consumers until plan 2 (Trello) lands. But every future consumer (plans 2–4, and new providers) depends on this foundation being stable.

**Components delivered:**
- `web/src/components/projects/pm-providers/steps/container-pick.tsx` — optional `searchable?: boolean` prop; when true, renders via the shared `Combobox` primitive instead of a plain `<select>`.
- `web/src/components/projects/pm-providers/steps/project-scope.tsx` — same `searchable?: boolean` widening (optional; Linear would want it; behavior-preserving when false).
- `web/src/components/projects/pm-providers/steps/webhook-url-display.tsx` — optional `secretFieldRole?: string`, `secretValue?: string`, `onSecretChange?: (value: string) => void` props for providers that need an inline signing-secret input (Linear's `LINEAR_WEBHOOK_SECRET`).
- `web/src/components/projects/pm-providers/steps/custom-field-mapping.tsx` — new shared component, 7th standard step kind. Renders one row per CASCADE custom-field slot with a dropdown of provider custom fields + an inline "Create…" button wired to `manifest.createCustomField`.
- `src/integrations/pm/manifest.ts` — adds `'custom-field-mapping'` to the `StandardStepKind` union.
- `web/src/components/projects/pm-providers/generator.tsx` — registers `CustomFieldMappingStep` in `STANDARD_STEP_COMPONENTS`.
- `tests/unit/web/steps/container-pick.test.ts`, `project-scope.test.ts`, `webhook-url-display.test.ts` — extend with new-prop assertions; existing assertions continue to pass unchanged.
- `tests/unit/web/steps/custom-field-mapping.test.ts` — new file, per the spec-010 pattern.
- `tests/unit/web/wizard-generator.test.ts` — extend to cover dispatch of the 7th kind.
- `tests/unit/integrations/new-provider-surface.test.ts` — extend `SHARED_SURFACE_FILES` with `custom-field-mapping.tsx`.

**Deferred to later plans in this spec:**
- Every provider migration — plans 2 (Trello), 3 (JIRA), 4 (Linear).
- Deletion of `pm-wizard-{trello,jira,linear}-steps.tsx` — plan 5 (cleanup).
- Documentation rewrites (README, CLAUDE.md, CHANGELOG) — plan 5 (cleanup).

---

## Spec ACs satisfied by this plan

- Spec AC #7 (7th `StandardStepKind: custom-field-mapping` declared + rendered) — **full**
- Spec AC #8 (widened components additive; 31 spec-010 tests pass unchanged) — **full**
- Spec AC #9 (`new-provider-surface` snapshot includes the new file) — **full**
- Spec AC #1 (Trello on shared + OAuth custom) — **partial** (this plan provides the shared components Trello will consume; plan 2 delivers the Trello wiring).
- Spec AC #2 (JIRA on shared + issue-type custom) — **partial** (shared components available; plan 3 delivers JIRA wiring).
- Spec AC #3 (Linear on shared + inline secret + project-scope) — **partial** (webhook-url-display widening is here; plan 4 delivers Linear wiring).
- Spec AC #6 (UX normalized upward — searchable pickers, inline create) — **partial** (capability lives here; each provider's migration activates it).
- Spec AC #10 (conformance harness stays green) — hygiene.
- Spec AC #11 (build / test / lint / typecheck) — hygiene.

---

## Depends On

No plan dependencies. Depends on the spec-010 shared-component baseline already in `main` — the 6 step components at `web/src/components/projects/pm-providers/steps/*.tsx` and the generator registry.

---

## Detailed Task List (TDD)

### 1. Widen `container-pick` with optional searchable mode

**Tests first** (`tests/unit/web/steps/container-pick.test.ts`):
- `renders as plain <select> when 'searchable' prop is omitted (backward compat)` — existing behavior; existing 5 tests already cover this; confirm no modification needed.
- `renders the shared Combobox when 'searchable' is true` — assert `data-combobox` (Combobox's root attribute) present in SSR output, and `<select>` absent.
- `passes the current options through to Combobox as ComboboxOption[]` — selected board/project appears as the button label in SSR output.
- `invokes 'onSelect' when the Combobox value changes` — not easily SSR-testable; use React Testing Library or a manual render through renderToString + onChange shim. Alternatively, pin via element.type identity.

**Implementation** (`web/src/components/projects/pm-providers/steps/container-pick.tsx`):
- Add `searchable?: boolean` to `ContainerPickStepProps`.
- When `searchable` is `true`, import `Combobox` + `ComboboxOption` from `web/src/components/ui/combobox.tsx` and render via it instead of the plain `<select>`. Map `options` (id/name/url) → `ComboboxOption` (value: id, label: name, detail: url).
- When `searchable` is `false` or omitted, preserve the current `<select>` rendering byte-for-byte.
- Loading / error branches unchanged.

### 2. Widen `project-scope` with the same `searchable?: boolean` prop

**Tests first** (`tests/unit/web/steps/project-scope.test.ts`):
- Mirror the container-pick tests (plain select vs Combobox). Existing 4 tests pin plain-select behavior; add 2 more for searchable mode.

**Implementation** (`web/src/components/projects/pm-providers/steps/project-scope.tsx`):
- Same widening pattern as container-pick. Preserve the "No project scope" first-option semantics in both render paths.

### 3. Widen `webhook-url-display` with optional signing-secret field

**Tests first** (`tests/unit/web/steps/webhook-url-display.test.ts`):
- `renders URL + copy button only when 'secretFieldRole' is omitted (backward compat)` — existing 4 tests continue to pass.
- `renders an additional <input type='password'> with data-role={secretFieldRole} when 'secretFieldRole' is supplied` — assert the extra input in SSR output.
- `reflects 'secretValue' as the input's value` — assert `value="{secret}"` in SSR output.
- `onSecretChange is a function reference on the input's onChange handler` — assert prop identity, not behavior.
- `omits the secret input if secretFieldRole is present but onSecretChange is not` — defensive: defense-in-depth, don't render a dangling uncontrolled secret input.

**Implementation** (`web/src/components/projects/pm-providers/steps/webhook-url-display.tsx`):
- Add `secretFieldRole?: string`, `secretLabel?: string`, `secretValue?: string`, `onSecretChange?: (value: string) => void` to props.
- When `secretFieldRole` and `onSecretChange` are both supplied, render `<label>{secretLabel ?? secretFieldRole}</label><input type="password" data-role={secretFieldRole} value={secretValue ?? ''} onChange={(e) => onSecretChange(e.target.value)} />` below the URL block.

### 4. New shared `custom-field-mapping` component

**Tests first** (`tests/unit/web/steps/custom-field-mapping.test.ts`) — new file:
- `renders one row per CASCADE custom-field slot` (slots supplied via props).
- `each row lists every provider custom field as an option`.
- `reflects the current mapping in the selected option`.
- `renders loading and error states` (matching the `data-state="loading"`/`"error"` convention).
- `invokes 'onMappingChange(slotKey, customFieldId)' on select change`.
- `exposes an inline "Create…" button when 'onCreateCustomField' prop is supplied`.
- `invokes 'onCreateCustomField(slotKey, name)' when the Create button submits a name`.
- `hides the Create button when 'onCreateCustomField' is omitted`.

**Implementation** (`web/src/components/projects/pm-providers/steps/custom-field-mapping.tsx`):
- Props:
  ```ts
  interface CustomFieldMappingStepProps {
    readonly step: StandardStep;
    readonly providerId: string;
    readonly cascadeSlots: ReadonlyArray<{ key: string; label: string }>;
    readonly providerCustomFields: ReadonlyArray<{ id: string; name: string; type: string }>;
    readonly mappings: Readonly<Record<string, string | undefined>>;
    readonly onMappingChange: (slotKey: string, fieldId: string) => void;
    readonly onCreateCustomField?: (slotKey: string, name: string) => void;
    readonly loading?: boolean;
    readonly error?: string;
  }
  ```
- Mirror `status-mapping.tsx`'s structure: one row per `cascadeSlots` entry; loading/error banners; `data-cascade-slot={key}` on each row.
- The "Create…" affordance: a small inline form with one text input + submit button (name only — type is a provider concern). When clicked with a non-empty name, call `onCreateCustomField(slotKey, name)`. Parent wires this to `pm.discovery.createCustomField` via the manifest's `createCustomField` hook.

### 5. Register the 7th kind in the generator + manifest

**Tests first** (`tests/unit/web/wizard-generator.test.ts`):
- Extend the `STANDARD_STEP_COMPONENTS` registry test to assert `STANDARD_STEP_COMPONENTS['custom-field-mapping']` === `CustomFieldMappingStep`.
- Extend the `renderStandardStep` dispatch test with a row for `['custom-field-mapping', CustomFieldMappingStep]`.
- Existing 11 tests continue to pass unchanged.

**Implementation**:
- `src/integrations/pm/manifest.ts` — widen `StandardStepKind` union: `| 'custom-field-mapping'`.
- `web/src/components/projects/pm-providers/generator.tsx`:
  - Import `CustomFieldMappingStep` from `./steps/custom-field-mapping.js`.
  - Add entry to `STANDARD_STEP_COMPONENTS`.
  - No other generator changes needed — dispatch falls through the existing switch/registry path.

### 6. Tighten `new-provider-surface`

**Tests first** (`tests/unit/integrations/new-provider-surface.test.ts`):
- `SHARED_SURFACE_FILES` now has 7 shared step files (was 6). Existing 20 tests still run (one more `it.each` invocation — 21 total); existing assertions still pass.

**Implementation**:
- Add one entry: `'web/src/components/projects/pm-providers/steps/custom-field-mapping.tsx'`.

### 7. Conformance harness sanity run

No code change; manually confirm:
- `tests/unit/integrations/pm-conformance.test.ts` still passes — declaring a new `StandardStepKind` does not retroactively require providers to include it in their `wizardSpec`.

---

## Test Plan

### Unit tests
- [ ] `tests/unit/web/steps/container-pick.test.ts` — +2 tests (searchable on/off).
- [ ] `tests/unit/web/steps/project-scope.test.ts` — +2 tests.
- [ ] `tests/unit/web/steps/webhook-url-display.test.ts` — +3 tests (secret-field present/absent/defensive).
- [ ] `tests/unit/web/steps/custom-field-mapping.test.ts` — new file, ~7 tests.
- [ ] `tests/unit/web/wizard-generator.test.ts` — +2 assertions inside existing tests (registry + dispatch).
- [ ] `tests/unit/integrations/new-provider-surface.test.ts` — +1 `it.each` row.

### Integration tests
- None. All UI is SSR-tested via `renderToStaticMarkup`.

### Acceptance tests
- [ ] The seven shared step components + generator together render through the wizard path for every known kind.
- [ ] `npm run build`, `npm test`, `npm run lint`, `npm run typecheck` — all green.

---

## Acceptance Criteria (per-plan, testable)

1. `StandardStepKind` type includes `'custom-field-mapping'`.
2. `STANDARD_STEP_COMPONENTS` maps `'custom-field-mapping'` to the new shared component.
3. `renderStandardStep({ kind: 'custom-field-mapping', ... }, ctx)` returns a React element whose `.type` identity is the new component.
4. `container-pick` with `searchable: true` renders via the shared `Combobox`.
5. `container-pick` with `searchable` unset preserves the existing plain-select output (backward compat proven by unchanged existing tests passing).
6. `project-scope` with `searchable: true` renders via `Combobox`; unset preserves plain-select.
7. `webhook-url-display` with `secretFieldRole + onSecretChange` renders a password input; omitting them preserves the existing URL-only output.
8. The new `custom-field-mapping` component renders rows per CASCADE slot, handles selection changes, renders loading/error states, and conditionally exposes a Create affordance wired to `onCreateCustomField`.
9. `new-provider-surface` snapshot lists the 7th step file.
10. The 31 spec-010 step tests pass without modification (backward-compat proof).
11. All new/modified code has tests.
12. `npm run build` passes.
13. `npm test` passes.
14. `npm run lint` passes.
15. `npm run typecheck` passes.

**Partial-state criterion** (this plan ships dormant code):
- The widened components + new `custom-field-mapping` kind have zero production consumers. Plan 2 activates `custom-field-mapping` + searchable `container-pick` for Trello; plan 4 activates the widened `webhook-url-display` for Linear.

---

## Documentation Impact (this plan only)

None. All docs are updated in plan 5 (cleanup) once the migration is complete. Documenting a dormant state now would just be rewritten when plan 5 closes the spec.

| File | Change |
|---|---|
| — | Deferred to plan 5. |

---

## Out of Scope (this plan)

Deferred to later plans in this spec:
- Trello wizard migration — plan 2.
- JIRA wizard migration — plan 3.
- Linear wizard migration — plan 4.
- Deletion of retired per-provider step files, README / CLAUDE.md / CHANGELOG updates, spec closure — plan 5.

Originally out of scope for the spec (repeated for clarity):
- Changes to operator wizard UX behavior or visual design.
- Extending the manifest/conformance pattern to SCM or alerting.
- Migrating composite `*Details(ByProject)` tRPC procedures.
- Changing the `ProviderWizardDefinition` contract or form-state model.
- Introducing new shared UI primitives.
- Schema migrations.

---

## Progress

<!-- /implement updates these as it works. Do not edit manually. -->
- [ ] AC #1 (StandardStepKind widened)
- [ ] AC #2 (STANDARD_STEP_COMPONENTS registry)
- [ ] AC #3 (renderStandardStep dispatches new kind)
- [ ] AC #4 (container-pick searchable on)
- [ ] AC #5 (container-pick backward compat)
- [ ] AC #6 (project-scope searchable)
- [ ] AC #7 (webhook-url-display secret field)
- [ ] AC #8 (custom-field-mapping component)
- [ ] AC #9 (new-provider-surface tightened)
- [ ] AC #10 (spec-010 tests unchanged)
- [ ] AC #11 (tests)
- [ ] AC #12 (build)
- [ ] AC #13 (test)
- [ ] AC #14 (lint)
- [ ] AC #15 (typecheck)
