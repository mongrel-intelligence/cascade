---
id: 002
slug: linear-webhook-setup-ux
level: spec
title: Linear Webhook Setup UX — Complete Events, Inline Secret, Unblock Save
created: 2026-04-15
status: draft
---

# 002: Linear Webhook Setup UX — Complete Events, Inline Secret, Unblock Save

## Problem & Motivation

CASCADE shipped Linear as a PM provider in the dashboard wizard (#1107, #1108, #1112). The end-to-end setup flow is now working in principle, but three real problems are surfacing the first time an operator actually walks through it on a live project (dev environment, project `llmist`):

1. **The "Enable events" instruction is incomplete.** The Webhooks step currently tells the user to enable only `Issues (created, updated, removed)`. CASCADE's Linear trigger handlers actually consume three event families: `Issue.update` (status transitions), `Comment.create` (bot @mentions), and `IssueLabel.create` (the "Ready to Process" label). If the operator follows the instructions literally, the comment-mention and ready-to-process-label triggers never fire, and there is no feedback loop — the integration appears configured, events arrive from Linear, and nothing happens.

2. **The webhook signing secret has no dashboard home.** The setup panel says *"Optionally set a webhook secret and store it as `LINEAR_WEBHOOK_SECRET` in project credentials"* — meaning the user must leave the wizard, navigate to the Credentials tab, and paste the secret into a generic env-var form. Meanwhile the user is already staring at Linear's "Signing secret" field in a different browser tab. The obvious flow — copy secret → paste adjacent to the instructions → done — is not supported. (Compare: the Sentry alerting tab already uses `ProjectSecretField` to inline the webhook secret next to the webhook URL. This is the established pattern.)

3. **The final "Update Integration" save returns HTTP 500.** On `dev`, finishing the Linear wizard for project `llmist` fails the `POST /trpc/projects.integrations.upsert` call with a Drizzle "Failed query" error against `project_integrations`. The underlying cause is not visible in dashboard logs (only the 500 status is logged, not the error text). The net effect: the operator cannot complete Linear setup at all on dev today. This is a regression from the wizard work in #1107 and must be fixed as part of the same UX polish pass — shipping the cosmetic fixes while the primary flow is broken would be pointless.

Together, these three defects mean the first-time Linear setup experience is demonstrably broken, even though every individual piece (wizard steps, trigger handlers, credential storage, signature verification) is present and wired.

---

## Goals

1. An operator following the on-screen setup instructions configures a Linear webhook that actually delivers every event CASCADE can act on — no silent under-subscription.
2. An operator who wants to protect the webhook endpoint with a signing secret can do so without leaving the wizard — one place to look, one place to paste.
3. The Linear wizard's final Save step completes successfully end-to-end on the dev environment, and any future failure at that step produces a server-side error message the operator (or an engineer reading logs) can act on.
4. The wizard's guidance is trustworthy: every event the instructions tell the user to enable in Linear is one CASCADE actually consumes, and no event CASCADE consumes is missing from the instructions.

---

## Non-goals

- Adding new Linear trigger handlers (e.g., `Reaction`, `Document`, `Issue.create`, `IssueLabel.remove`). These are separate product decisions, not in scope here.
- Automating webhook creation via Linear's API. Linear webhooks remain manually created by the user; the panel's "Manual Webhook Setup Required" notice stays.
- Changing the credential storage model (encrypted `project_credentials` table, env-var-key semantics). The inline input is a new surface on top of the existing store.
- Making the webhook secret mandatory. It stays optional, matching current signature-verification behavior (skip if absent).
- Redesigning the broader PM wizard, step ordering, or other providers' setup flows. Changes to Trello/JIRA setup are out of scope.
- Changing how `project_integrations.triggers` is structured, defaulted, or interpreted. The save-error fix targets the actual error, not a schema redesign.
- Post-setup validation that Linear is actually sending webhooks to CASCADE (e.g., a "send test event" button).

---

## Constraints

- **TDD-first.** Every behavior change (new input field, new instruction text, save-error fix) must be preceded by a failing test that demonstrates the bug or requirement.
- **No hacks, no half-measures.** The save-error fix must address the true root cause observable in server logs, not silence a symptom. If the upsert is genuinely failing on an invalid value, fix the invalid value; if it's a schema drift, reconcile the schema.
- **Observability for the save path.** After this spec lands, any future failure at `projects.integrations.upsert` must produce a server-side log line containing the actual error message — not just an HTTP 500.
- **Follow existing conventions.** Use the existing `ProjectSecretField` component for the inline secret input (same pattern as the Sentry alerting tab). Use the existing `setCredential` tRPC path to persist it. Use the existing `LINEAR_WEBHOOK_SECRET` env-var key.
- **No regression to JIRA or Trello setup.** The Linear-specific changes must not alter other providers' wizard steps or behavior.
- **No regression to the Credentials tab.** Users who already stored `LINEAR_WEBHOOK_SECRET` via the Credentials tab must see their value reflected in the new inline field, and editing it in either place must be equivalent.
- **No credential leakage in logs.** The signing secret must never appear in plaintext in server logs, tRPC traces, or error responses.

---

## User stories / Requirements

### As an operator setting up Linear for the first time

1. **Correct events list.** When I reach the Webhooks step, the instructions list exactly the events CASCADE consumes — `Issues`, `Comments`, and `Issue Labels` — and explain in one line each why they're needed (status transitions, @mention responses, "Ready to Process" labeling). I do not see events CASCADE ignores.
2. **Inline secret input.** On the same Webhooks step, immediately under the webhook URL, I see an input labelled "Webhook Signing Secret (optional)" with the same copy-paste affordance as other credential fields. When I paste my Linear signing secret and move on, it is persisted as the `LINEAR_WEBHOOK_SECRET` project credential without any further action on my part.
3. **Saved state is reflected.** If a `LINEAR_WEBHOOK_SECRET` credential already exists for the project, the field shows a masked indicator (same affordance `ProjectSecretField` uses elsewhere). I can update or clear it from here.
4. **Save completes.** When I reach the final Save step and confirm, the "Update Integration" action succeeds on the first try, the wizard closes, and the Linear integration appears as configured on the project page.

### As an engineer responding to a save failure

5. **Actionable server log.** If the upsert fails, the dashboard server log contains the error message (constraint name, type mismatch, whatever the DB said) alongside the already-logged SQL + parameters. I can diagnose without attaching a debugger.

### As a reviewer of the change

6. **Instructions match code.** A reviewer can verify correctness by comparing the setup instructions to the registered Linear trigger handlers. The two lists agree.

---

## Research Notes

- Linear webhooks are **manually configured** in the team settings UI; there is no first-class public API for creating them programmatically. The manual-setup framing is correct and must stay. Reference: [Linear — Webhooks](https://developers.linear.app/docs/graphql/webhooks).
- Linear's `Data change events` checkboxes on the "Create webhook" screen are independent subscriptions. The currently recommended set (`Issues`) is a strict subset of what the CASCADE router actually parses — parsed event types include `Issue.create`, `Issue.update`, `Comment.create`, `IssueLabel.create`, and a declared-but-unhandled `Reaction`. Only the handlers that exist drive behavior.
- Linear signs webhooks with HMAC-SHA256 hex-encoded in the `Linear-Signature` header. CASCADE already verifies this via `verifyLinearSignature` → `verifyLinearWebhookSignature`, pulling the secret from the `webhook_secret` credential role. If the credential is absent, verification is skipped. This behavior is intentional and documented in the provider role registration and is **not** changing.
- The dashboard already has precedent for inlining a webhook secret next to a webhook URL: the Sentry alerting tab composes `ProjectSecretField` with an immediate `envVarKey="SENTRY_WEBHOOK_SECRET"`. The same component is reusable for Linear with zero new primitives.
- The `project_integrations` repository already has a preserve-existing-triggers fallback for the case where the wizard omits the `triggers` input — `upsertProjectIntegration` reads the existing row and reuses its triggers if undefined is passed. The save path on dev is failing *after* this fallback, so the defect is elsewhere; the root cause needs to be confirmed by surfacing the actual DB error rather than guessed at.

---

## Open Source Decisions

| Tool | Solves | Decision | Reason |
|------|--------|----------|--------|
| `ProjectSecretField` (internal dashboard component) | Inline credential input with masked existing-value display, save-on-blur semantics | **Use** | Already the standard. Used by Sentry webhook secret; Linear should match. |
| Linear webhook HMAC verification (`verifyLinearSignature`, internal) | Signature check using stored `LINEAR_WEBHOOK_SECRET` | **Use** (no change) | Already implemented and wired; this spec only changes *how the secret gets stored*, not how it's verified. |
| No new external OSS dependencies | — | **Skip** | The work is a composition of existing internal primitives. No tool adoption is warranted. |

---

## Strategic decisions

1. **Events list reflects reality, not ambition.** Recommend exactly the three event families CASCADE consumes today (`Issues`, `Comments`, `Issue Labels`). When new trigger handlers land (e.g., reactions), the instruction list updates with them — not before. Reason: guidance drifts into noise if it promises events that do nothing.
2. **Webhook secret lives in the Webhooks step, not the Credentials step.** The user's mental context when they look at CASCADE's Webhooks step is "I am staring at Linear's webhook creation screen; it just gave me a signing secret; where does it go?" The answer should be inches away, not two tabs over. Reason: minimize the distance between the Linear-side and CASCADE-side of the same action.
3. **Secret remains optional.** No change to the current verification behavior. Reason: mandatory would block users who can't (yet) create a secret on the Linear side, and the verification code already handles absence cleanly.
4. **Save-error fix is in scope.** The bug blocks the very flow this spec improves — polishing a broken path would be theatre. Reason: ship the complete first-time experience, not a subset.
5. **Diagnosability is a first-class outcome.** Rather than just fixing today's specific save failure, ensure the next one is *visible* (server logs the DB error text). Reason: the current 500-without-detail mode has already cost debugging time once; it will again.
6. **Reuse, don't invent.** Compose `ProjectSecretField` + existing credential save mutation + existing env-var key. No new component, no new tRPC route. Reason: the primitives are correct; the composition is the fix.

---

## Acceptance Criteria (outcome-level)

1. **Instructions list matches handlers.** On the Webhooks step of the Linear PM wizard, the enabled-events instruction lists `Issues`, `Comments`, and `Issue Labels`, with a one-line rationale per item, and nothing else. Each bullet corresponds to at least one registered Linear trigger handler.
2. **Inline secret input is present.** The Webhooks step renders an input labelled "Webhook Signing Secret (optional)" placed adjacent to the webhook URL. The input uses the same masked / copy / clear affordance used by other secret fields in the dashboard.
3. **Pasting the secret persists it.** Entering a value into the inline input stores it as the `LINEAR_WEBHOOK_SECRET` credential for the current project, using the existing credential-save path. After a page reload, the field shows the masked existing-value state, not an empty input.
4. **Credentials tab stays in sync.** A value written via the wizard input is readable from the Credentials tab under `LINEAR_WEBHOOK_SECRET`, and vice versa — the two surfaces point at the same underlying row.
5. **Save succeeds end-to-end.** Completing the Linear wizard on a project with no prior PM integration results in a successful `projects.integrations.upsert` call (HTTP 200), a persisted `project_integrations` row, and a visible "configured" state on the project page.
6. **Save succeeds on re-configuration.** Re-running the wizard on a project that already has a Linear PM integration updates the existing row (same upsert) without 500s, preserving any previously configured triggers on the row.
7. **Save failures are diagnosable.** When the upsert does fail for any reason, the dashboard server log contains the underlying error message (not just the HTTP status). This can be verified by provoking a failure — e.g., writing an invalid `config` payload — and reading the server log.
8. **No secret leakage.** The signing secret value does not appear in plaintext in any server log emitted during the save path (wizard save, credential save, upsert). A search of the log for the secret's literal value returns zero hits.
9. **No regression to other providers.** Running through the Trello and JIRA wizards end-to-end (including their Save step) continues to succeed and produces the same result it did before this change.
10. **Other providers' webhook-secret UX unchanged.** The Sentry alerting tab's inline secret field and the JIRA / Trello wizard steps are byte-for-byte unchanged.

---

## Documentation Impact (high-level)

- `src/integrations/README.md` — if the setup-instruction text is referenced or duplicated, update it to match the new events list. If not, no change needed.
- `CLAUDE.md` (root) — no change expected; Linear setup specifics live in `src/integrations/README.md`.
- `CHANGELOG.md` — add an entry noting the Linear wizard improvements (events, inline secret) and the save-path fix.
- `web/` component-level docs, if any exist for the PM wizard — reflect the new step contents.

---

## Out of Scope

- Adding handlers for Linear `Reaction`, `Document`, `Issue.create`, `Issue.remove`, or `IssueLabel.remove` events.
- Automating Linear webhook creation or rotation.
- Migrating existing `LINEAR_WEBHOOK_SECRET` credentials to a different storage model or key name.
- Redesigning the wizard's step ordering, visual layout, or multi-provider flow.
- Adding a "send test event" button or other post-setup verification UI.
- Making the signing secret mandatory for any provider.
- Changes to trigger-discovery or the `agent_trigger_configs` table.
- Changes to JIRA, Trello, or Sentry setup flows.

---

## Verification

- Spin up the dashboard on dev, walk the Linear wizard end-to-end on a fresh project (no prior PM integration), complete the Save step, and confirm the project page shows Linear as configured.
- Repeat on a project that already has a Linear integration (re-configuration path).
- Paste a secret into the inline field, reload, and confirm the masked state.
- Paste a secret via the Credentials tab, open the wizard, and confirm the inline field shows the masked state.
- Compare the registered Linear trigger handlers against the on-screen events list — they must agree.
- Force an upsert failure (e.g., via a bad config payload in devtools) and confirm the underlying error is present in the dashboard server log.
- Grep the dashboard server log for the literal secret value after a save — must return zero hits.
- Run unit + integration tests: the new failing tests written first for each behavior above must now pass; all previously passing tests must still pass.
