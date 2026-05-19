# CASCADE — PM-to-Code Automation Platform

## Quick start

```bash
npm install
cd web && npm install && cd ..
# Redis required (router/BullMQ). `.cascade/setup.sh` installs + starts it.
npm run dev          # Router (webhook receiver, :3000)
npm run dev:web      # Dashboard frontend (:5173, separate terminal)
node dist/dashboard.js   # Dashboard API (:3001, third terminal, after `npm run build`)
```

> `npm start` runs the **router** (`dist/router/index.js`), **not** the dashboard.

## Architecture

Three separate services, **no monolithic server mode**:

1. **Router** (`src/router/index.ts`) — receives webhooks, enqueues to Redis/BullMQ.
2. **Worker** (`src/worker-entry.ts`) — processes one job per container, exits.
3. **Dashboard** (`src/dashboard.ts`) — tRPC API + static frontend for web UI and CLI.

Flow: `PM/SCM/alerting webhook → Router → Redis → Worker → TriggerRegistry → Agent → Code → PR`.

**Capacity-gate invariant.** Every PM router adapter (`src/router/adapters/{linear,trello,jira}.ts`) must wrap `triggerRegistry.dispatch(ctx)` in PM-provider `AsyncLocalStorage` scope via the shared `withPMScopeForDispatch(fullProject, dispatch)` helper at `src/router/adapters/_shared.ts` — in addition to the per-PM-type credential scope (`withLinearCredentials` / `withTrelloCredentials` / `withJiraCredentials`). Without the PM-provider wrapping, the pipeline-capacity gate at `src/triggers/shared/pipeline-capacity-gate.ts` cannot resolve `getPMProvider()`, **fails closed** under the spec-017 fail-closed policy (blocks the run + ERROR + Sentry capture under tag `pipeline_capacity_gate_no_pm_provider`), and `maxInFlightItems` is silently disabled for the PM-source path. Mirror the GitHub adapter's existing correct shape at `src/router/adapters/github.ts:dispatchWithCredentials`. The static guard at `tests/unit/integrations/pm-router-adapter-pm-scope.test.ts` enforces this at CI time — adding a new PM router adapter without the wrapping fails CI with a precise file path.

Integration abstraction lives in `src/integrations/`. For **adding a new PM provider**, see @src/integrations/README.md — PM providers (Trello, JIRA, Linear) use the `PMProviderManifest` registry with a **behavioral conformance harness** (spec 009 — config round-trip, discovery shape, full lifecycle scenario, auth-header provenance, single-entrypoint invariant). Each provider owns its Zod config schema (`src/integrations/pm/<provider>/config-schema.ts`) as the single source of truth — the central `src/config/schema.ts` imports it. PM adapter method signatures use branded `StateId` / `LabelId` / `ContainerId` from `src/pm/ids.ts` to make state-name-vs-ID confusion a compile error at direct-adapter call sites. All runtime surfaces (router, worker, CLI, dashboard) register integrations through a single entrypoint at `src/integrations/entrypoint.ts`. **Spec 010 follow-ups** added generic `pm.discovery.createLabel` / `createCustomField` mutation endpoints + `currentUser` discovery capability + real shared React components for every `StandardStepKind` under `web/src/components/projects/pm-providers/steps/`. **Spec 011** migrated all three production providers (Trello, JIRA, Linear) onto those shared components, added a 7th `StandardStepKind: custom-field-mapping`, widened `container-pick` / `project-scope` / `webhook-url-display` with optional props, and deleted the three legacy `pm-wizard-{trello,jira,linear}-steps.tsx` files. **Spec 012** migrated each provider's webhook UX (programmatic create for Trello/JIRA, signing-secret + instructions for Linear) into per-provider manifest webhook adapters (Fragment compositions around the shared `WebhookUrlDisplayStep`); deleted the legacy `WebhookStep` + `LinearWebhookInfoPanel` + `useWebhookManagement` + `useLinearWebhookInfo`. Every PM wizard step now renders via the manifest path without exception. A new PM provider writes one import in the backend barrel (`src/integrations/pm/index.ts`) and one import in the frontend barrel (`web/src/components/projects/pm-providers/index.ts`); `pm-wizard.tsx`, `pm-wizard-common-steps.tsx`, and `pm-wizard-hooks.ts` receive zero edits. The verification-button readiness path (`areCredentialsReadyFromMetadata` in `pm-wizard-hooks.ts`) and the mutation auth path (`buildProviderAuthArgFromMetadata`) are metadata-driven and require no changes for a new provider. **The shared dashboard state (`pm-wizard-state.ts`) does still require edits**: new providers must add their credential fields to `WizardState` (e.g. `asanaApiKey: string`) and the corresponding action types to `WizardAction`; config-shape hydration belongs on the provider's `ProviderWizardDefinition.buildEditState` — see step 4 of @src/integrations/README.md. Provider-specific hooks, auth metadata, verification display formatting, and UI live inside the provider folder (`kind: 'custom'` steps or Fragment compositions around shared steps). SCM (GitHub) and alerting (Sentry) still use the legacy `IntegrationModule` pattern via self-registration in `src/github/register.ts` + `src/sentry/register.ts`. Don't improvise; the README covers both patterns.

## PR checkout (worker) — gotcha

Worker checks out PRs via `refs/pull/N/head` (works for same-repo **and** external-fork branches). When `prNumber` is set on `AgentInput`, `setupRepository`:

1. Fetches `+refs/pull/<N>/head:refs/remotes/pr/<N>` from `origin`.
2. Detached-checks out `pr/<N>`.
3. If `headSha` is also set, verifies `git rev-parse HEAD` matches.

Any non-zero git exit code **throws** — no warn-and-continue. The legacy `prBranch` field is retained for log readability but **not** used to drive checkout (fork branches don't exist on `origin` and the by-name path silently 404s).

## Testing

```bash
npm test                 # Unit tests (all 4 unit projects)
npm run test:integration # Integration tests (requires Postgres — see below)
npm run test:all         # Unit + integration
```

**⚠️ Do not use `npm test -- --project integration`** — it _adds_ the integration project on top of the hardcoded unit flags, running all 5 projects. Use `npm run test:integration`.

**⚠️ Full integration suite takes ~4 min.** When iterating on one file, target it directly:

```bash
TEST_DATABASE_URL=... npx vitest run --project integration tests/integration/<file>.test.ts
```

Integration test DB is auto-discovered in order: `TEST_DATABASE_URL` env → `TEST_DATABASE_URL` in `.cascade/env` → Docker Compose at `127.0.0.1:5433` → `cascade-postgres-test` container IP. If none reachable, integration tests **silently skip**. DB is auto-created if missing.

Developer machines: `npm run test:db:up` once, then `npm run test:integration`.

Full test helper/factory/mock catalog: @tests/README.md.

## Lint + typecheck

```bash
npm run lint         # Check
npm run lint:fix     # Fix
npm run typecheck
```

## Zod version policy

**Root and `web/` must use the same Zod major version.** Currently both on `zod@^3.25.0`. `web/tsconfig.json` includes `../src/api/**/*` and `../src/db/**/*` — if majors diverge, `z.infer<>` silently computes different types in backend vs frontend compilation. Bump both workspaces together.

## Database

Projects config lives in **PostgreSQL**, not in `config/projects.json`. The JSON file is only used by `npm run db:seed` for initial seeding; it is **not** read at runtime.

Migrations are **hand-written SQL** in `src/db/migrations/` tracked by drizzle-kit's journal. To add one:

1. Create `src/db/migrations/NNNN_description.sql`.
2. Add a matching entry to `src/db/migrations/meta/_journal.json` (unique `when` ms, `tag` matches filename without `.sql`).
3. Run `npm run db:migrate`.

For an existing DB set up via `drizzle-kit push` (no journal), run `npm run db:bootstrap-journal` once.

## GitHub dual-persona model

Every project needs **two** bot tokens (prevents feedback loops):

- `GITHUB_TOKEN_IMPLEMENTER` — writes code, opens PRs, responds to reviews.
- `GITHUB_TOKEN_REVIEWER` — reviews PRs (used only by the `review` agent).

Both are **required**. Set via dashboard Credentials tab or:

```bash
cascade projects credentials-set <id> --key GITHUB_TOKEN_IMPLEMENTER --value ghp_...
cascade projects credentials-set <id> --key GITHUB_TOKEN_REVIEWER --value ghp_...
```

**Loop-prevention rules (behavioral invariants):**

- `respond-to-review` fires **only** when the **reviewer** persona submits `changes_requested`.
- `respond-to-pr-comment` skips @mentions from **any** known persona.
- `check-suite-success` checks reviews from the **reviewer** persona specifically.
- All trigger handlers use `isCascadeBot(login)` to filter self-events.

## Agent triggers

Trigger format is category-prefixed: `{category}:{event}`
(e.g. `pm:status-changed`, `scm:check-suite-success`, `alerting:issue-alert`).

Configs live in the `agent_trigger_configs` table. Manage via:

```bash
cascade projects trigger-discover --agent <type>
cascade projects trigger-list <project-id>
cascade projects trigger-set <project-id> --agent <type> --event <event> --enable [--params JSON]
```

Some triggers take params (e.g. `review` + `scm:check-suite-success` accepts `{"authorMode":"own"|"external"}`). Legacy configs on `project_integrations.triggers` are auto-migrated on merge to `dev`/`main`.

**Work-item concurrency lock** — the router prevents duplicate agent runs via a per-agent-type lock on `(projectId, workItemId, agentType)`. Only same-type duplicates are blocked; **different agent types can run concurrently** on the same work item (e.g. review starts while implementation's container is still cleaning up). The lock has a 30-minute TTL hard ceiling that auto-clears stale entries after router restart.

**Implementation freshness gate** — MNG-1053. PM router adapters intentionally embed a pre-resolved `TriggerResult` for delayed/coalesced PM jobs, so the work-item lock alone cannot prevent a stale implementation snapshot from running. The shared execution pipeline at `src/triggers/shared/agent-execution.ts` now runs a worker-side freshness gate (`src/triggers/shared/implementation-freshness-gate.ts`) before `persistAgentWorkItemLinks()` / `prepareForAgent()`. The gate only fires for `agentType === 'implementation'` with a resolved `workItemId` — review/respond-to-* and follow-up agents bypass it. It reloads live PM work-item state and terminal checklists (`Implementation Steps`, `Acceptance Criteria`), counts active same-type runs, and verifies linked PRs by resolving the implementer GitHub persona token before calling `githubClient.getPR()` (so manual/retry pipeline callers do not depend on ambient GitHub scope). Open or merged PRs and fully-complete terminal checklists block dispatch with a durable `Implementation not started:` PM comment (updating the existing ack comment when present). Checklist read uncertainty always falls into `needs_human_reconciliation`; PR lookup uncertainty does the same when a DB/run-linked PR candidate exists. Closed-unmerged PRs do NOT permanently block reimplementation.

**Post-completion review dispatch** — when an implementation agent succeeds with a PR, the execution pipeline checks CI status and fires the review agent deterministically (before the container exits). This guarantees review dispatch within seconds of implementation completion, regardless of GitHub webhook timing. Uses the same `claimReviewDispatch` dedup key as the `check-suite-success` trigger, so the two paths cannot double-enqueue.

**Deferred re-check** — a trigger handler can return `TriggerResult.deferredRecheck: { delayMs, coalesceKey, recheckKind? }` (with `agentType: null`) to schedule a bare delayed job via `scheduleCoalescedJob`. The router scheduling is adapter-agnostic, but **bare re-dispatch is currently GitHub-only**: `GitHubRouterAdapter.buildJob()` strips `triggerResult` from the job so the GitHub worker re-dispatches through the trigger registry for fresh provider state. Non-GitHub adapters (Trello, JIRA, Linear, Sentry) embed `triggerResult` in the job; their workers pass it to `resolveTriggerResult()`, which returns the pre-resolved `agentType: null` result without re-dispatching — a non-GitHub handler using this field would schedule a job that reuses the same result rather than re-evaluating provider state. There are two recheck kinds, controlled by the optional `recheckKind` field on `deferredRecheck`: **mergeability re-check** (no `recheckKind`, sets `mergeabilityRecheckAttempt: 1` on the job) — one-shot; if the re-check still cannot resolve state, the worker Sentry-captures under `mergeability_recheck_exhausted` and stops without re-queueing. **Check-suite re-check** (`recheckKind: 'check-suite'`, sets `checkSuiteRecheckAttempt: 1` on the job) — safe rescheduling; if the Actions API is still stale when the job fires, the worker reschedules another coalesced delayed job instead of exhausting, so review/respond-to-ci dispatch stays alive until the API catches up. Used by `check-suite-success` and `check-suite-failure` handlers for the Actions-API-lag case (ucho PR #394/MNG-683, 2026-05-11).

**Worker exit diagnostics** — when a worker container exits non-zero, the router calls `container.inspect()` *before* AutoRemove reaps it and stamps the run record's `error` field with a structured, grep-stable string: `Worker crashed with exit code N · OOMKilled=<true|false> · reason="<State.Error>"`. The `OOMKilled=true` marker is the definitive cgroup-OOM signal (per Docker's own `State.OOMKilled`); a 137 exit *without* `OOMKilled=true` means the kill came from inside the container or from a non-cgroup signal — *not* memory. The `[WorkerManager] Resolved spawn settings` log emitted at every spawn includes both `projectWatchdogTimeoutMs` and `globalWorkerTimeoutMs` so post-mortems can confirm whether the per-project override actually won. See `src/router/active-workers.ts:formatCrashReason` for the format and `tests/unit/router/container-manager-diagnostics.test.ts` for regression pins.

**Friction reporting** — agents with `pm:friction` can call `cascade-tools pm report-friction` / `ReportFriction` for incidental tooling, environment, permission, dependency, test, PM-data, or SCM-data papercuts. Configure the optional Friction slot in the PM wizard's Status Mapping step: Trello uses `lists.friction`; JIRA and Linear use `statuses.friction`. The feature does not add provider adapter methods or a DB-backed friction index — it materializes a normal PM work item through existing `createWorkItem` plus optional `moveWorkItem`. Reports are first written to `CASCADE_FRICTION_SIDECAR_PATH` as a JSONL outbox, then filed immediately when possible; backend drain retries pending reports after the engine returns, including ordinary failures. Missing friction slot returns a non-fatal `friction_slot_missing`/`queued_slot_missing` result, and drain failures log/capture Sentry under `friction_sidecar_drain_failed` without failing an otherwise successful run.

**Dispatch failure semantics** — spec 015 (verified live in prod via the ucho/MNG-350 incident on 2026-04-26):

- **Capacity miss waits, never throws.** When the dispatcher pulls a job and the worker pool is at `maxWorkers`, it `await`s a slot via the in-process slot-waiter (default `slotWaitTimeoutMs` = 5min). The slot is conceptually held by the running container — `slotReleased()` is called once per cleanup from `cleanupWorker`, never from the dispatcher.
- **Transient Docker errors retry.** `ECONNREFUSED` / `ECONNRESET` / `ENOTFOUND` on the Docker socket, registry HTTP 429, container-name 409 collisions, and the `SLOT_WAIT_TIMEOUT` itself all classify as transient and propagate unchanged so BullMQ retries via `attempts: 4` + `backoff: { type: 'exponential', delay: 5000 }` (~75s total before exhaustion). Both `cascade-jobs` and `cascade-dashboard-jobs` use the same retry config.
- **Terminal errors fail fast.** `TypeError` / `ZodError` (validation) and image-not-found *after* fallback exhaustion are wrapped in BullMQ's `UnrecoverableError`, which skips the retry budget entirely.
- **Failed-event compensation releases locks.** Every dispatch failure (transient retry exhaustion, terminal error, slot-wait timeout exhaustion) flows through `worker.on('failed')`, which calls `releaseLocksForFailedJob` to release the work-item lock, agent-type counter, and recently-dispatched dedup mark. Without this, the locks leak for ~30min and silently reject every follow-up webhook for the same trio.
- **Webhook decision reasons are three-way.** When the work-item lock check rejects a webhook, the message distinguishes:
  - `Job queued: ...` (success — not a lock rejection)
  - `Awaiting worker slot: ...` (lock held + dispatch in flight — healthy)
  - `Work item locked (no active dispatch): ...` (wedged-lock canary — the lock-state classifier could correlate the lock count with neither an active worker nor a queued/waiting BullMQ job; this fires a Sentry capture tagged `wedged_lock_canary` so any regression in compensation is loud)

The wedged-lock canary should never fire under normal operation. Its presence in webhook logs or Sentry is itself a regression invariant: a code path acquired a lock without registering its compensation.

## Review agent — context shape (debugging)

Review agent receives a **compact per-file diff context**, not full file contents. Each changed file is a `### <file> (<status>, +N -M)` section with a unified diff hunk. Budget: `REVIEW_DIFF_CONTEXT_TOKEN_LIMIT` = 200k tokens, per-file cap 10%.

GitHub's changed-file API is used for file enumeration and change counts, but compact patch bodies come from the checked-out PR workspace via `git diff origin/<base>...HEAD`. Files that can't fit or can't be locally verified (deleted, binary/no text patch, local diff failure/empty patch, oversized patch, or budget exhausted) are injected as `SKIPPED FILES` with instructions to fetch on demand via `cascade-tools scm get-pr-diff --prNumber <N> --path <path>`, `Read`, or `Grep`. Large or one-line JSON diffs that would truncate stdout should add `--outputFile /tmp/pr-diff.md` — the CLI writes the full multiline Markdown payload to disk and returns a compact `{outputFile, fileCount, bytes, pathFilter}` summary on stdout (MNG-1059 / MNG-1045).

When review output misses something, check the `PR context prepared` log entry for `included` / `skipped` / `skipReasons`, `patchSources`, `totalDiffTokens`, `perFileTokenCap`, and `localGitMismatches` to confirm whether the file was visible to the agent and whether GitHub's API patch differed from the local patch. Also check context offload logs if the diff context was written under `.cascade/context/`.

**cascade-tools shell-safety contract** — MNG-1059. cascade-tools commands that accept markdown/multiline payloads (`--body`, `--text`, `--description`, `--details`, `--comments`) declare a `--*-file <path>` companion via `cli.fileInputAlternatives`. Agents are instructed in the system prompt to prefer the file form when content contains backticks, code fences, `$(...)`, or newlines — shells expand those tokens even inside single quotes once they layer through `bash -c`, and newlines break argv parsing. The shared CLI factory at `src/gadgets/shared/cli/params.ts:rejectMultipleStdinConsumers` enforces the single-stdin-consumer invariant: only one `--*-file -` per command. Passing two stdin consumers (e.g. `--body-file - --comments-file -`) returns a structured `flag-parse` envelope with `error.flag: "body-file,comments-file"` and a hint to write one payload to a temp file — *before* any `readFileSync(0, ...)` call. The native-tool system prompt also renders a "cascade-tools shell-safety rules" section with safe heredoc / temp-file patterns. Prompt example rendering suppresses inline `--body '...'` examples for shell-sensitive content (backticks / `$(...)` / newlines) when a file-input companion exists, redirecting agents at the safer `--*-file <path>` form.

## Engines

Default engine: `claude-code`. Alternatives: `codex`, `opencode`.

```bash
cascade projects update <id> --agent-engine claude-code
# per-agent override:
cascade agents create --agent-type implementation --project-id <id> --engine codex
```

Auth:

- **Claude Code subscription**: `CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...` (from `claude setup-token`). CASCADE writes `~/.claude.json` before run.
- **Codex subscription**: store `CODEX_AUTH_JSON` credential (contents of `~/.codex/auth.json` after `codex login`). CASCADE persists refreshed tokens back to the DB after each run.
- **API-key providers**: store `OPENAI_API_KEY` / other keys as project credentials.

## Environment

Required:

- `DATABASE_URL` — PostgreSQL connection string.
- `REDIS_URL` — BullMQ queue, defaults to `redis://localhost:6379`.

Optional:

- `DATABASE_SSL=false` to disable SSL locally; `DATABASE_CA_CERT` for managed DBs with a private CA.
- `CREDENTIAL_MASTER_KEY` — 64-char hex (AES-256 key) to encrypt project credentials at rest. Without it, credentials are stored as plaintext; both modes coexist.
- `GITHUB_WEBHOOK_SECRET` — opt-in HMAC verification; store as the `webhook_secret` role on the GitHub SCM integration.
- `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `SENTRY_TRACES_SAMPLE_RATE` — observability.
- `PM_COALESCE_WINDOW_MS` — settle window (ms) for BullMQ delayed-job coalescing on `pm:status-changed` events. Any dispatch for the same `${projectId}:${workItemId}` within the window supersedes the prior pending dispatch, across agent types. Ack comment is deferred to job fire time to avoid orphaned comments on supersede. Defaults to `10000` (10 s); `0` disables. Fixes JIRA's double-fire when an issue is created in a non-default workflow column. The legacy name `PM_CREATE_COALESCE_WINDOW_MS` is still accepted as a fallback.

**Project credentials (GitHub tokens, Trello/JIRA/Linear keys, LLM API keys) live in the `project_credentials` table.** The DB is the **sole source of truth** — there is no env var fallback for project-scoped secrets.

## Git hooks

Lefthook runs pre-commit (lint, typecheck) and pre-push (unit + integration tests) hooks automatically. Pre-push auto-starts an ephemeral Postgres via `npm run test:db:up` — Docker must be running.
