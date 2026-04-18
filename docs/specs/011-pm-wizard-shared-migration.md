---
id: 011
slug: pm-wizard-shared-migration
level: spec
title: PM Wizard Migration — Existing Providers Onto Shared Components
created: 2026-04-18
status: draft
---

# 011: PM Wizard Migration — Existing Providers Onto Shared Components

## Problem & Motivation

Spec 010 shipped six real shared React step components — one per `StandardStepKind` — so a new PM provider could configure its wizard with zero per-provider step UI. The shared path works: the wizard generator dispatches to the shared registry, every component has tests, the `new-provider-surface` guard pins them. But the three **existing** production providers (Trello, JIRA, Linear) never migrated. They still fork their own step components in per-provider wizard-step files — roughly 1,085 lines of UI that duplicates what the shared components already do.

The "zero per-provider step code" promise is half-delivered. A fourth PM provider can claim it; Trello, JIRA, and Linear cannot. More practically: the shared components have exactly zero production consumers today. Without a consumer, they silently rot — the 31 tests pin the components in isolation but don't catch drift between what a real wizard needs (searchable pickers, custom-field creation, webhook signing secrets) and what the shared components provide. Spec 010's feature parity with the legacy per-provider steps was assumed, not verified.

The migration forces the shared components to meet real-provider requirements. Where the gap is generic (searchable dropdowns via the already-adopted cmdk combobox; custom-field creation via the already-shipped `manifest.createCustomField` hook; webhook signing-secret fields alongside URL display) the shared components widen to close it. Where the gap is genuinely provider-specific (Trello OAuth popup, JIRA issue-type mapping) the provider declares a `kind: 'custom'` step and keeps the UI in its provider folder. When all three real providers migrate and the legacy files are deleted, the shared components become the single source of truth for PM wizards — new and existing alike.

---

## Goals

- All three PM provider wizards (Trello, JIRA, Linear) render their standard wizard steps through the shared `StandardStepKind` components.
- The three `pm-wizard-{trello,jira,linear}-steps.tsx` files are deleted.
- Every wizard feature available today continues to work — operators see no regression in the Trello/JIRA/Linear wizard UX.
- True provider-specific UI (Trello OAuth popup; JIRA issue-type mapping) is explicit as `kind: 'custom'` in the manifest, rendered from the provider folder, so the standard path stays clean.
- The shared components are exercised by three real providers, catching any drift between the abstraction and real-world requirements.
- Adding a fourth PM provider tomorrow still writes zero per-provider standard-step code — the promise holds, now verified.

---

## Non-goals

- Changing operator-visible wizard UX. The migration is internal — same steps in the same order, same inputs, same feedback. The only permitted UX improvements are where a provider was inconsistent with others (e.g. one provider had searchable picker, one didn't — normalize upward).
- Extending the manifest pattern to SCM (GitHub) or alerting (Sentry). Spec 013 territory.
- Migrating the six composite `*Details(ByProject)` tRPC procedures off `integrationsDiscovery.ts`. Spec 012 territory — tracked separately as it's a backend concern, not a wizard concern.
- Rebuilding the wizard step orchestration, form state, or validation model. The per-provider `ProviderWizardDefinition` contract stays. Only the step Components change.
- Introducing a new UI framework, design system, or form library. Everything uses primitives already in the repo.

---

## Constraints

- **Zero operator-visible regression.** The 3 production wizards must render identically in every step to the legacy implementation, modulo the decided upgrades (searchable dropdowns everywhere, unified custom-field UI).
- **Additive shared-component API only.** Widening a shared component adds optional props; the 31 spec-010 step tests continue to pass without modification.
- **One reviewable PR per provider plus a cleanup PR.** No single-PR big-bang migration of all three.
- **Test surface net-positive.** The 6 legacy step tests (5 Linear + 1 Trello) are either rewritten against shared components where the assertion still makes sense, or deleted where they pin retired DOM shapes. Shared-component coverage must not shrink.
- **No breaking of `new-provider-surface` invariant.** Adding a 7th `StandardStepKind` for custom-field mapping widens `SHARED_SURFACE_FILES` with the new component file; the guard still refuses cross-provider edits.
- **Conformance harness stays green.** `tests/unit/integrations/pm-conformance.test.ts` must continue to pass for every provider through every step of the migration.

---

## User stories / Requirements

As an **operator setting up a new Trello project**:
- I can paste my API key and token, or complete OAuth via popup, the same way I do today.
- I can search and filter boards by name in a dropdown — the same way I search and filter in Linear or JIRA today.
- I can create a missing label or custom field from the wizard, the same way I do today.

As an **operator configuring JIRA**:
- Free-text label input works unchanged (JIRA is free-form).
- I can select issue types for task/subtask creation — unchanged from today.
- The webhook step shows me the URL and signing-secret input in one place.

As an **operator configuring Linear**:
- The webhook step includes the signing-secret field inline with the URL, the way it does today.
- The optional project-scope selector narrows the integration to one Linear Project — unchanged from spec 005.
- I can create a missing label from the label-mapping step, the same way I do today.

As a **CASCADE contributor adding a fourth PM provider (Asana, GitLab, ClickUp, …)**:
- I declare `wizardSpec.steps` on my manifest and everything renders from the shared components — no per-provider step UI, just like spec 010 promised. Now verifiable because three real providers already do the same.

As a **CASCADE reviewer inspecting a wizard PR**:
- The diff is focused: widen component X, migrate provider Y to consume it, delete the retired per-provider file. No "also changed Z" surprises.

---

## Research Notes

- **cmdk + radix-ui already adopted** via a shared Combobox component. Nine components consume it, including all three legacy PM wizards' board/project/team pickers. Widening the shared `container-pick` to consume the shared Combobox is drop-in.
- **`manifest.createCustomField` hook already exists** (spec 010/1). `pm.discovery.createCustomField` tRPC endpoint already serves every provider. Missing piece is a shared step component that consumes it.
- **Strangler-fig migration is the canonical pattern** when replacing a forked UI with a shared one: one provider at a time, each migration reversible via `git revert`, retired files deleted in a closing commit. No prior art needs researching — it's what every long-lived codebase does when consolidating duplicated UI.
- **Trello OAuth** uses a `window.open(authorizeUrl, 'trello_oauth', ...)` popup with Trello-specific return handling. Not generalizable without leaking Trello semantics.
- **JIRA issue-type mapping** (task / subtask) has one consumer today and would likely have at most one more (ClickUp). Staying as `kind: 'custom'` avoids a speculative 8th standard kind.

---

## Open Source Decisions

| Tool | Solves | Decision | Reason |
|---|---|---|---|
| [cmdk](https://cmdk.paco.me/) | Searchable dropdowns | **Use** | Already adopted (9 consumers, 3 PM wizards); shared Combobox wraps it. |
| [radix-ui](https://www.radix-ui.com/) | Popover / Dialog primitives | **Use** | Already adopted; needed for custom-field create modal. |
| [lucide-react](https://lucide.dev/) | Icons | **Use** | Already adopted; no new icon additions expected. |

No new OSS adoption. The spec stays internal.

---

## Strategic decisions

1. **Close searchable-dropdown gap by widening shared components** — chose extending shared `container-pick` / `project-scope` to consume the existing cmdk Combobox over leaving the plain `<select>` and letting providers fork. Reason: the whole migration is pointless if each provider forks its own searchable picker.
2. **Add a 7th `StandardStepKind: 'custom-field-mapping'`** — chose a new standard kind over custom-step duplication. Reason: two of three providers need it; `manifest.createCustomField` hook already exists; shared component avoids double implementation.
3. **Extend `webhook-url-display` with optional signing-secret field** — chose widening the existing component over a new kind or forcing Linear into `kind: 'custom'`. Reason: Linear is not unique here (any provider requiring HMAC-signed webhooks needs the same input); widening keeps the step count stable.
4. **JIRA issue-type mapping stays `kind: 'custom'`** — chose custom over a speculative 8th standard kind. Reason: one consumer today, unclear second consumer, no gain from generalization.
5. **Trello OAuth stays `kind: 'custom'`** — no alternative. `window.open` flow is intrinsically Trello-specific.
6. **Test migration: rewrite-or-delete, not port verbatim** — chose case-by-case over port-verbatim. Reason: legacy tests assert DOM shapes that are being deleted by design; porting them would assert nothing useful.
7. **Linear sequence: Trello → JIRA → Linear → cleanup** — chose linear over parallel. Reason: each provider's migration may reveal a shared-component gap; fixing it once and carrying forward is cheaper than three independent workstreams discovering the same thing.
8. **Additive shared-component API only** — chose additive widening over versioning. Reason: no other consumers today; versioning is premature abstraction.
9. **Delete per-provider step files at the end** — chose delete over deprecated re-exports. Reason: deprecated re-exports become permanent in practice; the point of the migration is the deletion.

---

## Acceptance Criteria (outcome-level)

1. The Trello wizard renders every standard step (credentials / container-pick / status-mapping / label-mapping / custom-field-mapping / webhook-url-display) through the shared step components; Trello-specific OAuth is a `kind: 'custom'` step in the manifest.
2. The JIRA wizard renders every standard step through the shared step components; JIRA-specific issue-type mapping is a `kind: 'custom'` step.
3. The Linear wizard renders every standard step through the shared step components, including the project-scope step (unchanged from spec 005) and the webhook-url-display step with inline signing-secret input.
4. The three files `pm-wizard-{trello,jira,linear}-steps.tsx` are deleted from the repository.
5. An operator configuring any of the three providers sees no functional regression in the wizard — every input, selection, action, and feedback message that worked before still works after.
6. Where the three legacy wizards were inconsistent (e.g. only some had searchable board pickers), the migrated version is normalized to the richer UX — all three support search, all three support label and custom-field creation inline.
7. A seventh `StandardStepKind` (`custom-field-mapping`) is declared in the shared manifest type and rendered by the generator. Wiring follows the spec-010 pattern.
8. The shared `container-pick`, `project-scope`, and `webhook-url-display` components are widened with additive props (search, secret-field, etc.). The 31 spec-010 step tests pass without modification.
9. The `new-provider-surface` snapshot lists the new custom-field-mapping component alongside the six existing step files.
10. The conformance harness (`pm-conformance.test.ts`) passes for every provider at every migration step.
11. Build, test, lint, and typecheck all green after each plan.
12. A CASCADE contributor can still add a fourth PM provider without touching any shared router / worker / CLI / dashboard / config-mapper / shared-component file — the `new-provider-surface` guard continues to hold.

---

## Documentation Impact (high-level)

- `src/integrations/README.md` — update the provider migration status table so Trello/JIRA/Linear show "✅ shared step components" instead of "✅ per-provider step adapters (spec 006)"; update "Adding a new PM provider" step 3 to remove the "Trello/JIRA/Linear still ship their own per-provider adapters" caveat.
- `CLAUDE.md` (project root) — remove the "A new PM provider with purely-standard wizard steps writes zero per-provider step code" conditional — all providers now do.
- `CHANGELOG.md` — single internal-change entry summarizing the migration and the shared-component extensions (7th standard kind, searchable dropdowns, secret-field webhook display).
- `docs/specs/010-pm-integration-hardening-followups.md.done` — forward-reference to spec 011 at the top, mirroring the 009 → 010 pointer.

---

## Out of Scope

- Changes to operator wizard UX behavior or visual design language.
- Extending the manifest/conformance pattern to SCM or alerting categories.
- Migrating the six composite `*Details(ByProject)` tRPC procedures off `integrationsDiscovery.ts`.
- Changing the `ProviderWizardDefinition` contract or the manifest-section shell component.
- Introducing new shared UI primitives beyond what's already in the repo.
- Schema migrations or config-shape changes (the wizards configure existing data; no persistence changes).
- Adding new `StandardStepKind` values beyond the `custom-field-mapping` one required to close the Trello + JIRA gap.
- Renaming `integrationsDiscovery.ts` or reshaping the tRPC router layout.
- Rewriting `pm-wizard.tsx` orchestration or the form-state model.
