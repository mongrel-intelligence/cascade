# PM integrations

**Applies to:** `src/integrations/**`, `src/pm/**`, `src/jira/**`, `src/linear/**`, `src/trello/**`, `src/workflow/**`, `src/api/routers/pm-discovery.ts`, `src/api/routers/webhooks/**`, `web/src/components/projects/pm-providers/**`, `web/src/components/projects/pm-wizard*`

Read [`src/integrations/README.md`](../../src/integrations/README.md) before adding or changing a provider — it is the contract (manifest fields, conformance harness, step-by-step guide). Nothing below restates it; each bullet names the rule and the README section that specifies it.

## Adding or changing a provider

- One manifest (`src/integrations/pm/<provider>/manifest.ts`) plus one import in each barrel: `src/integrations/pm/index.ts` and `web/src/components/projects/pm-providers/index.ts`. Zero edits to `pm-wizard.tsx`, `pm-wizard-hooks.ts`, `pm-wizard-common-steps.tsx` — `tests/unit/integrations/new-provider-surface.test.ts` pins their hashes. The one shared dashboard file that still takes an edit is `pm-wizard-state.ts` (the provider's state slice + actions) → README § Adding a new PM provider.
- The provider owns its Zod config schema in `config-schema.ts`; `src/config/schema.ts` imports it. Declare `configSchema` + `configFixture` on the manifest so the conformance harness catches round-trip drift.
- Adapter call sites take branded `StateId` / `LabelId` / `ContainerId` from `src/pm/ids.ts` — passing a state *name* where an ID is expected must stay a compile error.
- Build auth headers only through `src/integrations/pm/_shared/auth-headers.ts`; the pre-commit hook runs `tests/unit/integrations/auth-header-provenance.test.ts` against hand-assembled `Bearer` strings.
- A discovery capability that backs a wizard picker must return the complete list (paginate) — the picker filters client-side → README § PMProviderManifest contract.
- Run `npx vitest run --project unit-core tests/unit/integrations/pm-conformance.test.ts` — failures name the violated contract.

## Router adapters (`src/router/adapters/*.ts`)

- Wrap `triggerRegistry.dispatch(ctx)` in `withPMScopeForDispatch(fullProject, dispatch)` (`src/router/adapters/_shared.ts`) **in addition to** the per-PM credential scope; mirror `github.ts:dispatchWithCredentials`. Without it the pipeline-capacity gate fails closed → [10-resilience § Max in-flight items](../architecture/10-resilience.md). CI: `tests/unit/integrations/pm-router-adapter-pm-scope.test.ts`.
- `extractProjectIdFromJob` must return `null` for other providers' jobs → README § PMProviderManifest contract.
- Ack posting goes through `dispatchPMAck` (`src/router/pm-ack-dispatch.ts`); never branch on `pmType` literals → README § PM-ack dispatch coverage invariant.

## JIRA

- Route every REST v3 call through `resolveJiraApiBaseUrl(creds)` (`src/jira/api-host.ts`); `authType` selects the host and both modes are HTTP Basic → README § JIRA authentication modes.
- Match statuses by locale-invariant **ID** first, name as fallback (`resolvePMStatusAgentByIdOrNameFromWorkflowDefinitions`, `transitions[].to.id`) → README § JIRA status matching is ID-based.
- Two projects on one JIRA key need a routing discriminator; matching is exact and case-sensitive → README § Shared-key routing contract.
- `createWorkItem` reads `issueTypes.task`, never `issueTypes.default` → README § JIRA issue-type mapping.

## Cross-provider contracts

- Custom workflow statuses: `resolveLifecycleConfig` must spread the full `lists` / `statuses` record; status-changed triggers resolve through `resolvePMStatusAgent*FromWorkflowDefinitions` → README § Custom workflow status.
- Inline checklists (Linear, JIRA) rewrite the whole description — keep every mutation inside `withDescriptionMutationLock` and implement `createChecklistWithItems` → README § Checklist implementation by provider.
- Never write MIME-detection or image-download logic in an adapter; `extractMarkdownImages` + `downloadAndPrepareImages` are the shared path → README § Image delivery contract.
- Friction and alert work items are plain `createWorkItem` + optional `moveWorkItem` into the `friction` / `alerts` slot → README § Friction report materialization, § Alerting work-item materializer.
