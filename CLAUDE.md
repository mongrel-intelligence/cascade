# CASCADE — PM-to-Code Automation Platform

Webhooks from PM tools (Trello, JIRA, Linear), GitHub and Sentry drive AI coding agents: `webhook → Router → Redis/BullMQ → Worker container → TriggerRegistry → agent (claude-code | codex | opencode) → code → PR`. Three separate services, no monolithic mode:

| Service | Entry point | Role |
|---|---|---|
| Router | `src/router/index.ts` (:3000) | Receives webhooks, enqueues jobs, spawns one worker container per job |
| Worker | `src/worker-entry.ts` | Processes one job, runs the agent, exits |
| Dashboard | `src/dashboard.ts` (:3001) | tRPC API + web UI (`web/`); the `cascade` CLI talks to it |

Integrations live in `src/integrations/` — PM providers use the manifest registry; GitHub (SCM) and Sentry (alerting) use the legacy `IntegrationModule` pattern. System design: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Commands

```bash
npm install && (cd web && npm install)
npm run build                          # required before running dist/dashboard.js
npm run dev                            # Router :3000 (needs Redis — `.cascade/setup.sh` installs and starts it)
node --env-file=.env dist/dashboard.js # Dashboard API :3001
npm run dev:web                        # Vite frontend :5173 (proxies /trpc + /api to :3001)
npm run dev:all                        # all three, colour-coded (after a build)

npm test                               # unit tests — the 4 unit-* vitest projects
npm run test:fast                      # unit tests for files changed vs origin/dev (what pre-push runs)
npm run test:integration               # needs Postgres: `npm run test:db:up` once (Docker); ~4 min
npm run test:all                       # unit + integration
npm run verify                         # lint + typecheck + unit — run before opening a PR
npm run lint / lint:fix / typecheck    # Biome, tsc
npm run db:migrate
```

## Gotchas

- `npm start` runs the **router** (`dist/router/index.js`), not the dashboard.
- Never `npm test -- --project integration` — it *adds* the integration project to the hardcoded unit flags and runs all five. Use `npm run test:integration`.
- One integration file: `TEST_DATABASE_URL=… npx vitest run --project integration tests/integration/<file>.test.ts`. If no test database is reachable, integration tests **silently skip**.
- Git hooks (`lefthook.yml`): pre-commit = Biome `--write` on staged `ts/tsx/js/jsx` + `tsc --noEmit` + the auth-header-provenance test; commit-msg = commitlint (Conventional Commits); pre-push = `npm run test:fast` (changed files only — run `npm test` yourself before a PR).
- Tests failing with connection errors → run `.cascade/ensure-services.sh` to bring Postgres/Redis back.

## Hard invariants

- Project config lives **only** in Postgres (`projects`, `project_integrations`, `agent_configs`, `agent_trigger_configs`); project secrets live in `project_credentials`. `config/projects.json` is seed data for `npm run db:seed`, never read at runtime. Never add an env-var fallback for a project-scoped secret.
- Every project has **two** GitHub personas — `GITHUB_TOKEN_IMPLEMENTER` (writes code, opens PRs) and `GITHUB_TOKEN_REVIEWER` (reviews). Both required. Every SCM trigger handler filters self-events with `isCascadeBot(login)`; the loop-prevention rules are in [10-resilience](./docs/architecture/10-resilience.md).
- Trigger events are `{category}:{event}` (`pm:status-changed`, `scm:check-suite-success`, `alerting:issue-alert`); per-project enablement lives in `agent_trigger_configs` (`cascade projects trigger-list` / `trigger-set`).
- Schema changes are hand-written SQL in `src/db/migrations/NNNN_description.sql` plus a `meta/_journal.json` entry (unique `when`, `tag` = filename without `.sql`), applied with `npm run db:migrate`. Never edit an applied migration; never `drizzle-kit push` against a shared database.
- Every runtime surface registers integrations through `src/integrations/entrypoint.ts` once (guard: `tests/unit/integrations/entrypoint-usage.test.ts`). A new PM provider is one manifest + one import in each barrel — follow [`src/integrations/README.md`](./src/integrations/README.md), don't improvise.
- Root and `web/` must share one Zod major (`web/tsconfig.json` compiles `../src/api` and `../src/db`; diverging majors make `z.infer<>` disagree silently). Bump both together (guard: `tests/unit/repo-hygiene.test.ts`).

## Environment

Required: `DATABASE_URL`, `REDIS_URL`. Every other variable — `DATABASE_SSL` modes, `CREDENTIAL_MASTER_KEY`, `SENTRY_*`, `PM_COALESCE_WINDOW_MS` — is catalogued with its semantics in `.env.example`; add new ones there, not here.

## Before you touch an area, read

Nothing loads these automatically — open the area doc before editing in that part of the tree.

| Working in | Read first | Then |
|---|---|---|
| `src/integrations/**`, `src/pm/**`, `src/{jira,linear,trello}/**`, `web/**/pm-providers/**`, `web/**/pm-wizard*` | [`docs/areas/pm-integrations.md`](./docs/areas/pm-integrations.md) | [`src/integrations/README.md`](./src/integrations/README.md) |
| `src/router/**`, `src/triggers/**`, `src/webhook/**`, `src/queue/**` | [`docs/areas/router-dispatch.md`](./docs/areas/router-dispatch.md) | [10-resilience](./docs/architecture/10-resilience.md), [`src/triggers/README.md`](./src/triggers/README.md) |
| `src/agents/**`, prompts, review context | [`docs/areas/agents.md`](./docs/areas/agents.md) | [04-agent-system](./docs/architecture/04-agent-system.md), [03-trigger-system](./docs/architecture/03-trigger-system.md) |
| `src/backends/**` | [`docs/areas/backends.md`](./docs/areas/backends.md) | [`docs/adding-engines.md`](./docs/adding-engines.md) |
| `src/gadgets/**`, `src/cli/**` (`cascade-tools`) | [`src/gadgets/README.md`](./src/gadgets/README.md) | [07-gadgets](./docs/architecture/07-gadgets.md) |
| `tests/**` | [`tests/README.md`](./tests/README.md) | |
| `src/db/**` | [09-database](./docs/architecture/09-database.md) | |
| A target repo's `.cascade/` hooks | [`docs/cascade-directory.md`](./docs/cascade-directory.md) | |
| Setup, credentials, operations | [`docs/getting-started.md`](./docs/getting-started.md) | |

## Keeping this file small

This file is loaded into every Claude Code session and injected into CASCADE runs whose context pipeline includes `contextFiles`. CI (`tests/unit/architecture-docs.test.ts`) fails it past 200 lines or half the worker inline budget, and rejects `@` imports — `readContextFiles` uses its raw contents.

- Universal command, gotcha or invariant → here.
- Path-scoped gotcha → `docs/areas/<area>.md` (≤ 60 lines; link the reference doc, don't restate it).
- How something works → `docs/architecture/`; provider/gadget/test contracts → the in-tree READMEs; operator how-to → `docs/getting-started.md`; env vars → `.env.example`.
- History goes to `CHANGELOG.md`. Never add ticket IDs, spec numbers, dates or incident narrative here or in area docs (CI-checked).
