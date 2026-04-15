---
id: 002
slug: linear-webhook-setup-ux
plan: 2
plan_slug: wizard-webhooks-step
level: plan
parent_spec: docs/specs/002-linear-webhook-setup-ux.md
depends_on: [1-save-path-fix.md]
status: pending
---

# 002/2: Linear Wizard Webhooks Step — Correct Events List + Inline Signing Secret

> Part 2 of 2 in the 002-linear-webhook-setup-ux plan. See [parent spec](../../specs/002-linear-webhook-setup-ux.md).

## Summary

Plan 2 rewrites the Linear Webhooks step of the PM wizard so the setup instructions match what CASCADE actually consumes, and adds an inline signing-secret input next to the webhook URL. The user flow becomes: paste CASCADE's webhook URL into Linear, enable the three event families CASCADE handles, copy Linear's signing secret back into the adjacent CASCADE field, done — no detour through the Credentials tab.

Concretely, this plan modifies `LinearWebhookInfoPanel` in `web/src/components/projects/pm-wizard-common-steps.tsx` to:

1. Replace the `Enable events: Issues (created, updated, removed)` line with an explicit list — `Issues` (status transitions drive agent selection), `Comments` (bot @mentions trigger responses), `Issue Labels` (the "Ready to Process" label starts an agent). Each bullet carries a one-line rationale so a reviewer can verify the copy matches `src/triggers/linear/register.ts`.
2. Drop the "Optionally set a webhook secret and store it as `LINEAR_WEBHOOK_SECRET` in project credentials" trailing bullet, and instead render a `ProjectSecretField` with `envVarKey="LINEAR_WEBHOOK_SECRET"` directly underneath the webhook URL — identical in shape to the Sentry alerting tab's usage of the same component.

End-to-end verification depends on plan 1 having unblocked the Save step: after this plan lands, completing the Linear wizard in a browser must result in a working integration row AND (optionally) a stored webhook secret without any visit to the Credentials tab.

**Components delivered:**
- Modified `LinearWebhookInfoPanel` props and render tree in `web/src/components/projects/pm-wizard-common-steps.tsx`.
- New prop drilling from `PMWizard` → `WebhookStep` → `LinearWebhookInfoPanel` to pass the project ID and the existing `LINEAR_WEBHOOK_SECRET` credential metadata.
- Component-level tests for `LinearWebhookInfoPanel` covering event-list copy and secret-field presence / persistence / reflection.
- An integration test asserting Trello and JIRA wizard Webhooks steps are visually unchanged.
- Documentation update: `src/integrations/README.md` Linear section reflects the three-events list.

**Deferred to later plans in this spec:**
- Nothing. Plan 2 closes out the spec.

---

## Spec ACs satisfied by this plan

- Spec AC #1 (Instructions list matches handlers) — **full**
- Spec AC #2 (Inline secret input present in Webhooks step) — **full**
- Spec AC #3 (Pasting the secret persists it as `LINEAR_WEBHOOK_SECRET`) — **full**
- Spec AC #4 (Credentials tab stays in sync) — **full**
- Spec AC #9 (No regression to Trello/JIRA wizards) — **full**
- Spec AC #10 (Other providers' webhook-secret UX unchanged) — **full**

---

## Depends On

- Plan 1 (`1-save-path-fix.md`) — provides a working `projects.integrations.upsert` on dev, without which this plan's end-to-end acceptance cannot be verified in a browser.

Context to lift from the spec (do not re-argue):
- Webhook secret lives in the Webhooks step, not the Credentials step (Strategic decision #2).
- Signing secret remains optional (Strategic decision #3).
- Recommend exactly `Issues`, `Comments`, `Issue Labels` (Strategic decision #1) — do **not** add Reaction/Document/etc. in this plan.
- Reuse `ProjectSecretField`; do not invent a new component (Strategic decision #6).

---

## Detailed Task List (TDD)

### 1. Update `LinearWebhookInfoPanel` — events list copy

**Tests first** (`web/tests/components/projects/LinearWebhookInfoPanel.test.tsx` — new file; pick the testing stack already used by `web/` — likely `vitest` + `@testing-library/react`, same as other `web/tests/components/**/*.test.tsx` if any, or colocate as `*.test.tsx` alongside the component if the project convention is colocated):

- `renders a three-item events list: Issues, Comments, Issue Labels` — mount the component with a `webhookUrl`, assert three `<li>` children inside the "Enable events" block with matching `<strong>` labels. Snapshot-free assertions via `getByText`.
- `each events-list item has a one-line rationale matching a registered trigger` — assert the rendered text contains the phrases "status transitions" (for Issues), "mentions" (for Comments), and "Ready to Process" (for Issue Labels). Enough for a reviewer to confirm the copy traces back to `src/triggers/linear/register.ts`.
- `does not mention Documents, Emoji reactions, Customer requests, Cycles, Users, Initiatives, Project updates, Projects, Issue SLA, or Issue attachments` — assert none of those strings appear in the rendered panel. Prevents copy drift.
- `keeps the manual-setup-required blue info block` — assert the "Manual Webhook Setup Required" string is still present. Protects against collateral deletion.

**Implementation** (`web/src/components/projects/pm-wizard-common-steps.tsx`, `LinearWebhookInfoPanel`):

- Replace the single list item (line ~110–112) with three items:
  ```tsx
  <li>
    Enable events:
    <ul className="list-disc list-inside ml-4 mt-1 space-y-0.5">
      <li><strong>Issues</strong> — status transitions drive CASCADE's splitting / planning / implementation agents.</li>
      <li><strong>Comments</strong> — @mentions of the CASCADE bot trigger a response agent.</li>
      <li><strong>Issue Labels</strong> — adding the "Ready to Process" label starts an agent on the issue.</li>
    </ul>
  </li>
  ```
- Delete the trailing bullet "Optionally set a webhook secret and store it as `LINEAR_WEBHOOK_SECRET` in project credentials" — replaced by the inline field in the next task.
- Update the `<li>` that says "Select your team and save" to come *after* the events list and to now say "Select your team and save — webhooks are team-scoped in Linear".

### 2. Add inline `ProjectSecretField` for `LINEAR_WEBHOOK_SECRET`

**Tests first** (same test file):

- `renders a signing-secret input labelled "Webhook Signing Secret (optional)"` — mount with `projectId` and a `credential` prop set to `null`, assert an input with placeholder matching `lin_wh_...` is rendered.
- `shows masked-configured state when a credential is already set` — mount with `credential={{ envVarKey: 'LINEAR_WEBHOOK_SECRET', name: 'Linear Webhook Secret', isConfigured: true, maskedValue: '...abcd' }}`, assert the "Configured" badge and masked value appear.
- `saves the secret via the existing credential mutation when submitted` — mock `trpcClient.projects.credentials.set.mutate`, submit a value, assert the mutation is called with `{ projectId, envVarKey: 'LINEAR_WEBHOOK_SECRET', value, name: 'Linear Webhook Secret' }` and no other credential-save path is invoked.
- `does not render the old "store as LINEAR_WEBHOOK_SECRET in project credentials" bullet` — assert the string "in project credentials" is absent from the panel.

**Implementation** (`web/src/components/projects/pm-wizard-common-steps.tsx`):

- Change `LinearWebhookInfoPanel`'s signature:
  ```ts
  export function LinearWebhookInfoPanel({
    webhookUrl,
    projectId,
    webhookSecretCredential,
  }: {
    webhookUrl: string;
    projectId: string;
    webhookSecretCredential: ProjectCredentialMeta | null;
  }) { ... }
  ```
- Import `ProjectSecretField` + `ProjectCredentialMeta` from `./project-secret-field.js`.
- Insert a `<ProjectSecretField>` block immediately after the webhook URL block and before the setup instructions list:
  ```tsx
  <ProjectSecretField
    projectId={projectId}
    envVarKey="LINEAR_WEBHOOK_SECRET"
    label="Webhook Signing Secret (optional)"
    description="Paste the signing secret from your Linear webhook. CASCADE will verify HMAC-SHA256 on every incoming Linear webhook request."
    placeholder="lin_wh_..."
    credential={webhookSecretCredential}
  />
  ```
- Update `WebhookStep` (same file, same module) to pass the new props through:
  ```tsx
  if (state.provider === 'linear') {
    return (
      <LinearWebhookInfoPanel
        webhookUrl={linearWebhookUrl ?? `${callbackBaseUrl}/linear/webhook`}
        projectId={state.projectId}
        webhookSecretCredential={linearWebhookSecretCredential}
      />
    );
  }
  ```
- Add `projectId: string` and `linearWebhookSecretCredential: ProjectCredentialMeta | null` to the `WebhookStep` props type at the top of the step-renderer block (existing interface).
- Update the callers of `WebhookStep` in `web/src/components/projects/pm-wizard.tsx` to thread `projectId` and resolve `linearWebhookSecretCredential` from the existing `credentials.list` query result (filter where `envVarKey === 'LINEAR_WEBHOOK_SECRET'`).

### 3. Wizard-level wiring

**Tests first** (`web/tests/components/projects/pm-wizard.test.tsx` — augment existing or add a focused test file if absent):

- `when provider is linear and step is webhooks, LinearWebhookInfoPanel receives the project's LINEAR_WEBHOOK_SECRET credential` — mount `PMWizard` with mocked tRPC and a `credentials.list` response containing a `LINEAR_WEBHOOK_SECRET` row; advance to the Webhooks step; assert the masked state appears.
- `when the user types a new value into the secret field and moves on, credentials.set is called with LINEAR_WEBHOOK_SECRET` — mock the mutation, fire a change event, assert the call.
- `Trello Webhooks step does not render ProjectSecretField` — switch provider to `trello` and confirm no `LINEAR_WEBHOOK_SECRET` input is present.
- `JIRA Webhooks step does not render ProjectSecretField` — same for JIRA.

**Implementation** (`web/src/components/projects/pm-wizard.tsx`):

- Identify the `credentials.list` query (already fetched in `pm-wizard-hooks.ts` or directly in the wizard). Compute `const linearWebhookSecretCredential = credentials.find(c => c.envVarKey === 'LINEAR_WEBHOOK_SECRET') ?? null;` inside the component.
- Pass `linearWebhookSecretCredential` and `projectId` (already available via wizard state) to `<WebhookStep>` at the render-call site (~lines 373-388 of `pm-wizard.tsx`).

### 4. Cross-check no regression for Trello and JIRA

**Tests first** (same test file or `web/tests/components/projects/pm-wizard-webhooks-trello.test.tsx`):

- `Trello Webhooks step UI matches pre-change snapshot` — given provider `trello` and no active webhooks, assert the "No Trello webhooks configured" message, the "Create Webhook" button, and the curl-command `<details>` block are all present unchanged. No secret field.
- `JIRA Webhooks step UI matches pre-change snapshot` — same structure for JIRA.

**Implementation:** No code change unless tests fail. If they fail, investigate the prop drilling in task 3 to ensure Linear-only props aren't leaking into other provider branches.

### 5. Documentation

**Implementation** (`src/integrations/README.md`):

- Find the Linear-related section (if present). If the setup instructions are duplicated there, rewrite them to match the new three-event list and the inline-secret flow.
- If the README only references Linear generically (no copy duplication), add a short note that the setup instructions live in the dashboard wizard and point to the component path.

**Implementation** (`CHANGELOG.md`):

- Add an entry: `feat(dashboard): Linear wizard — accurate events list and inline webhook signing secret (#XXXX)`.

---

## Test Plan

### Unit tests
- [ ] `web/tests/components/projects/LinearWebhookInfoPanel.test.tsx` (or colocated `.test.tsx`): 8 tests covering events-list copy, secret-field presence, masked state, save mutation, absence of deprecated bullet, preservation of manual-setup block, and four absence assertions.
- [ ] `web/tests/components/projects/pm-wizard.test.tsx` additions: 4 tests covering credential threading and Trello/JIRA non-regression.

### Integration tests
- [ ] None added in this plan — plan 1 already covers the backend save path with integration tests. The wizard-to-save integration happens via the manual end-to-end step below.

### Acceptance tests
- [ ] Manual on `dev`: complete the full Linear wizard on a fresh project including pasting a dummy signing secret into the new inline field; confirm the credential appears in the Credentials tab as `LINEAR_WEBHOOK_SECRET` and the integration row is persisted.
- [ ] Manual on `dev`: open the wizard on an existing project that already has `LINEAR_WEBHOOK_SECRET`; confirm the inline field shows the masked-configured state on load.
- [ ] Manual on `dev`: walk the Trello and JIRA wizards end-to-end; confirm visual and behavioral equivalence with the pre-change state.

---

## Acceptance Criteria (per-plan, testable)

1. The Linear Webhooks step renders a three-item events list (`Issues`, `Comments`, `Issue Labels`) with one-line rationales matching registered trigger handlers.
2. The Linear Webhooks step does not mention any event family CASCADE does not currently consume (specifically: Documents, Emoji reactions, Customer requests, Cycles, Users, Initiatives, Project updates, Projects, Issue SLA, Issue attachments).
3. The Linear Webhooks step renders a `ProjectSecretField` bound to `LINEAR_WEBHOOK_SECRET`, directly beneath the webhook URL.
4. Pasting a value into the inline secret input calls `projects.credentials.set` with exactly `{ projectId, envVarKey: 'LINEAR_WEBHOOK_SECRET', value, name }` and no other credential-save path.
5. When a `LINEAR_WEBHOOK_SECRET` credential already exists for the project, the inline field renders the masked-configured state on initial mount — no extra fetch required beyond the already-available `credentials.list` data.
6. Setting the credential via the Credentials tab and re-opening the wizard shows the masked-configured state on the inline field; setting it via the inline field and then opening the Credentials tab shows the same masked row — both surfaces read the same underlying credential row.
7. The Trello and JIRA Webhooks steps render byte-identically to the pre-change state (no new secret field, no changed copy, no changed curl block).
8. The Sentry alerting tab is unchanged (no imports or props altered in `integration-alerting-tab.tsx`).
9. All new/modified code has corresponding tests.
10. `npm run build` passes (root and `web/` if separate).
11. `npm test` passes.
12. `npm run lint` passes.
13. `npm run typecheck` passes.
14. The `src/integrations/README.md` Linear section reflects the three-event list, or explicitly defers to the dashboard wizard as the source of truth.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `src/integrations/README.md` | Update the Linear setup reference to list the three consumed event families and to note that the signing secret is entered inline in the dashboard wizard. If the file doesn't currently duplicate the setup copy, add a one-line pointer to the wizard component. |
| `CHANGELOG.md` | Entry: "feat(dashboard): Linear wizard — accurate events list and inline webhook signing secret". |

Not touched in this plan (already owned by plan 1):
- `CLAUDE.md` — plan 1 adds the error-logging bullet.

---

## Out of Scope (this plan)

- Backend save-path changes and error-logging hardening — plan 1 owns these.
- Adding new Linear trigger handlers (Reaction, Document, Issue.create, Issue.remove, IssueLabel.remove) — spec non-goal.
- Automating Linear webhook creation — spec non-goal.
- Changes to Trello or JIRA wizard steps (beyond confirming they remain unchanged) — spec non-goal.
- Changes to the Sentry alerting tab — spec non-goal.
- Making the webhook secret mandatory — spec strategic decision #3.
- Any modification to `ProjectSecretField` itself — the existing component must be used as-is.
- A "send test event" button or similar post-setup validation UI — spec non-goal / out of scope.

---

## Progress

<!-- /implement updates these as it works. Do not edit manually. -->
- [ ] AC #1 — three-item events list
- [ ] AC #2 — no unused event families mentioned
- [ ] AC #3 — ProjectSecretField renders for Linear
- [ ] AC #4 — save mutation called with correct args
- [ ] AC #5 — masked state on initial mount
- [ ] AC #6 — inline and Credentials-tab surfaces stay in sync
- [ ] AC #7 — Trello/JIRA unchanged
- [ ] AC #8 — Sentry alerting tab unchanged
- [ ] AC #9 — tests for all new code
- [ ] AC #10 — build passes
- [ ] AC #11 — tests pass
- [ ] AC #12 — lint passes
- [ ] AC #13 — typecheck passes
- [ ] AC #14 — integrations/README.md reflects the change
