# PM Integration Architecture

> ℹ️ Adding a `cascade-tools` gadget (CLI command consumed by agents)? See [`src/gadgets/README.md`](../gadgets/README.md) for the authoring contract — declarative metadata (`cliAliases`, `fileInputAlternatives`, `examples`), the structured error envelope, and the single-entrypoint invariant. PM provider registration (this file) is a separate surface.

CASCADE's PM providers (Trello, JIRA, Linear, and any future Asana/GitLab/ClickUp) are built on a **provider manifest** pattern. One file describes the provider end-to-end; one registry iterates manifests; a behavioral conformance harness guarantees each manifest satisfies its declared contracts.

This document is the canonical guide for adding a new PM provider. Five specs shape it:

- **Spec [006](../../docs/specs/006-pm-integration-plug-and-play.md.done)** — introduced the manifest pattern + wiring-level conformance (2026-04-15/16).
- **Spec [009](../../docs/specs/009-pm-integration-hardening.md.done)** — hardened the contracts: branded ID types, manifest-owned config schemas (eliminating the #1138/#1142 drift class), unified `pm.discover` endpoint, behavioral conformance harness with in-memory lifecycle scenario, single registration entrypoint, and auth-header provenance enforcement.
- **Spec [010](../../docs/specs/010-pm-integration-hardening-followups.md.done)** — follow-up cleanup: generic `pm.discovery.createLabel` / `createCustomField` mutation endpoints + manifest hooks, `currentUser` discovery capability, real shared React components for every `StandardStepKind`.
- **Spec [011](../../docs/specs/011-pm-wizard-shared-migration.md.done)** — migrated all three production providers (Trello, JIRA, Linear) onto the shared step components; added a 7th `StandardStepKind: custom-field-mapping`; widened `container-pick` / `project-scope` / `webhook-url-display` with optional props; deleted the three legacy `pm-wizard-{trello,jira,linear}-steps.tsx` files.
- **Spec [012](../../docs/specs/012-pm-webhook-manifest-migration.md.done)** — migrated each provider's webhook UX (programmatic create for Trello/JIRA, signing-secret + manual-setup for Linear) into its own manifest webhook step adapter. Deleted the legacy `WebhookStep` + `LinearWebhookInfoPanel` + supporting hooks. Every PM wizard step now renders via the manifest path without exception.

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
    wizard.ts         // ProviderWizardDefinition (steps, save transform, edit hydration)
    state.ts          // provider-owned WizardState slice, actions, reducer, defaults
    hooks.ts          // provider-owned discovery/mutation/webhook hooks + auth wrappers
    webhook-step.tsx  // optional provider webhook UX composition around shared steps
    steps.tsx         // optional custom-step components only
```

The registries are the only surface the rest of the codebase sees. A new provider wires itself through the backend PM barrel and the frontend PM-provider barrel; it does not edit shared wizard orchestration (`pm-wizard.tsx`, `pm-wizard-hooks.ts`, or `pm-wizard-common-steps.tsx`). The shared dashboard state file only composes provider-owned state slices and remains the temporary explicit exception documented in step 4 below.

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
| `configToCredentials?` | Optional — promotes non-secret connection fields from `project_integrations.config` into the credentials bag `createDiscoveryProvider` consumes. Signature: `(config: unknown) => Record<string, string>`. Invoked only on the `projectId` path of `pm.discovery.*`; `project_credentials` values win on key collisions. Declare this when your provider stores tenant/host info in config instead of credentials (JIRA's `baseUrl` → `base_url`). Without it, edit-mode wizard re-verification constructs a client with empty host info — see prod incident 2026-04-24. |

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
| `buildEditState` | Hydrates edit-mode state from saved config + configured credential keys. This is provider-owned and must never return raw credential values. |
| `isSetupComplete` | `(state) => boolean`. True when the wizard can be saved. |
| `useProviderHooks?` | Optional — composes the provider's React hooks (discovery, label creation, custom-field creation) inside a shell component. Return value flows into each step's `providerHooks` prop. |

`ManifestProviderWizardSection` (`web/src/components/projects/pm-providers/manifest-section.tsx`) is the shell component that hosts the unconditional `useProviderHooks` call — it's only mounted when a manifest is registered for the active provider, so React's rules-of-hooks hold.

Frontend provider ownership is intentionally broad:

- **State slice** — provider credential/config fields, action types, reducer cases, defaults, and provider-specific selectors live in `pm-providers/<provider>/state.ts`. `pm-wizard-state.ts` composes those slices and is the only shared dashboard state surface that may need a new-provider edit while the shared state type still aggregates all provider fields.
- **Config serialization** — `ProviderWizardDefinition.buildIntegrationConfig` in `pm-providers/<provider>/wizard.ts` is the only save-payload transform for that provider.
- **Edit hydration** — `ProviderWizardDefinition.buildEditState` restores saved provider config into wizard state and sets stored-credential flags from configured credential keys; shared `pm-wizard.tsx` only dispatches the returned partial state.
- **Auth metadata** — `auth`, `credentialPersistence`, and `formatVerificationDisplay` live in the provider wizard definition. Shared verification, credential readiness, mutation auth, and save code read this metadata instead of branching by provider.
- **Hooks and webhook UX** — discovery, label/custom-field creation, webhook list normalization, webhook create/delete controls, signing-secret fields, and provider-specific mutation wrappers live under `pm-providers/<provider>/hooks.ts` and provider step adapters such as `webhook-step.tsx`. Shared `pm-wizard-hooks.ts` stays provider-agnostic.

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
- `dispatchPMAck` (the consolidated PM-ack helper at `src/router/pm-ack-dispatch.ts`) reaches this provider without throwing — pinned by the per-provider assertion added in spec 017 plan 1

A `TestProvider` fixture in `tests/helpers/testPMProvider.ts` is the minimal reference implementation — copy its shape when starting a new provider. The harness runs against TestProvider + Trello + JIRA + Linear.

### PM-ack dispatch coverage invariant (spec 017 plan 1)

Router-side PM acknowledgment posting (the comment that says "🔧 On it" on the PM card when a PM-focused agent like `backlog-manager` starts work, triggered from a GitHub webhook) goes through **one** code path: `dispatchPMAck` in `src/router/pm-ack-dispatch.ts`. That helper looks up the provider in the manifest registry and invokes `manifest.platformClientFactory(projectId).postComment(workItemId, message)` directly — **no `pmType` literal branching anywhere on the dispatch surface**.

The consolidation closed a parallel-path drift incident verified live on 2026-04-29 (`ucho`): the router-adapter's local helper had Trello + JIRA branches but no Linear branch, so PM-focused agents triggered against Linear-based projects silently skipped their ack with `WARN: Unknown PM type for PM-focused agent ack, skipping` (24× per day in prod). A sibling helper at `src/triggers/shared/pm-ack.ts` had all three branches; both now delegate to `dispatchPMAck`.

A new PM provider lands the dispatch path **for free** the moment its manifest is registered — no edits to `pm-ack-dispatch.ts` or to either of the call sites. Failure modes:
- Provider's `platformClientFactory` returns a client whose `postComment` throws → conformance harness's `dispatchPMAck reaches this provider without throwing` assertion fails in CI with a precise per-provider message.
- A future maintainer adds `if (pmType === 'asana')` branching to either call site → the static guard at `tests/unit/router/pm-ack-dispatch.test.ts` (PM-ack dispatch surface: no literal pm-type branching) fails loudly with a file:line citation.
- Project pinned to a `pm.type` that's no longer in the registry (configuration error) → `dispatchPMAck` logs at ERROR + captures Sentry under tag `pm_ack_unknown_pm_type` (no longer a silent WARN).

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
| Parent wizard | `pm-wizard.tsx` now iterates over `manifestDef.steps` dynamically — the old spec-006-era "3 hardcoded stepIndex slots" layout is gone. Each manifest step gets its own WizardStep slot. The legacy `WebhookStep` was retained temporarily for programmatic webhook registration (Trello/JIRA) and signing-secret UX (Linear); it was fully migrated into the manifest path in spec 012 (see Post-spec-012 additions below). |
| 7th StandardStepKind | `custom-field-mapping` shared component (with optional `onCreateCustomField` + `fieldDefaults` props) wires `manifest.createCustomField`. Trello and JIRA use it; Linear doesn't have a custom-field concept. |
| Shared-component widenings (additive) | `container-pick` and `project-scope` support optional `searchable: boolean` (renders via cmdk `Combobox`). `webhook-url-display` supports optional inline signing-secret input (`secretFieldRole` / `secretValue` / `onSecretChange`). `label-mapping` supports optional `labelDefaults?` to pre-populate the Create input + thread color. `custom-field-mapping` supports optional `fieldDefaults?`. |
| Shared surface guard | Step-component file pin extended to seven entries. |

### Post-spec-012 additions (2026-04-18+)

| Area | Change |
|---|---|
| Webhook-UX migration complete | Every PM wizard step, without exception, renders via the manifest path. Trello, JIRA, and Linear each own their webhook step via a per-provider adapter (`pm-providers/<provider>/webhook-step.tsx`) — Fragment composition around the shared `WebhookUrlDisplayStep`. Trello + JIRA compose with programmatic "Create Webhook" button + active-webhooks list + delete + curl fallback (via existing `webhooks.create/list/delete({trelloOnly|jiraOnly:true})` tRPC endpoints). Linear composes with info banner + `ProjectSecretField` (`LINEAR_WEBHOOK_SECRET`) + 5-step manual setup instructions. |
| Legacy deletions | `WebhookStep` + `LinearWebhookInfoPanel` + `useWebhookManagement` + `useLinearWebhookInfo` all deleted. `pm-wizard-common-steps.tsx` now only exports `SaveStep`. Legacy test file `pm-wizard-webhooks-step.test.ts` deleted — assertions moved into per-provider adapter tests. |
| Parent-wizard filter | The `-webhook` id-skip filter (stopgap from plan 011/4) is gone. `renderedManifestSteps = manifestDef.steps.map(...)` — no filter. |
| New-provider guarantee | Adding a PM provider requires zero edits to `pm-wizard.tsx`, `pm-wizard-common-steps.tsx`, or `pm-wizard-hooks.ts`. New providers add one import to the frontend barrel (`web/src/components/projects/pm-providers/index.ts`) — the symmetric counterpart of the backend barrel — and `pm-wizard.tsx` picks it up automatically. The provider picker, edit hydration dispatch (`ProviderWizardDefinition.buildEditState`), config serialization (`ProviderWizardDefinition.buildIntegrationConfig`), verification-button readiness (`areCredentialsReadyFromMetadata`), mutation auth path (`buildProviderAuthArgFromMetadata`), and save credential persistence are all metadata/provider-definition driven; no shared edits required beyond the barrel import. **Shared dashboard state** (`pm-wizard-state.ts`) must still compose the new provider's state slice and action type — see step 4 of "Adding a new PM provider" below. |

---

## Adding a new PM provider (step by step)

Spec 009 AC #10: **a new PM provider PR should not need to edit shared router / worker / CLI / dashboard / configMapper / central schema files**. The orchestration and schema work lives in your provider folder + your wizard folder + one import in `src/integrations/pm/index.ts` + one import in `web/src/components/projects/pm-providers/index.ts`. The shared wizard orchestration files (`pm-wizard.tsx`, `pm-wizard-hooks.ts`, `pm-wizard-common-steps.tsx`) are guarded shared surface and should not change for a new provider. The one shared dashboard file that still requires a new-provider edit is `pm-wizard-state.ts` (step 4 below) — it composes the provider's state slice into `WizardState`, `WizardAction`, initial state, and reducer delegation. Edit-mode config hydration belongs on the provider's `ProviderWizardDefinition.buildEditState`; save-payload serialization belongs on `ProviderWizardDefinition.buildIntegrationConfig`; provider hook auth and mutation wiring belong in provider-owned metadata/hooks. The `tests/unit/integrations/new-provider-surface.test.ts` guard enforces the shared-file invariant for orchestration and schema files; `pm-wizard-state.ts` is the deliberate exception.

1. **Backend folder** at `src/integrations/pm/<provider>/`:
   - `client.ts` (or reuse a sibling under `src/<provider>/`) — your REST / GraphQL client. Must use `withXxxCredentials()` + AsyncLocalStorage credential scoping; never hand-assemble Bearer headers (see `_shared/auth-headers.ts`).
   - `adapter.ts` — your `PMProvider` implementation. Narrow method parameters to branded `ContainerId` / `LabelId` / `StateId` from `src/pm/ids.ts` via TypeScript method bivariance — direct adapter callers then get compile-time protection against state-name-vs-ID confusion (#1117/#1137/#1139). `createWorkItem` keeps `CreateWorkItemConfig` due to TS object-property invariance; parse `config.containerId` at the boundary.
   - `config-schema.ts` — Zod schema for the project-scoped config. This is the **single source of truth** — the central `src/config/schema.ts` imports it.
   - `manifest.ts` — the `PMProviderManifest`, wiring shared helpers (`auth-headers`, `makeHmacSha256Verifier`). Declare `configSchema`, `configFixture`, `discoveryCapabilities`, `wizardSpec`, `lifecycle.enabled`, `createDiscoveryProvider`. The conformance harness runs round-trip + lifecycle + webhook-verify + trigger-self-hook checks against each declared contract.
   - `router-adapter.ts`, `triggers/*.ts`, `webhook.ts`, `platform-client.ts` — same as before.
   - `index.ts` — side-effect module calling `registerPMProvider(<provider>Manifest)`.

2. **Wire the backend manifest** via a single import in `src/integrations/pm/index.ts` (`import './<provider>/index.js';`). No other backend file needs to change — the `single-entrypoint` test guards this.

3. **Frontend folder** at `web/src/components/projects/pm-providers/<provider>/`: `wizard.ts` (`ProviderWizardDefinition` with `auth`, `credentialPersistence`, `formatVerificationDisplay`, `buildIntegrationConfig`, `buildEditState`, and `useProviderHooks` if the provider needs discovery / label creation / custom-field creation / webhook registration), `state.ts` for the provider-owned wizard state slice/actions/reducer/defaults, `hooks.ts` for provider-owned discovery/mutation/auth/webhook wrappers, `auth.ts` for reusable auth metadata when useful, and `index.ts` for side-effect registration (`registerProviderWizard(<provider>ProviderWizard)`). For shared wizard steps declared on `manifest.wizardSpec`, the generator in `pm-providers/generator.tsx` dispatches directly to the real shared step components at `pm-providers/steps/*.tsx` — there are **seven** kinds: `credentials`, `container-pick`, `status-mapping`, `label-mapping`, `webhook-url-display`, `project-scope`, `custom-field-mapping`. A provider with purely standard steps writes **zero** per-provider step components; Trello, JIRA, and Linear all use the shared components for every standard kind. Provide `providerHooks` (returned from `useProviderHooks`) to forward discovery data + mutation callbacks into the shared components; the generator spreads `ctx.providerHooks` as props. Unknown step `kind` values still warn-and-render a placeholder. **Provider-specific UI** ships either as (a) `kind: 'custom'` steps declared on the manifest and resolved to provider-folder components (Trello OAuth popup, JIRA issue-type mapping), or (b) Fragment compositions around a shared step when the base UX is standard but needs augmentation (Trello/JIRA webhook steps compose `WebhookUrlDisplayStep` + programmatic Create UX + active-webhook normalization; Linear composes `WebhookUrlDisplayStep` + `ProjectSecretField` + setup instructions — see `pm-providers/{trello,jira,linear}/webhook-step.tsx` for the reference composition pattern). Shared `pm-wizard-hooks.ts` remains limited to metadata-driven verification/save shells and provider-agnostic mutation factories.

4. **Update shared dashboard state** in `web/src/components/projects/pm-wizard-state.ts`. This is the one shared dashboard file a new provider must edit while `WizardState` remains an aggregate type:
   - Import the provider's state-slice helpers from `pm-providers/<provider>/state.ts`.
   - Compose the provider slice into `WizardState`, `WizardAction`, `createInitialState`, and `wizardReducer` delegation.
   - Keep provider-specific credential fields, action definitions, defaults, and reducer logic inside the provider `state.ts`; reducer cases that mutate credentials should clear `verificationResult` and `verifyError`.

   Edit-mode hydration is provider-owned: implement `buildEditState(initialConfig, configuredKeys)` on the provider's `ProviderWizardDefinition`. It should set `hasStoredCredentials` from the relevant persisted credential keys and restore saved config values (container IDs, status/label mappings) without returning raw credential values.

   Save config serialization is also provider-owned: implement `buildIntegrationConfig(state)` on the provider's `ProviderWizardDefinition`. The credential-readiness check (`areCredentialsReadyFromMetadata` in `pm-wizard-hooks.ts`) and the mutation auth path (`buildProviderAuthArgFromMetadata`) are fully metadata-driven — they read `manifestDef.auth.rawCredentials` and require **no changes** here.

5. **Wire the frontend wizard** via a single import in `web/src/components/projects/pm-providers/index.ts` (`import './<provider>/index.js';`). This frontend barrel is the symmetric counterpart of the backend barrel at `src/integrations/pm/index.ts` — `pm-wizard.tsx` imports the barrel once and never needs to be edited for a new provider.

6. **Lifecycle fixture** at `tests/helpers/<provider>LifecycleFixture.ts`. Add the fixture key to `LIFECYCLE_FIXTURES` in `tests/unit/integrations/pm-conformance.test.ts`. Trivial providers can reuse `createFakePMProvider()` (see Trello/JIRA/Linear fixtures).

7. **Run the conformance harness**: `npx vitest run --project unit-core tests/unit/integrations/pm-conformance.test.ts`. Behavioral contracts run against your provider automatically once `configSchema` / `discoveryCapabilities` / `lifecycle` are declared. Failures name the contract.

8. **Provider-specific unit tests** in `tests/unit/pm/<provider>/` — adapter tests (vi.mock the client), config-schema round-trip, discovery shape, wizardSpec, adapter branded IDs.

The shared orchestration files (`pm-wizard.tsx`, `pm-wizard-hooks.ts`, `pm-wizard-common-steps.tsx`) require zero edits beyond the barrel import in step 5. The `new-provider-surface` snapshot test proves your PR does not modify shared router / worker / CLI / dashboard orchestration or central schema files. The one deliberate shared-dashboard exception is `pm-wizard-state.ts` for provider-specific state fields and reducer actions (step 4 above).

---

## Non-PM integrations

SCM (GitHub) and alerting (Sentry) integrations retain the legacy `IntegrationModule` pattern with self-registration in `src/github/register.ts` and `src/sentry/register.ts`. A future spec may extend the manifest pattern to those categories.

---

## Friction report materialization

Friction reports are PM-backed work items filed by the `ReportFriction` gadget. Providers do **not** add a new adapter method for this feature. The shared materializer at `src/friction/materialize.ts` uses the existing `PMProvider` CRUD surface:

1. Resolve placement from project config with `getFrictionContainerId(project)`.
2. Call `provider.createWorkItem({ containerId, title, description, labels: [] })`.
3. Resolve an optional destination with `getFrictionStatusDestination(project)`.
4. Call `provider.moveWorkItem(workItem.id, destination)` when a destination exists.

That means a new provider only needs correct implementations of the existing `createWorkItem` and `moveWorkItem` methods plus the normal config schema fields:

| Provider shape | Friction slot |
|---|---|
| Trello list-based config | `lists.friction` |
| JIRA status-based config | `statuses.friction` |
| Linear status-based config | `statuses.friction` |

If the slot is missing, the materializer returns a skipped result with reason `friction_slot_missing` instead of throwing. The sidecar/outbox layer can then keep the agent run non-blocking while operators fix configuration.

---

## Checklist implementation by provider

Different PM providers have different native concepts of "checklist". The `PMProvider` interface exposes a uniform API (`getChecklists`, `createChecklist`, `addChecklistItem`, `updateChecklistItem`, `deleteChecklistItem`) plus an optional bulk creation path (`createChecklistWithItems`), but adapters implement them differently:

| Provider | Implementation | Where items live |
|---|---|---|
| **Trello** | Native Trello checklist API | In-card checklists (lightweight items, not separate cards) |
| **Linear** | Inline markdown in description | `### {Checklist Name}` heading + `- [ ]` / `- [x]` lines in the issue's description |
| **JIRA** | Inline markdown in description (via ADF round-trip) | `### {Checklist Name}` heading + `- [ ]` / `- [x]` lines in the issue's description |

**Why inline markdown for Linear and JIRA?** Both providers support markdown checkboxes natively in their description editors but lack a dedicated lightweight checklist primitive — sub-issues and subtasks are full work items, which clutters boards when used for things like acceptance criteria or implementation steps. Inline markdown matches Trello's lightweight semantics without creating orphan issues. See [spec 008](../../docs/specs/008-inline-checklists.md.done) for full rationale.

The shared engine that parses, upserts, toggles, and removes inline checklist items lives at `src/pm/_shared/inline-checklist.ts` and is consumed by both the Linear and JIRA adapters. Inline checklist creation is idempotent by exact markdown heading and exact item text: repeated writes for the same `### {Checklist Name}` section merge into the first matching section, duplicate sections with the same heading are collapsed while preserving non-checkbox prose, duplicate rows converge to one row, and checked state wins if any duplicate row is checked. This is intentional for CASCADE-generated checklists and keeps provider/tool retries from duplicating `Implementation Steps` or `Acceptance Criteria` blocks. Trello remains on native checklists and does not use this markdown merge behavior.

Because Linear and JIRA checklist mutations rewrite the whole description, their adapters serialize the full read/mutate/write operation with `withDescriptionMutationLock(provider, workItemId, fn)` from `src/pm/_shared/description-mutation-lock.ts`. Keep future inline-description mutations inside that guard; otherwise concurrent `cascade-tools pm update-checklist-item` processes can overwrite each other's description snapshots without a provider-side conflict error. Initial checklist creation for inline-description providers should implement `createChecklistWithItems` so `AddChecklist` can create the section and all starting rows in one locked description mutation instead of `createChecklist` plus one write per item. Linear can briefly serve stale descriptions after accepting `linearClient.updateIssue()`, so Linear records each successful description write in an in-process recent-description cache and uses that cached value as the next locked mutation's base while the provider catches up. Do not replay an accepted append solely because readback is stale; rely on idempotent upsert helpers plus the recent-description cache to keep retries and consecutive writes from duplicating or losing inline checklist content. Because `withDescriptionMutationLock` is a **filesystem** lock shared by separate `cascade-tools` processes, Linear also writes a durable cross-process sidecar (via `writeLockedDescription` / `readLockedDescription` in `description-mutation-lock.ts`) while holding the lock after each successful PUT. The next process that acquires the same lock reads the sidecar as its fresh base, preventing it from overwriting the previous process's accepted write with a stale Linear snapshot.

The default description-lock wait budget is intentionally lower than the checklist tool timeout: the lock waits up to 45s, while `AddChecklist`, `PMUpdateChecklistItem`, and `PMDeleteChecklistItem` allow 60s. Keep that relationship when adjusting either value so a queued, legitimate Linear/JIRA checklist mutation is not aborted by the outer tool runner before the lock wait can complete.

---

## Image delivery contract

Spec 016 hardened the work-item-image pipeline so user-pasted screenshots (Linear especially, but the rules generalize) reliably reach the agent worker as files on disk. New PM providers should follow this contract; do nothing extra and image delivery just works.

### How the shared resolution path works

1. **Extract URL refs** from the work-item description and each comment via `extractMarkdownImages()` (`src/pm/media.ts`). A `MediaReference` is produced for every `![alt](url)` match. The provider does NOT need its own extraction logic.
2. **Pre-download MIME inference** (a hint, not a verdict): `mimeTypeFromUrl()` derives a MIME from the URL pathname's extension. For URLs whose hostname is in `IMAGE_HOST_ALLOWLIST` (currently `uploads.linear.app`) AND whose pathname has no recognised extension, the inference returns `'image/*'` — a wildcard sentinel that survives the image-only filter. Add a host to the allowlist only if its `Content-Type` headers are reliable.
3. **Filter** via `filterImageMedia()` — drops anything that isn't an image MIME or the `image/*` wildcard.
4. **Download** via `downloadAndPrepareImages()` (`src/pm/download-and-prepare.ts`) — the shared per-provider dispatch loop. The download response's `Content-Type` header is the AUTHORITATIVE MIME — it resolves the wildcard and overrides any URL-extension-derived guess.
5. **Write to disk** at `.cascade/context/images/work-item-<id>-img-<index>.<ext>` — extension is derived from the resolved MIME.

### What providers should NOT do

- Don't write your own MIME-detection logic. The shared resolution path covers all known PM provider URL shapes.
- Don't download images yourself in your adapter — let `downloadAndPrepareImages` do it.
- Don't surface `getAttachments()` for inline-pasted images. That method is for formal Attachment records (Slack/GitHub link previews, integration cards) — distinct from inline pastes which live in description / comment markdown.

### Diagnostic log line

Every work-item fetch (boot path AND runtime read-work-item gadget) emits one INFO-level log line with the literal prefix `[image-pipeline] work-item-fetch summary` and the field schema:

```
{
  provider: 'linear' | 'trello' | 'jira' | 'unknown',
  workItemId: string,
  urlsDetected: number,    // pre-filter count
  urlsAfterFilter: number, // post-filterImageMedia count
  urlsDownloaded: number,
  urlsFailed: number,
  urlsByMimeType: Record<string, number>,
}
```

Operators triaging a "no image delivered" report grep for the literal prefix in `cascade runs logs <runId>` output. One line per fetch tells the whole story.

### When a provider's host serves untrustworthy `Content-Type`

If your provider's upload host returns `application/octet-stream` (or wrong) on the actual GET response, the download-time resolution can't recover. Two options: (a) don't add the host to `IMAGE_HOST_ALLOWLIST` — let the URL-extension path do its job; (b) if URLs are also extension-less, file an issue describing the host's behavior so we can layer in a per-host content-type override. Don't hard-code MIMEs in your adapter — keep MIME resolution shared.

### Linear: GraphQL surface for inline images

Spec 016/3 captured a fixture and pinned the rule for Linear specifically. The findings:

- **`Issue.description` (markdown) is the canonical surface for inline-pasted images.** When a user pastes a screenshot into Linear's issue editor, Linear stores the upload at `https://uploads.linear.app/<uuid>` (often extension-less) and inserts standard markdown image syntax `![alt](url)` into the description. The Linear adapter's `extractMarkdownImages(issue.description)` is the right call — it's what `getWorkItem` already does at `src/pm/linear/adapter.ts:61`.
- **Comment bodies follow the same convention.** Each `Comment.body` field is markdown; pasted screenshots show up as `![](https://uploads.linear.app/<uuid>)` exactly like the description. `extractMarkdownImages(comment.body, 'comment')` covers them.
- **`Issue.attachments` is the WRONG surface for inline images.** The Linear GraphQL `Issue.attachments` connection holds formal Attachment records — link previews from Slack threads, GitHub PRs, Sentry alerts, and other integration cards. They have `url` fields but they are NOT user-pasted screenshots. The Linear adapter's `getAttachments(issueId)` (at `src/linear/client.ts:542`) correctly returns these as `LinearAttachment` for the dedicated attachment surface; do NOT extract images from this connection.
- **Regression net.** The captured fixture lives at `tests/fixtures/linear-issue-with-screenshot.json`. The unit test at `tests/unit/pm/linear/extraction-coverage.test.ts` loads the fixture and asserts every inline image is extracted — fails LOUDLY with a clear message if Linear ever changes payload shape in a way that loses inline images.
- **No new GraphQL surface to query.** As of spec 016/3 the Linear API exposes inline-pasted images only via the `description` and `Comment.body` markdown fields. There is no `descriptionData` rich-text JSON tree that would expose them differently, and no `attachments(includeInline: true)` filter. Future Linear API drift would surface as a fixture-test failure.

See [spec 016](../../docs/specs/016-pm-image-delivery-reliability.md.done) for the full rationale and the live incident this contract closed.

---

## Alerting work-item materializer

**Spec [019](../../docs/specs/019-sentry-alert-pm-materialization.md.done)** added a generic materializer that converts an external alert event into a real PM work item so the alerting agent runs against a native PM card/issue with full lifecycle support (budget tracking, status transitions, label writes). See the spec for full rationale; this section covers the contracts new providers must respect.

### `materializeAlertWorkItem` contract

```
materializeAlertWorkItem(source, externalId, project, hints) → pmNativeWorkItemId
```

Located at `src/integrations/alerting/_shared/materialize.ts`. Callable from any alerting worker path; today Sentry materializes on the worker side after trigger resolution for event alerts, issue-lifecycle webhooks, and metric alerts.

- **`source`** — `'sentry' | 'sentry-issue' | 'sentry-metric' | 'pagerduty' | 'datadog' | 'github-alert'` (union grows as new sources are added). The Sentry literals distinguish alert-rule event alerts, issue-lifecycle webhooks, and metric alerts so unique external mappings do not collide.
- **`externalId`** — the alert provider's stable issue/alert ID (e.g. Sentry issue ID `117972276`).
- **`project`** — the full `ProjectConfig` for the target project. The materializer uses `project.pm` to determine which PM provider to call and which `alerts` slot to create the card in.
- **`hints`** — `{ title: string; descriptionMarkdown: string }` — content to put in the card. Built by the per-source format helper (see below).
- **Returns** — the PM-native work item ID (Trello card ID, JIRA issue key, Linear issue ID). This ID goes directly into `TriggerResult.workItemId`; no synthetic prefix.

The function throws `AlertSlotMissingError` (from `src/integrations/alerting/_shared/types.ts`) when the project's PM config doesn't have the `alerts` slot configured. Callers catch this and return `null` — no dispatch, operator must configure the slot.

### Storage contract — `pr_work_items` idempotency

Each materialization writes a row to the `pr_work_items` table (or updates the existing one) using the `(projectId, externalSource, externalId)` partial UNIQUE index:

```sql
CREATE UNIQUE INDEX uq_pr_work_items_project_external
  ON pr_work_items (project_id, external_source, external_id)
  WHERE external_source IS NOT NULL;
```

A second Sentry alert for the same source/external ID on the same project hits the unique index and updates the existing row (lazy-heal: if the PM card was deleted, the UPDATE fetches the stored `work_item_id`, calls `getWorkItem`, and re-creates the card on 404). This makes the materializer fully idempotent — the same Sentry source event always produces the same `workItemId`.

After worker-side materialization, the Sentry webhook worker mirrors display metadata back into the resolved `TriggerResult`: `workItemId`, `workItemTitle` from the formatted alert hints, `workItemUrl` from the active PM provider, and the same fields on `agentInput`. Shared run persistence, dashboard headers, environment setup, and progress comments consume those values without alert-specific call-site branches.

### Required `alerts` slot per provider

The materializer calls `getAlertsContainerId(project)` / `getAlertsStatusKey(project)` (from `src/pm/config.ts`) to find the target list/status. These read:

| Provider | Config key | Meaning |
|---|---|---|
| Trello | `lists.alerts` | Trello list ID where alert cards are created |
| JIRA | `statuses.alerts` | JIRA status name/ID applied after issue creation |
| Linear | `statuses.alerts` | Linear workflow state UUID applied after issue creation |

Configure this slot in the PM wizard's **Status Mapping** step (the "Alerts" row). The validation rule in `src/triggers/shared/integration-validation.ts` emits a `pm`-category error at agent pre-flight when an alerting trigger is enabled but this slot is unset.

### Optional `cascade-alert` label slot

A `cascade-alert` label (Trello: `labels['cascade-alert']`; JIRA: `labels.cascadeAlert`; Linear: `labels.cascadeAlert`) is applied to the work item after creation when configured. Optional — alert cards are created without it if the slot is unset.

### Per-source format helpers

Each alert source has a format helper that maps the raw webhook payload to `AlertHints`. Today Sentry has three helpers in `src/integrations/alerting/_shared/format.ts`: `formatSentryCardBody` (`sentry`), `formatSentryIssueLifecycleCardBody` (`sentry-issue`), and `formatSentryMetricCardBody` (`sentry-metric`). Adding PagerDuty, Datadog, or GitHub Alerts follows this pattern:

1. Add the source literal to `AlertSource` in `src/integrations/alerting/_shared/types.ts`.
2. Add a `formatXxxCardBody(payload) → AlertHints` function in `format.ts` (or a new per-source file).
3. Create a trigger class that calls `materializeAlertWorkItem(source, externalId, project, hints)`.
4. Register the trigger in the alerting integration's `triggerHandlers` array.
