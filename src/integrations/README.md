# PM Integration Architecture

CASCADE's PM providers (Trello, JIRA, Linear, and any future Asana/GitLab/ClickUp) are built on a **provider manifest** pattern. One file describes the provider end-to-end; one registry iterates manifests; a behavioral conformance harness guarantees each manifest satisfies its declared contracts.

This document is the canonical guide for adding a new PM provider. Four specs shape it:

- **Spec [006](../../docs/specs/006-pm-integration-plug-and-play.md.done)** — introduced the manifest pattern + wiring-level conformance (2026-04-15/16).
- **Spec [009](../../docs/specs/009-pm-integration-hardening.md.done)** — hardened the contracts: branded ID types, manifest-owned config schemas (eliminating the #1138/#1142 drift class), unified `pm.discover` endpoint, behavioral conformance harness with in-memory lifecycle scenario, single registration entrypoint, and auth-header provenance enforcement.
- **Spec [010](../../docs/specs/010-pm-integration-hardening-followups.md.done)** — follow-up cleanup: generic `pm.discovery.createLabel` / `createCustomField` mutation endpoints + manifest hooks, `currentUser` discovery capability, real shared React components for every `StandardStepKind`.
- **Spec [011](../../docs/specs/011-pm-wizard-shared-migration.md.done)** — migrated all three production providers (Trello, JIRA, Linear) onto the shared step components; added a 7th `StandardStepKind: custom-field-mapping`; widened `container-pick` / `project-scope` / `webhook-url-display` with optional props; deleted the three legacy `pm-wizard-{trello,jira,linear}-steps.tsx` files.

---

## Architecture in one picture

```
A new PM provider is ONE manifest backed by ONE provider folder + ONE wizard folder.

  src/integrations/pm/<provider>/
    index.ts          // registerPMProvider(<provider>Manifest) on module load
    manifest.ts       // the PMProviderManifest object
    client.ts         // provider API client (GraphQL, REST, etc.)
    adapter.ts        // PMProvider implementation
    router-adapter.ts // RouterPlatformAdapter implementation
    triggers/         // trigger handlers for webhook events
    webhook.ts        // parseWebhookPayload + (optional) custom signature verifier
    platform-client.ts// PlatformCommentClient (ack comments)

  web/src/components/projects/pm-providers/<provider>/
    index.ts          // registerProviderWizard(<provider>ProviderWizard) on module load
    wizard.ts         // ProviderWizardDefinition (steps, save transform, completion predicates)
    adapters.tsx      // step-component adapters that bridge providerHooks → existing step props
    steps.tsx         // React components for each wizard step (or re-export from pm-wizard-<provider>-steps.tsx)
```

Nothing outside those two folders needs to change when you add a provider. The registries are the only surface the rest of the codebase sees.

---

## The PMProviderManifest contract

See [`src/integrations/pm/manifest.ts`](./pm/manifest.ts) for the authoritative type. Summary:

| Field | What it does |
|---|---|
| `id` | Stable slug (kebab/lowercase). Used as the webhook route segment, job type, and registry key. |
| `label` | Human-readable name shown in the dashboard provider-select. |
| `category` | Literal `'pm'`. |
| `credentialRoles` | List of credential slots (api_key, webhook_secret, etc.) with env-var keys + optional flag. |
| `webhookRoute` | Conventionally `/${id}/webhook`. Enforced by the conformance harness. |
| `verifyWebhookSignature` | `(rawBody, headers, secret) => boolean`. Use `makeHmacSha256Verifier` from `_shared/webhook-verifier.ts` unless your provider has a non-standard signing scheme. |
| `routerAdapter` | Your `RouterPlatformAdapter` implementation — handles parsing, dispatching, and ack. |
| `extractProjectIdFromJob` | `(jobData) => Promise<projectId \| null>`. **Must return `null` for jobs belonging to other providers.** Forgetting this invariant caused the Linear-worker-without-credentials bug (PR #1118). |
| `pmIntegration` | Your `PMIntegration` implementation — the agent-facing provider API. |
| `triggerHandlers` | Array of `TriggerHandler` instances for webhook events. |
| `platformClientFactory` | `(projectId) => PlatformCommentClient`. Used by the router to post ack comments; must pull auth headers from `_shared/auth-headers.ts`. |
| `isSelfAuthoredHook?` | Optional — returns `true` when the event was authored by CASCADE itself (for loop prevention). |
| `createLabel?` | Optional — enables the wizard's "Create label" button. Called via the generic `pm.discovery.createLabel` tRPC endpoint; signature is `({credentials, containerId, name, color?}) => {id, name, color}`. |
| `createCustomField?` | Optional — enables wizard-driven custom-field creation. Called via `pm.discovery.createCustomField`; signature is `({credentials, containerId, name}) => {id, name, type}`. JIRA fields are global (the hook ignores containerId). |

### Plan 009 hardened-contract fields (all optional; providers opt in)

| Field | What it does |
|---|---|
| `configSchema?: z.ZodType` | Declarative Zod schema for the persisted integration config. The conformance harness asserts round-trip identity — the #1138/#1142 bug class (`projectId` stripped by Zod twice) becomes a CI failure instead of a production outage. |
| `configFixture?` | Sample config used by the harness's round-trip asserter. Must parse against `configSchema`. |
| `discoveryCapabilities?` | `{ teams?, boards?, labels?, states?, projects?, containers?, customFields?, currentUser? }`. Each flag means "`adapter.discover(capability, args)` returns a list of that shape" (or a single `{id, name, displayName?}` object for `currentUser`). The generic `pm.discover` tRPC endpoint dispatches through this registry. |
| `createDiscoveryProvider?` | `(opts) => PMProvider`. Factory producing a discovery-scoped adapter outside a project context (wizard setup, before the config is saved). Receives raw credentials from the wizard. |
| `wizardSpec?` | `{ steps: Array<StandardStep \| CustomStep> }`. Declarative step list the shared wizard generator renders. Standard kinds: `credentials`, `container-pick`, `status-mapping`, `label-mapping`, `webhook-url-display`, `project-scope`. |
| `lifecycle?` | `{ enabled: true, fixtureKey: string }`. Opts into the behavioral conformance harness's full lifecycle scenario. `fixtureKey` is looked up in the test-local `LIFECYCLE_FIXTURES` registry — the manifest doesn't import from `tests/helpers/`. |

---

## The ProviderWizardDefinition contract

See [`web/src/components/projects/pm-providers/types.ts`](../../web/src/components/projects/pm-providers/types.ts). Summary:

| Field | What it does |
|---|---|
| `id` | Must match the backend manifest `id`. |
| `label` | Shown in the provider-select dropdown. |
| `steps` | Array of `{ id, title, Component, isComplete }`. The generic wizard renders them in order. |
| `buildIntegrationConfig` | Transforms wizard state into the integration config payload sent at save time. |
| `isSetupComplete` | `(state) => boolean`. True when the wizard can be saved. |
| `useProviderHooks?` | Optional — composes the provider's React hooks (discovery, label creation, custom-field creation) inside a shell component. Return value flows into each step's `providerHooks` prop. |

`ManifestProviderWizardSection` (`web/src/components/projects/pm-providers/manifest-section.tsx`) is the shell component that hosts the unconditional `useProviderHooks` call — it's only mounted when a manifest is registered for the active provider, so React's rules-of-hooks hold.

---

## Shared helpers (consume these; don't fork)

Single-source-of-truth utilities live in `src/integrations/pm/_shared/`:

- **`auth-headers.ts`** — `linearAuthHeader`, `githubAuthHeader`, `jiraAuthHeader`. The session that produced spec 006 shipped a `Bearer`-prefix bug from three divergent copies of the Linear builder (PR #1119). Use the shared function.
- **`webhook-verifier.ts`** — `makeHmacSha256Verifier({ headerName, headerPrefix? })` for the common case. Opt-out semantics (secret = `null` → always `true`) preserve existing router behavior. JIRA (hex + `sha256=` prefix) and Linear (hex, no prefix) both consume this factory.
- **`label-id-resolver.ts`** — `resolveLabelId(slot, mapping, ctx)` validates UUIDs before passing labelIds to APIs that require them (Linear). Returns `null` and logs a warn for misconfigurations.
- **`project-id-extractor.ts`** — `extractProjectIdFromJobViaRegistry(jobData)` iterates the registry. Used by `src/router/worker-env.ts` before its (now-minimal) legacy branches.

---

## Registration at startup

Every runtime surface (router, worker, CLI bootstrap, dashboard) imports a single canonical entrypoint:

```typescript
import './integrations/entrypoint.js';  // registers every PM + SCM + alerting integration
```

`src/integrations/entrypoint.ts` is a side-effect-only module that imports each category's barrel — PM via `./pm/index.js`, SCM via `../github/register.js`, alerting via `../sentry/register.js`. The entrypoint exists because forgetting to register a provider in one surface but not others shipped four production bugs during Linear's rollout (#1097, #1118, #1131, #1134). The single-entrypoint invariant is guarded by `tests/unit/integrations/entrypoint-usage.test.ts`, which greps every process-entry file and fails if the import is missing.

The PM barrel (`src/integrations/pm/index.ts`):
1. Imports each provider's `index.js` (side effect: `registerPMProvider(manifest)`).
2. Iterates `listPMProviders()` and mirrors each manifest's `pmIntegration` into the cross-category `integrationRegistry` — so `integration-validation.ts` and the capability resolver see PM providers alongside SCM + alerting.

SCM (GitHub) and alerting (Sentry) integrations remain on the legacy `IntegrationModule` pattern — the manifest pattern is PM-only (spec 006 scope). Both self-register via their own `register.ts` side-effect modules, transitively pulled in by the entrypoint.

`pmRegistry` (`src/pm/registry.ts`) still exists as a **read-only delegate** over `pmProviderRegistry` — the ~9 unmigrated call sites (webhook handlers, manual runner, credential scope, lifecycle, GitHub adapter) keep working without changes. Prefer `getPMProvider(id)` / `listPMProviders()` from `src/integrations/pm/registry.ts` in new code.

### Behavioral contract fields (spec 009/1)

The manifest accepts four optional fields beyond the wiring contracts — each opts the provider into a behavioral assertion group in the conformance harness:

| Field | Purpose | Harness assertion |
|---|---|---|
| `configSchema: z.ZodType` | Declarative Zod schema for the persisted integration config | Round-trip identity: parse → serialize → re-parse → deep-equal |
| `discoveryCapabilities: { teams?, boards?, labels?, states?, projects?, customFields?, containers? }` | Which discovery queries the adapter can serve | Each declared capability returns an array from `adapter.discover(k, args)` |
| `wizardSpec: { steps: [...] }` | Declarative list of standard wizard steps | Rendered by the generator at `web/src/components/projects/pm-providers/generator.tsx` |
| `lifecycle: { enabled: true, fixture? }` | Opt into the full lifecycle scenario | Harness runs `runLifecycleScenario` (create → list → move → checklist → comment → delete) |
| `createDiscoveryProvider: (opts?) => PMProvider` | Factory producing a discovery-scoped adapter outside a project context | Powers the generic `pm.discover` tRPC endpoint |

All fields are optional; legacy manifests that don't declare them skip the corresponding harness groups. Plans 2/3/4 flip each real provider on individually.

---

## Conformance harness — what CI enforces

`tests/unit/integrations/pm-conformance.test.ts` iterates `listPMProviders()` and runs a shared test pack against every manifest:

- `id` is URL-safe kebab/lowercase
- `category` is `'pm'`
- `webhookRoute` follows the `/${id}/webhook` convention
- `routerAdapter.type === id`
- At least one required credential role
- Credential roles have unique `role` strings
- `extractProjectIdFromJob` returns `null` for foreign job types
- `extractProjectIdFromJob` returns the projectId for `{ type: id, projectId }`
- `triggerHandlers` have unique names
- `platformClientFactory(projectId)` returns an object with `postComment` + `deleteComment`
- `pmIntegration.type` is wired

A `TestProvider` fixture in `tests/helpers/testPMProvider.ts` is the minimal reference implementation — copy its shape when starting a new provider. The harness runs against TestProvider + Trello + JIRA + Linear (44 assertions total).

### Provider migration status (plan 009 — PM integration hardening)

| Provider | configSchema | discoveryCapabilities | wizardSpec | lifecycle | Branded IDs on adapter |
|---|---|---|---|---|---|
| **Trello** (plan 009/2) | ✅ `trelloConfigSchema` | ✅ boards, labels, customFields | ✅ 5 standard steps | ✅ `lifecycle.fixtureKey: 'trello'` | ✅ move/addLabel/removeLabel/listWorkItems |
| **JIRA** (plan 009/3) | ✅ `jiraConfigSchema` | ✅ projects, states, labels (empty — JIRA is free-form), customFields | ✅ 5 standard steps | ✅ `lifecycle.fixtureKey: 'jira'` | ✅ move/addLabel/removeLabel/listWorkItems |
| **Linear** (plan 009/4) | ✅ `linearConfigSchema` (locks #1138/#1142) | ✅ teams, states, labels, projects | ✅ 6 standard steps (includes project-scope from spec 005) | ✅ `lifecycle.fixtureKey: 'linear'` | ✅ move/addLabel/removeLabel/listWorkItems (locks #1117/#1137/#1139) |
| **Fake** (plan 009/1, test fixture) | ✅ | ✅ all | ✅ | ✅ | N/A (the fake parses branded IDs internally) |

All three real providers are now on the hardened contracts. Plan 009/4 also ships `tests/unit/pm/linear/regression-2026-04.test.ts` — 12 tests, one set per 2026-04 bug class, that fail loudly if any of the six classes regresses. See `linearManifest` at `src/integrations/pm/linear/manifest.ts` for the reference migration (Linear's surface area is the richest).

### Post-spec-010 additions (2026-04-18)

| Area | Change |
|---|---|
| Mutations | Generic `pm.discovery.createLabel` / `pm.discovery.createCustomField` tRPC endpoints dispatch through the manifest's optional `createLabel` / `createCustomField` hooks. Five previous caller sites (Trello/JIRA label + custom-field wizards + Linear label wizard) now consume the generic endpoints. |
| Discovery | `currentUser` capability added to `DiscoveryCapability`. All three real providers declare it (Trello via `/members/me`, JIRA via `/rest/api/3/myself`, Linear via `viewer`). The wizard's verify-button flow reads it through the unified `pm.discovery.discover` endpoint instead of per-provider procedures. |
| Wizard UI | Six real shared step components live at `web/src/components/projects/pm-providers/steps/*.tsx`, one per `StandardStepKind`. A new provider with purely-standard steps renders its wizard through `renderStandardStep` + `STANDARD_STEP_COMPONENTS` with zero per-provider step code. |
| Shared surface guard | `tests/unit/integrations/new-provider-surface.test.ts` now also pins the six step-component files — new providers should consume them, not fork them. |

### Post-spec-011 additions (2026-04-18)

| Area | Change |
|---|---|
| Wizard migration | All three production providers (Trello, JIRA, Linear) now render every standard wizard step through the shared components. The three legacy `pm-wizard-{trello,jira,linear}-steps.tsx` files are **deleted**. Zero per-provider step UI outside of explicit `kind: 'custom'` steps (Trello OAuth, JIRA issue-type). |
| Parent wizard | `pm-wizard.tsx` now iterates over `manifestDef.steps` dynamically — the old spec-006-era "3 hardcoded stepIndex slots" layout is gone. Each manifest step gets its own WizardStep slot. The legacy `WebhookStep` remains for now (programmatic webhook registration for Trello/JIRA + Linear signing-secret UX); migration of that into the manifest path is follow-up scope. |
| 7th StandardStepKind | `custom-field-mapping` shared component (with optional `onCreateCustomField` + `fieldDefaults` props) wires `manifest.createCustomField`. Trello and JIRA use it; Linear doesn't have a custom-field concept. |
| Shared-component widenings (additive) | `container-pick` and `project-scope` support optional `searchable: boolean` (renders via cmdk `Combobox`). `webhook-url-display` supports optional inline signing-secret input (`secretFieldRole` / `secretValue` / `onSecretChange`). `label-mapping` supports optional `labelDefaults?` to pre-populate the Create input + thread color. `custom-field-mapping` supports optional `fieldDefaults?`. |
| Shared surface guard | Step-component file pin extended to seven entries. |

---

## Adding a new PM provider (step by step)

Spec 009 AC #10: **a new PM provider PR should not need to edit shared router / worker / CLI / dashboard / configMapper / central schema files**. Everything lives in your provider folder + your wizard folder + a single import in `src/integrations/pm/index.ts`. The `tests/unit/integrations/new-provider-surface.test.ts` guard enforces this.

1. **Backend folder** at `src/integrations/pm/<provider>/`:
   - `client.ts` (or reuse a sibling under `src/<provider>/`) — your REST / GraphQL client. Must use `withXxxCredentials()` + AsyncLocalStorage credential scoping; never hand-assemble Bearer headers (see `_shared/auth-headers.ts`).
   - `adapter.ts` — your `PMProvider` implementation. Narrow method parameters to branded `ContainerId` / `LabelId` / `StateId` from `src/pm/ids.ts` via TypeScript method bivariance — direct adapter callers then get compile-time protection against state-name-vs-ID confusion (#1117/#1137/#1139). `createWorkItem` keeps `CreateWorkItemConfig` due to TS object-property invariance; parse `config.containerId` at the boundary.
   - `config-schema.ts` — Zod schema for the project-scoped config. This is the **single source of truth** — the central `src/config/schema.ts` imports it.
   - `manifest.ts` — the `PMProviderManifest`, wiring shared helpers (`auth-headers`, `makeHmacSha256Verifier`). Declare `configSchema`, `configFixture`, `discoveryCapabilities`, `wizardSpec`, `lifecycle.enabled`, `createDiscoveryProvider`. The conformance harness runs round-trip + lifecycle + webhook-verify + trigger-self-hook checks against each declared contract.
   - `router-adapter.ts`, `triggers/*.ts`, `webhook.ts`, `platform-client.ts` — same as before.
   - `index.ts` — side-effect module calling `registerPMProvider(<provider>Manifest)`.

2. **Wire the manifest** via a single import in `src/integrations/pm/index.ts` (`import './<provider>/index.js';`). No other edit to any shared file is needed for registration — the `single-entrypoint` test guards this.

3. **Frontend folder** at `web/src/components/projects/pm-providers/<provider>/`: `wizard.ts` (`ProviderWizardDefinition` with `useProviderHooks` if the provider needs discovery / label creation / custom-field creation), `index.ts`. Add one line to `pm-wizard.tsx` to register. For shared wizard steps declared on `manifest.wizardSpec`, the generator in `pm-providers/generator.tsx` dispatches directly to the real shared step components at `pm-providers/steps/*.tsx` — there are **seven** kinds: `credentials`, `container-pick`, `status-mapping`, `label-mapping`, `webhook-url-display`, `project-scope`, `custom-field-mapping`. A provider with purely standard steps writes **zero** per-provider step components; this is what Trello, JIRA, and Linear all do post-spec 011. Provide `providerHooks` (returned from `useProviderHooks`) to forward discovery data + mutation callbacks into the shared components; the generator spreads `ctx.providerHooks` as props. Unknown step `kind` values still warn-and-render a placeholder. **Provider-specific UI** (Trello OAuth popup, JIRA issue-type mapping) ships as `kind: 'custom'` steps declared on the manifest and resolved to provider-folder components by the wizard definition.

4. **Lifecycle fixture** at `tests/helpers/<provider>LifecycleFixture.ts`. Add the fixture key to `LIFECYCLE_FIXTURES` in `tests/unit/integrations/pm-conformance.test.ts`. Trivial providers can reuse `createFakePMProvider()` (see Trello/JIRA/Linear fixtures).

5. **Run the conformance harness**: `npx vitest run --project unit-core tests/unit/integrations/pm-conformance.test.ts`. Behavioral contracts run against your provider automatically once `configSchema` / `discoveryCapabilities` / `lifecycle` are declared. Failures name the contract.

6. **Provider-specific unit tests** in `tests/unit/pm/<provider>/` — adapter tests (vi.mock the client), config-schema round-trip, discovery shape, wizardSpec, adapter branded IDs.

That's it. The `new-provider-surface` snapshot test proves your PR touches **no** shared infrastructure file.

---

## Non-PM integrations

SCM (GitHub) and alerting (Sentry) integrations retain the legacy `IntegrationModule` pattern with self-registration in `src/github/register.ts` and `src/sentry/register.ts`. A future spec may extend the manifest pattern to those categories.

---

## Checklist implementation by provider

Different PM providers have different native concepts of "checklist". The `PMProvider` interface exposes a uniform API (`getChecklists`, `createChecklist`, `addChecklistItem`, `updateChecklistItem`, `deleteChecklistItem`), but adapters implement them differently:

| Provider | Implementation | Where items live |
|---|---|---|
| **Trello** | Native Trello checklist API | In-card checklists (lightweight items, not separate cards) |
| **Linear** | Inline markdown in description | `### {Checklist Name}` heading + `- [ ]` / `- [x]` lines in the issue's description |
| **JIRA** | Inline markdown in description (via ADF round-trip) | `### {Checklist Name}` heading + `- [ ]` / `- [x]` lines in the issue's description |

**Why inline markdown for Linear and JIRA?** Both providers support markdown checkboxes natively in their description editors but lack a dedicated lightweight checklist primitive — sub-issues and subtasks are full work items, which clutters boards when used for things like acceptance criteria or implementation steps. Inline markdown matches Trello's lightweight semantics without creating orphan issues. See [spec 008](../../docs/specs/008-inline-checklists.md) for full rationale.

The shared engine that parses, appends, toggles, and removes inline checklist items lives at `src/pm/_shared/inline-checklist.ts` and is consumed by both the Linear and JIRA adapters.
