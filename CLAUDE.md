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

Integration abstraction lives in `src/integrations/`. For **adding a new PM provider**, see @src/integrations/README.md — PM providers (Trello, JIRA, Linear) use the `PMProviderManifest` registry with conformance-harness coverage. SCM (GitHub) and alerting (Sentry) still use the legacy `IntegrationModule` pattern via self-registration in `src/github/register.ts` + `src/sentry/register.ts`. Don't improvise; the README covers both patterns.

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
(e.g. `pm:status-changed`, `scm:check-suite-success`, `alerting:issue-created`).

Configs live in the `agent_trigger_configs` table. Manage via:

```bash
cascade projects trigger-discover --agent <type>
cascade projects trigger-list <project-id>
cascade projects trigger-set <project-id> --agent <type> --event <event> --enable [--params JSON]
```

Some triggers take params (e.g. `review` + `scm:check-suite-success` accepts `{"authorMode":"own"|"external"}`). Legacy configs on `project_integrations.triggers` are auto-migrated on merge to `dev`/`main`.

**Work-item concurrency lock** — the router prevents duplicate agent runs via a per-agent-type lock on `(projectId, workItemId, agentType)`. Only same-type duplicates are blocked; **different agent types can run concurrently** on the same work item (e.g. review starts while implementation's container is still cleaning up). The lock has a 30-minute TTL hard ceiling that auto-clears stale entries after router restart.

## Review agent — context shape (debugging)

Review agent receives a **compact per-file diff context**, not full file contents. Each changed file is a `### <file> (<status>, +N -M)` section with a unified diff hunk. Budget: `REVIEW_DIFF_CONTEXT_TOKEN_LIMIT` = 200k tokens, per-file cap 10%.

Files that can't fit (deleted, binary, oversized patch, or budget exhausted) are injected as `SKIPPED FILES` with instructions to fetch on demand via `gh pr diff`, `Read`, or `Grep`.

When review output misses something, check the `PR context prepared` log entry for `included` / `skipped` / `skipReasons` to confirm whether the file was visible to the agent.

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

**Project credentials (GitHub tokens, Trello/JIRA/Linear keys, LLM API keys) live in the `project_credentials` table.** The DB is the **sole source of truth** — there is no env var fallback for project-scoped secrets.

## Git hooks

Lefthook runs pre-commit (lint, typecheck) and pre-push (unit + integration tests) hooks automatically. Pre-push auto-starts an ephemeral Postgres via `npm run test:db:up` — Docker must be running.
