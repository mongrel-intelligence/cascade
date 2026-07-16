# Cascade

[![CI](https://github.com/mongrel-intelligence/cascade/actions/workflows/ci.yml/badge.svg)](https://github.com/mongrel-intelligence/cascade/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/mongrel-intelligence/cascade/graph/badge.svg)](https://codecov.io/gh/mongrel-intelligence/cascade)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org/)

> **Cascade orchestrates AI agents (Claude Code, Codex, opencode, LLMist) across your workflows in GitHub, Trello, Jira, Linear, and GitHub Projects.**

Cascade is an open-source platform that automates the full software development lifecycle. Connect your PM tool and GitHub repository, and Cascade drives work items from plan to merge:

```
PM Card → Split → Plan → Implement → PR → Review → Iterate → Merge
```

[![What is Cascade?](https://img.youtube.com/vi/gcDLVZw6HS8/maxresdefault.jpg)](https://youtu.be/gcDLVZw6HS8)

[![Watch the demo](docs/assets/demo-thumbnail.jpg)](https://youtu.be/HMfFtj2i_Mw)

---

## 🚀 Quick Start

```bash
git clone https://github.com/mongrel-intelligence/cascade.git
cd cascade
cp .env.docker.example .env    # Edit if needed
bash setup.sh                  # Build, migrate, and start all services
docker compose exec dashboard node dist/tools/create-admin-user.mjs \
  --email admin@example.com --password changeme --name "Admin"
```

Open **http://localhost:3001** and log in with your admin credentials. The router listens on **http://localhost:3000** for provider webhooks.

For the full setup walkthrough — projects, credentials, webhooks, and triggers — see **[Getting Started](./docs/getting-started.md)**.

---

## ⚡ Features

- **Multi-PM support** — Works with Trello, JIRA, Linear, and GitHub Projects out of the box
- **12 agent types** — Splitting, planning, implementation, review, debug, respond-to-review, respond-to-CI, alerting, and more
- **Dual-persona GitHub model** — Separate implementer and reviewer bot accounts to prevent feedback loops
- **Web dashboard + CLI** — Monitor runs, manage projects, configure triggers
- **Extensible trigger system** — Add new events without touching core logic
- **Pluggable agent engines** — `claude-code` (default), `llmist`, `codex`, and `opencode` built-in; easy to extend
- **Credential encryption** — AES-256-GCM encryption for all stored secrets
- **Agent resilience** — Built-in rate limiting, exponential-backoff retry, and context compaction

---

## 🏗️ Architecture

> The architecture diagram source lives at [`docs/architecture.d2`](./docs/architecture.d2).
> Render it locally with the [D2 CLI](https://d2lang.com/): `d2 docs/architecture.d2 docs/architecture.svg`.

Cascade runs as three independent services:

| Service | Entry Point | Role |
|---------|-------------|------|
| **Router** | `src/router/index.ts` | Receives webhooks, enqueues jobs to Redis via BullMQ |
| **Worker** | `src/worker-entry.ts` | Processes one job per container, exits when done |
| **Dashboard** | `src/dashboard.ts` | Serves the API (tRPC) and web UI |

### 🤖 Agent Types

| Agent | Trigger | What it does |
|-------|---------|-------------|
| `splitting` | PM status change | Splits a large card into smaller work items |
| `planning` | PM status change | Creates a detailed implementation plan on the card |
| `implementation` | PM status change | Writes code and opens a pull request |
| `review` | CI pass / PR opened / review requested | Reviews a pull request |
| `respond-to-review` | Reviewer requests changes | Addresses review feedback |
| `respond-to-ci` | CI failure | Diagnoses and fixes failing CI checks |
| `respond-to-pr-comment` | PR comment | Responds to comments on a PR |
| `respond-to-planning-comment` | Planning card comment | Updates the plan based on feedback |
| `debug` | Session log uploaded | Analyzes agent session logs and creates a debug card |
| `resolve-conflicts` | Merge conflict detected | Resolves git merge conflicts |
| `backlog-manager` | Scheduled / manual | Manages and prioritizes the backlog |
| `alerting` | Sentry alert webhook | Investigates the alert (parses stacktrace, reads source) and files a bug investigation work item or comments on an existing one. Read-only — never edits source, opens PRs, or pushes commits. |

---

## 🛠️ Development

**Prerequisites:** Node.js 22+, PostgreSQL, Redis

```bash
npm install && cd web && npm install && cd ..
cp .env.example .env    # Set DATABASE_URL and REDIS_URL
npm run db:migrate
```

Start all three services with one command (requires a build first):

```bash
npm run build
npm run dev:all   # Router + Dashboard API + Frontend, color-coded output
```

Or start each service in a separate terminal:

```bash
npm run dev                                        # Router (:3000)
node --env-file=.env dist/dashboard.js             # Dashboard API (:3001)
npm run dev:web                                    # Frontend (Vite, :5173)
```

> **Note:** The Vite dev server proxies `/trpc` and `/api` to `localhost:3001`, so the Dashboard API must be running for the frontend to work.

### Commands

| Command | Description |
|---------|-------------|
| `npm test` | Run unit tests (Vitest) |
| `npm run test:integration` | Run integration tests (requires PostgreSQL) |
| `npm run lint` | Check code style (Biome) |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run typecheck` | TypeScript type checking |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Open Drizzle Studio |
| `npm run dev:all` | Start all services (router + dashboard + frontend) |
| `npm run verify` | Lint + typecheck + unit tests (pre-PR check) |

---

## 🚢 Deployment

The included `docker-compose.yml` runs all services with a single command. Workers are spawned dynamically by the Router via Docker socket.

| Image | Dockerfile | Purpose |
|-------|-----------|---------|
| Dashboard + Frontend | `Dockerfile.selfhosted` | API server + web UI (combined) |
| Router | `Dockerfile.router` | Webhook receiver, worker orchestration |
| Worker | `Dockerfile.worker` | Full agent runtime (clones repos, runs AI). Ships a baseline native-session toolchain (`python`/`python3`, `jq`, `rg`, `fd`, `git`, `tmux`, `cascade-tools`) and a shared Playwright Chromium cache at `$PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`. See [engine-backends](./docs/architecture/05-engine-backends.md#worker-image-runtime-baseline-mng-1055). |

**Required production environment variables:**

```bash
DATABASE_URL=postgresql://user:pass@host:5432/cascade
REDIS_URL=redis://your-redis-host:6379
CREDENTIAL_MASTER_KEY=<64-char hex>   # Generate: openssl rand -hex 32
```

All project-level credentials (GitHub tokens, PM keys, LLM API keys) are stored in the database and managed through the dashboard or CLI.

---

## 🔑 Key Concepts

**Dual-persona GitHub model** — Cascade uses two separate GitHub bot accounts per project (implementer and reviewer) to prevent feedback loops. The implementer writes code and creates PRs; the reviewer reviews and approves them.

**Trigger system** — Events from Trello, JIRA, Linear, GitHub Projects, GitHub, and Sentry webhooks are matched against registered `TriggerHandler` instances. Triggers are configured per-project in the database. Event names are category-prefixed, for example `pm:status-changed`, `scm:check-suite-success`, and `alerting:issue-alert`.

**Agent engines** — Agents run through a shared execution lifecycle with a pluggable engine registry. Default engine is `claude-code` (Anthropic Claude Code SDK). Alternatives: `llmist` (supports OpenRouter, Anthropic, OpenAI), `codex` (OpenAI Codex CLI), `opencode` (OpenCode server).

**Credential management** — All secrets are stored in the `project_credentials` table, scoped to a project. Optional AES-256-GCM encryption via `CREDENTIAL_MASTER_KEY`.

**`.cascade/` directory** — Each target repository can include a `.cascade/` directory with hooks that control how the agent sets up the project, lints after edits, and runs tests. See **[`.cascade/` Directory Guide](./docs/cascade-directory.md)**.

**Observable subprocesses** — `cascade-tools` streams child stdout/stderr live to the parent's stderr so LLM-driven agents can see progress as it happens, emits 30-second heartbeats during silent stretches, and enforces both idle-silence and wall-clock timeouts with SIGTERM→SIGKILL escalation across the full process tree. See [spec 013](./docs/specs/013-subprocess-output-streaming.md.done).

**Per-project worker image** — Each agent job runs in an ephemeral worker container. By default every project uses the global `WORKER_IMAGE`, but a **superadmin** can pin a per-project image so projects with different toolchains get the runtime they need. The image must be a prebuilt, host-pullable reference that derives from the worker base (`FROM cascade-worker:<pinned>`) and satisfies the cascade-compatible-worker-image contract — `cascade-tools`, `node`, `git`, and an engine CLI (`claude`/`codex`/`opencode`) on `PATH`, plus the python shim and Playwright.

```bash
# Superadmin only. Records the reference as `pending` and enqueues validation.
cascade projects update <id> --worker-image ghcr.io/acme/cascade-worker:latest
cascade projects update <id> --clear-worker-image   # revert to the global default
cascade projects show <id>                          # shows pending / verified → <digest> / failed: <reason>
```

Because the Docker socket is router-only, the set mutation never validates inline: it stores the reference as `pending` and enqueues an eager **router-side** validation job that pulls the image, pins its immutable `@sha256:` digest, and runs the runtime smoke-test. On success the project is marked `verified` and **the pinned digest is launched** from then on; any failure (malformed ref, unpullable image, missing tool) marks it `failed` with a precise reason and **never launches** — fail-closed, so a project can never spawn a bad image. Every set/clear is **audited** via a structured `project_worker_image_changed` log line.

**Build from a Dockerfile instead of referencing one** — rather than building and hosting an image yourself, a superadmin can paste **only the extra layers** (RUN / COPY / ENV …) into the **Worker Image** card (source: **Dockerfile**) or via `--dockerfile-file`, and CASCADE supplies the pinned `FROM cascade-worker` base for you. The router builds the image locally, pins its immutable local image ID, and runs the same fail-closed smoke-test, so an unbuildable Dockerfile or a broken runtime marks the project `failed` and never launches. A referenced image and a Dockerfile are **mutually exclusive** — selecting one clears the other (a project has exactly one effective image source). Because the built image is **local to the router that built it** (not pushed to a registry), a Dockerfile-sourced project must be served by the **same single router** that built it. A **Rebuild** button (dashboard) / `--rebuild-worker-image` (CLI) re-runs the build against the current base, so you can pick up a refreshed worker base without editing the content.

```bash
# Superadmin only. Supply extra layers only; CASCADE prepends the pinned FROM.
cascade projects update <id> --dockerfile-file ./extra-layers.Dockerfile   # or "-" for stdin
cascade projects update <id> --rebuild-worker-image      # rebuild against a refreshed base
cascade projects update <id> --clear-dockerfile          # revert to the global default
```

For deeper documentation on all of these topics, see [CLAUDE.md](./CLAUDE.md).

---

## 🤝 Contributing

1. Fork the repository and create a feature branch from `dev`
2. Make your changes with tests (`npm test`)
3. Ensure all checks pass (`npm run verify`)
4. Open a pull request — Cascade will review its own PRs if configured to do so

Please follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide.

---

## 📄 License

MIT
