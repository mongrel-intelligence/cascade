# CASCADE

> **CASCADE turns PM cards into pull requests using AI agents.**

CASCADE is an open-source automation platform that bridges your project management tool (Trello or JIRA) with your GitHub repository. When you move a card to the right list — or add a label — CASCADE picks it up, runs an AI agent, and delivers a pull request.

```
PM Card → Webhook → Router → Redis/BullMQ → Worker → Agent → PR
```

---

## Features

- **Multi-PM support** — Works with Trello and JIRA out of the box
- **11 agent types** — Splitting, planning, implementation, review, debug, respond-to-review, respond-to-CI, and more
- **Dual-persona GitHub model** — Separate implementer and reviewer bot accounts to prevent feedback loops
- **Web dashboard + CLI** — Monitor runs, manage projects, configure triggers
- **Extensible trigger system** — Add new events without touching core logic
- **Pluggable agent engines** — Built-in `llmist` and `claude-code` engines, with a shared contract for adding more
- **Credential encryption** — AES-256-GCM encryption for all stored secrets

---

## Prerequisites

- **Node.js 22+**
- **PostgreSQL** (Supabase or self-hosted)
- **Redis** (for BullMQ job queue)
- **Git**

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/your-org/cascade.git
cd cascade
npm install
cd web && npm install && cd ..
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` — at minimum set your database and Redis URLs:

```
DATABASE_URL=postgresql://user:password@localhost:5432/cascade
REDIS_URL=redis://localhost:6379
```

> All project credentials (GitHub tokens, Trello/JIRA keys, LLM API keys) are stored in the database, not environment variables. The `.env` file only needs infrastructure connection strings.

### 3. Start Redis

```bash
# macOS
brew install redis && brew services start redis

# Linux
apt-get install redis-server && service redis-server start
```

### 4. Run database migrations

```bash
npm run db:migrate
```

### 5. Start the services

Open three terminals:

```bash
# Terminal 1 — Router (receives webhooks)
npm run dev

# Terminal 2 — Dashboard API (tRPC server on :3001)
npm run build && node --env-file=.env dist/dashboard.js

# Terminal 3 — Web UI (Vite dev server on :5173)
npm run dev:web
```

Open **http://localhost:5173** — you'll see the dashboard.

### 6. First login

Create your first organization and user directly in the database:

```bash
# First, create an organization (required for foreign key constraint)
psql $DATABASE_URL -c "INSERT INTO organizations (id, name) VALUES ('my-org', 'My Organization');"

# Then hash your password and create the user
node -e "import('bcrypt').then(b => b.default.hash('yourpassword', 10).then(console.log))"
psql $DATABASE_URL -c "INSERT INTO users (org_id, email, password_hash, name, role) VALUES ('my-org', 'you@example.com', '\$2b\$10\$...', 'Your Name', 'admin');"
```

Then log in via the dashboard or CLI:

```bash
npm run build
node bin/cascade.js login --server http://localhost:3001 --email you@example.com --password yourpassword
```

---

## Architecture

CASCADE runs as three independent services:

| Service | Entry Point | Role |
|---------|-------------|------|
| **Router** | `src/router/index.ts` | Receives webhooks, enqueues jobs to Redis via BullMQ |
| **Worker** | `src/worker-entry.ts` | Processes one job per container, exits when done |
| **Dashboard** | `src/dashboard.ts` | Serves the API (tRPC) and web UI |

### Agent Types

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

### Project Structure

```
cascade/
├── src/
│   ├── router/               # Webhook receiver (enqueues to Redis)
│   ├── worker-entry.ts       # Worker entry point (job processor)
│   ├── dashboard.ts          # Dashboard entry point (API + tRPC)
│   ├── webhook/              # Shared webhook handler factory, parsers, logging
│   ├── config/               # Configuration loading, caching, Zod schemas
│   ├── triggers/             # Extensible trigger system
│   │   ├── registry.ts       # TriggerRegistry
│   │   ├── types.ts          # TriggerHandler interface
│   │   ├── trello/           # Trello-specific triggers
│   │   ├── github/           # GitHub-specific triggers
│   │   └── jira/             # JIRA-specific triggers
│   ├── agents/               # AI agent implementations
│   │   ├── registry.ts       # Agent registry
│   │   ├── definitions/      # Per-agent YAML configs
│   │   └── prompts/          # System prompt templates
│   ├── backends/             # Agent engine implementations and shared execution lifecycle
│   ├── gadgets/              # Tools available to agents
│   ├── pm/                   # PM provider abstraction (Trello, JIRA)
│   ├── github/               # GitHub client and dual-persona model
│   ├── trello/               # Trello API client
│   ├── jira/                 # JIRA API client
│   ├── db/                   # Drizzle schema, migrations, repositories
│   ├── api/                  # Dashboard API (tRPC routers)
│   ├── cli/                  # CLI commands for dashboard and agents
│   ├── queue/                # BullMQ job queue client
│   ├── types/                # Shared TypeScript types
│   └── utils/                # Logging, repo cloning, lifecycle helpers
├── web/                      # Dashboard frontend (React 19, Vite, Tailwind v4)
├── tests/                    # Unit and integration tests
└── tools/                    # Developer scripts (seeding, secrets, debugging)
```

---

## Initial Setup

After completing the Quick Start, configure your first project.

### Create a project

```bash
node bin/cascade.js projects create \
  --id my-project \
  --name "My Project" \
  --repo owner/repo-name
```

### Add credentials

```bash
# GitHub bot tokens
node bin/cascade.js credentials create \
  --name "Implementer Bot" \
  --key GITHUB_TOKEN_IMPLEMENTER \
  --value ghp_aaa... \
  --default

node bin/cascade.js credentials create \
  --name "Reviewer Bot" \
  --key GITHUB_TOKEN_REVIEWER \
  --value ghp_bbb... \
  --default

# LLM API key (e.g., OpenRouter)
node bin/cascade.js credentials create \
  --name "OpenRouter" \
  --key OPENROUTER_API_KEY \
  --value sk-or-... \
  --default
```

### Link credentials to the project

```bash
# After creating credentials, note their IDs from `cascade credentials list`
node bin/cascade.js projects integration-credential-set my-project \
  --category scm \
  --role implementer_token \
  --credential-id 1

node bin/cascade.js projects integration-credential-set my-project \
  --category scm \
  --role reviewer_token \
  --credential-id 2
```

### Connect a PM integration

**Trello:**

```bash
node bin/cascade.js projects integration-set my-project \
  --category pm \
  --provider trello \
  --config '{"boardId":"YOUR_BOARD_ID","lists":{"splitting":"LIST_ID","planning":"LIST_ID","todo":"LIST_ID","inProgress":"LIST_ID","inReview":"LIST_ID"},"labels":{"readyToProcess":"LABEL_ID","processing":"LABEL_ID","processed":"LABEL_ID","error":"LABEL_ID"}}'

# Link Trello credentials
node bin/cascade.js projects integration-credential-set my-project \
  --category pm \
  --role api_key \
  --credential-id 3

node bin/cascade.js projects integration-credential-set my-project \
  --category pm \
  --role token \
  --credential-id 4
```

**JIRA:**

```bash
node bin/cascade.js projects integration-set my-project \
  --category pm \
  --provider jira \
  --config '{"baseUrl":"https://yourorg.atlassian.net","projectKey":"PROJ","statusMap":{"splitting":"Splitting","planning":"Planning","todo":"To Do"}}'
```

### Set up webhooks

```bash
# Creates webhooks on GitHub (and Trello if configured)
node bin/cascade.js webhooks create my-project \
  --callback-url https://your-deployment.example.com
```

### Configure agent triggers

```bash
# Enable implementation when a card moves to the right status
node bin/cascade.js projects trigger-set my-project \
  --agent implementation \
  --event pm:status-changed \
  --enable

# Enable review after CI passes (for implementer PRs only)
node bin/cascade.js projects trigger-set my-project \
  --agent review \
  --event scm:check-suite-success \
  --enable \
  --params '{"authorMode":"own"}'
```

---

## Development

### Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Router with hot reload |
| `npm run dev:web` | Start Dashboard frontend (Vite on :5173) |
| `npm test` | Run all tests (Vitest) |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run lint` | Check code style (Biome) |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run typecheck` | TypeScript type checking |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Start production Router |
| `npm run db:generate` | Generate migration SQL from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Open Drizzle Studio |

### Testing

```bash
# Unit tests (fast, no DB required)
npm test

# Integration tests (requires PostgreSQL — starts via Docker)
npm run test:db:up
npm run test:integration
```

Tests use [Vitest](https://vitest.dev/). Unit tests are in `tests/unit/`, integration tests in `tests/integration/`.

### Git Hooks

[Lefthook](https://github.com/evilmartians/lefthook) runs automatically:

- **pre-commit**: lint + typecheck
- **pre-push**: full test suite

Install hooks after cloning:

```bash
npx lefthook install
```

---

## Deployment

CASCADE ships four Docker images for production:

| Image | Dockerfile | Purpose |
|-------|-----------|---------|
| Router | `Dockerfile.router` | Lightweight webhook receiver |
| Worker | `Dockerfile.worker` | Full agent runtime (clones repos, runs AI) |
| Dashboard | `Dockerfile.dashboard` | API server (tRPC + auth) |
| Frontend | `Dockerfile.frontend` | Static web UI (deployed via Cloudflare Pages) |

### Required production environment variables

```bash
# Infrastructure
DATABASE_URL=postgresql://user:pass@host:5432/cascade
REDIS_URL=redis://your-redis-host:6379

# Security
CREDENTIAL_MASTER_KEY=<64-char hex string>   # Encrypt credentials at rest
                                              # Generate: npm run credentials:generate-key
```

All project-level credentials (GitHub tokens, Trello/JIRA keys, LLM API keys) are stored in the database and managed through the dashboard or CLI — no additional environment variables are needed per project.

### Example: Docker Compose

```yaml
services:
  router:
    build:
      context: .
      dockerfile: Dockerfile.router
    environment:
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
    ports:
      - "3000:3000"

  worker:
    build:
      context: .
      dockerfile: Dockerfile.worker
    environment:
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}

  dashboard:
    build:
      context: .
      dockerfile: Dockerfile.dashboard
    environment:
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
    ports:
      - "3001:3001"
```

---

## CLI Reference

The `cascade` CLI connects to your dashboard API for all operations. In development, build first:

```bash
npm run build
node bin/cascade.js <command>
```

In production, the `cascade` binary is available globally.

### Global flags

| Flag | Description |
|------|-------------|
| `--json` | Machine-readable JSON output |
| `--server URL` | Override dashboard server URL |

### Command groups

```bash
# Authentication
cascade login --server http://localhost:3001 --email you@example.com --password secret
cascade logout
cascade whoami

# Projects
cascade projects list
cascade projects show <id>
cascade projects create --id <id> --name "Name" --repo owner/repo
cascade projects integrations <id>
cascade projects trigger-list <id>
cascade projects trigger-set <id> --agent <type> --event <event> --enable

# Credentials
cascade credentials list
cascade credentials create --name "..." --key KEY_NAME --value secret --default
cascade credentials update <id> --value new-secret
cascade credentials delete <id> --yes

# Runs
cascade runs list [--project ID] [--status running,failed]
cascade runs show <run-id>
cascade runs logs <run-id>
cascade runs trigger --project <id> --agent-type <type>
cascade runs retry <run-id>

# Webhooks
cascade webhooks list <project-id>
cascade webhooks create <project-id> --callback-url https://...
cascade webhooks delete <project-id>

# Defaults and org
cascade defaults show
cascade defaults set --model claude-sonnet-4-5 --max-iterations 25
cascade org show
```

See `cascade <command> --help` for full options on any command.

---

## Extending CASCADE

### Adding a trigger

Triggers live in `src/triggers/`. Implement the `TriggerHandler` interface from `src/triggers/types.ts`:

```typescript
// src/triggers/trello/my-trigger.ts
import type { TriggerHandler, TriggerContext, TriggerResult } from '../types.js';

export class MyCustomTrigger implements TriggerHandler {
  name = 'my-custom-trigger';
  description = 'Triggers when something happens';

  matches(ctx: TriggerContext): boolean {
    return ctx.source === 'trello' && /* your condition */;
  }

  async handle(ctx: TriggerContext): Promise<TriggerResult> {
    return {
      agentType: 'implementation',
      agentInput: { /* data for the agent */ },
    };
  }
}

// Register in src/triggers/index.ts
registry.register(new MyCustomTrigger());
```

### Adding an agent

1. Add a YAML definition in `src/agents/definitions/` (see existing files for the schema)
2. Add a system prompt template in `src/agents/prompts/templates/`

Agent types are auto-discovered from YAML filenames in `src/agents/definitions/` — no manual registration is needed. The agent registry only resolves and executes registered agent *engines* (currently `llmist` and `claude-code`), not agent types.

### Adding a PM provider

1. Implement the `PMProvider` interface from `src/pm/types.ts` for data operations (card/issue management)
2. Implement the `PMIntegration` interface from `src/pm/integration.ts` to wrap your provider with credential resolution, webhook parsing, and trigger registration
3. Register the `PMIntegration` instance in `src/pm/registry.ts` via `pmRegistry.register()`

See `src/pm/trello/` and `src/pm/jira/` for reference implementations.

---

## Key Concepts

**Dual-persona GitHub model** — CASCADE uses two separate GitHub bot accounts per project (implementer and reviewer) to prevent feedback loops. The implementer writes code and creates PRs; the reviewer reviews and approves them. See CLAUDE.md for setup details.

**Trigger system** — Events from Trello, JIRA, and GitHub webhooks are matched against registered `TriggerHandler` instances. Triggers are configured per-project in the database via `agent_trigger_configs`.

**Agent engines** — Agents run through a shared execution lifecycle and a pluggable engine registry. The default engine is `llmist` (supports OpenRouter, Anthropic, OpenAI). The `claude-code` engine uses the Claude Code SDK with your Claude Max subscription. Adding a new engine means registering a new engine definition plus an execution adapter.

**Credential management** — All secrets are stored in the `credentials` table, scoped to an organization. Integration-specific credentials are linked via the `integration_credentials` join table. Optional AES-256-GCM encryption is enabled by setting `CREDENTIAL_MASTER_KEY`.

**Agent resilience** — Built-in rate limiting (proactive), exponential-backoff retry (reactive), and context compaction prevent failures during long-running sessions. See `src/config/rateLimits.ts`, `retryConfig.ts`, and `compactionConfig.ts`.

For deeper documentation on any of these topics, see [CLAUDE.md](./CLAUDE.md).

---

## Contributing

1. Fork the repository and create a feature branch
2. Make your changes with tests (`npm test`)
3. Ensure lint and typecheck pass (`npm run lint && npm run typecheck`)
4. Open a pull request — CASCADE will review its own PRs if configured to do so

Please follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages.

---

## License

MIT
