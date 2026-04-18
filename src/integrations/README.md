# PM Integration Architecture

CASCADE's PM providers (Trello, JIRA, Linear, and any future Asana/GitLab/ClickUp) are built on a **provider manifest** pattern. One file describes the provider end-to-end; one registry iterates manifests; a conformance harness guarantees each manifest is complete.

This document is the canonical guide for adding a new PM provider. Spec [006](../../docs/specs/006-pm-integration-plug-and-play.md) delivered the pattern in five plans landed between 2026-04-15 and 2026-04-16.

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
| `createLabel?` | Optional — enables the wizard's "Create label" button for this provider. |

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

Router and worker entry points import these side-effect modules:

```typescript
import './integrations/pm/index.js';  // registers all PM manifests
import './github/register.js';         // registers GitHubSCMIntegration
import './sentry/register.js';         // registers SentryAlertingIntegration
```

The PM barrel (`src/integrations/pm/index.ts`):
1. Imports each provider's `index.js` (side effect: `registerPMProvider(manifest)`).
2. Iterates `listPMProviders()` and mirrors each manifest's `pmIntegration` into the cross-category `integrationRegistry` — so `integration-validation.ts` and the capability resolver see PM providers alongside SCM + alerting.

SCM (GitHub) and alerting (Sentry) integrations remain on the legacy `IntegrationModule` pattern — the manifest pattern is PM-only (spec 006 scope). Both self-register via their own `register.ts` side-effect modules.

`pmRegistry` (`src/pm/registry.ts`) still exists as a **read-only delegate** over `pmProviderRegistry` — the ~9 unmigrated call sites (webhook handlers, manual runner, credential scope, lifecycle, GitHub adapter) keep working without changes. Prefer `getPMProvider(id)` / `listPMProviders()` from `src/integrations/pm/registry.ts` in new code.

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

---

## Adding a new PM provider (step by step)

1. **Create the backend folder** at `src/integrations/pm/<provider>/`. Implement `client.ts`, `adapter.ts`, `router-adapter.ts`, `triggers/*.ts`, `webhook.ts`, `platform-client.ts`. None of these files is imported by any file outside `src/integrations/pm/<provider>/`.

2. **Write the manifest** in `manifest.ts` exporting a `PMProviderManifest`. Wire the shared helpers: `auth-headers`, `makeHmacSha256Verifier` for the signature verifier, `resolveLabelId` if your provider rejects non-UUIDs.

3. **Register the manifest** in `index.ts` — a single side-effect module that calls `registerPMProvider(<provider>Manifest)`. Add one line to `src/integrations/pm/index.ts` that imports `./<provider>/index.js`.

4. **Create the frontend folder** at `web/src/components/projects/pm-providers/<provider>/`. Implement `adapters.tsx` (thin step-component wrappers), `wizard.ts` (`ProviderWizardDefinition` including `useProviderHooks` if your provider needs React hooks for discovery / label creation), and `index.ts` (`registerProviderWizard(<provider>Wizard)`). Add one line to `pm-wizard.tsx` that imports your `./pm-providers/<provider>/index.js`.

5. **Run the conformance harness**: `npm test tests/unit/integrations/pm-conformance.test.ts`. CI fails with a specific message for each missing or incorrect contract surface.

6. **Write provider-specific unit tests** in `tests/unit/pm/<provider>/` and `tests/unit/web/<provider>-*.test.ts`. The conformance harness covers contract invariants; you still need tests for your provider-specific logic (webhook parsing, field mappings, trigger dispatch).

That's it. No edits to shared router code, shared trigger registration, shared job extractor, or the main wizard component.

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
