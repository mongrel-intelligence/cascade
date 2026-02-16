# CASCADE - Trello-to-Code Automation Platform

## Quick Start

```bash
npm install
cd web && npm install && cd ..
npm run dev          # Backend
npm run dev:web      # Dashboard frontend (separate terminal)
```

## Architecture

CASCADE reacts to Trello webhooks and runs AI agents to analyze, plan, and implement features.

### Trigger System

The extensible trigger system routes events to agents:

```
Trello/GitHub Webhook → TriggerRegistry → Agent → Code Changes → PR
```

- `src/triggers/` - Event handlers (Trello card moves, labels, GitHub PRs, attachments)
- `src/agents/` - AI agents (briefing, planning, implementation, review, debug)
- `src/gadgets/` - Tools agents can use (Trello API, Git operations, file system)

### Multi-Project Support

Projects are configured in the PostgreSQL database (`projects` table). Each project has its own Trello board, GitHub repo, and optional per-project credentials. Use `npm run db:seed` to seed from `config/projects.json` during initial setup.

## Development

### Testing

```bash
npm test                 # Run tests
npm run test:coverage    # Run with coverage
npm run test:watch       # Watch mode
```

### Linting

```bash
npm run lint             # Check
npm run lint:fix         # Fix
npm run typecheck        # Type check
```

### Git Hooks

Lefthook runs pre-commit (lint, typecheck) and pre-push (test) hooks automatically.

## Key Directories

- `src/config/` - Configuration provider, caching, Zod schemas
- `src/db/` - Database client, Drizzle schema, repositories
- `src/triggers/` - Extensible trigger system (Trello, GitHub)
- `src/agents/` - AI agent implementations
- `src/gadgets/` - Custom gadgets (Trello, Git)
- `src/cli/dashboard/` - Dashboard CLI commands (`cascade` binary)
- `src/api/` - Dashboard API (tRPC routers, auth handlers)
- `src/trello/` - Trello API client
- `src/utils/` - Utilities (logging, repo cloning, lifecycle)
- `web/` - Dashboard frontend (React 19, Vite, Tailwind v4, TanStack Router)
- `tools/` - Developer scripts (session debugging, DB seeding, secrets management)

## Environment Variables

Required:
- `DATABASE_URL` - PostgreSQL connection string (Supabase transaction pooler, port 6543)

Optional (infrastructure):
- `PORT` - Server port (default: 3000)
- `LOG_LEVEL` - Logging level (default: info)
- `DATABASE_SSL` - Set to `false` to disable SSL for local PostgreSQL (default: enabled)
- `CLAUDE_CODE_OAUTH_TOKEN` - For Claude Code backend (subscription auth)

**Project credentials** (`GITHUB_TOKEN`, `TRELLO_API_KEY`, `TRELLO_TOKEN`, LLM API keys) are stored in the `credentials` table (org-scoped) with optional per-project overrides via `project_credential_overrides`. There is no env var fallback — the database is the sole source of truth for project-scoped secrets.

## Database Configuration

CASCADE stores all project configuration in PostgreSQL (Supabase). The `config/projects.json` file is no longer used at runtime.

### Schema

- `organizations` - Organization definitions (multi-tenant support)
- `cascade_defaults` - Global defaults per org (model, iterations, timeouts, budget)
- `projects` - Per-project config (repo, base branch, budget, backend)
- `project_integrations` - Integration configs per project (Trello boards/lists/labels as JSONB)
- `agent_configs` - Per-agent-type overrides (model, iterations, backend, prompt), scoped globally, per-org, or per-project
- `credentials` - Org-scoped credentials (API keys, tokens)
- `project_credential_overrides` - Per-project credential overrides (optional, falls back to org defaults)
- `users` - Dashboard users (email, bcrypt password hash, org-scoped)
- `sessions` - Session tokens for cookie-based auth (30-day expiry)

### Database Scripts

```bash
npm run db:generate            # Generate migration SQL from schema changes
npm run db:migrate             # Apply pending migrations
npm run db:push                # Push schema directly (dev only)
npm run db:studio              # Open Drizzle Studio
npm run db:seed                # Seed DB from config/projects.json
npm run db:bootstrap-journal   # Bootstrap migration journal (one-time setup for existing DBs)
```

### Migration Workflow

Migrations are hand-written SQL files in `src/db/migrations/` tracked by drizzle-kit's journal (`meta/_journal.json`). When adding a new migration:

1. Create `src/db/migrations/NNNN_description.sql`
2. Add a corresponding entry to `src/db/migrations/meta/_journal.json` with a unique `when` timestamp (ms since epoch) and `tag` matching the filename without `.sql`
3. Run `npm run db:migrate` to apply

For databases initially set up with `drizzle-kit push` (no migration journal), run `npm run db:bootstrap-journal` once to register existing migrations in the `drizzle.__drizzle_migrations` tracking table.

### Per-Project Secrets

Credentials are stored in the `credentials` table (org-scoped) with optional per-project overrides via `project_credential_overrides`.

```bash
npx tsx tools/manage-secrets.ts create <org-id> <env-var-key> <value> [--name "..."] [--default]
npx tsx tools/manage-secrets.ts list <org-id>
npx tsx tools/manage-secrets.ts set-override <project-id> <env-var-key> <credential-id>
npx tsx tools/manage-secrets.ts remove-override <project-id> <env-var-key>
npx tsx tools/manage-secrets.ts resolve <project-id>
```

### Per-Agent Credential Overrides

Override any credential for a specific agent type. For example, to make the `review` agent use a separate GitHub identity:

```bash
# Create a credential for the reviewer bot
npx tsx tools/manage-secrets.ts create <org-id> GITHUB_TOKEN <reviewer-pat> --name "Reviewer Bot"

# Set agent-scoped overrides (review-related agents use the reviewer token)
npx tsx tools/manage-secrets.ts set-override <project-id> GITHUB_TOKEN <credential-id> --agent-type review
npx tsx tools/manage-secrets.ts set-override <project-id> GITHUB_TOKEN <credential-id> --agent-type respond-to-review
npx tsx tools/manage-secrets.ts set-override <project-id> GITHUB_TOKEN <credential-id> --agent-type respond-to-pr-comment
```

Resolution order: agent+project override → project override → org default → null.

## Claude Code Backend

CASCADE supports using Claude Code SDK as an alternative agent backend. Configure per-project:

```json
{
  "agentBackend": {
    "default": "claude-code",
    "overrides": {
      "implementation": "claude-code",
      "review": "claude-code"
    }
  }
}
```

### Authentication

**Claude Max Subscription via `CLAUDE_CODE_OAUTH_TOKEN`:**

Generate a long-lived OAuth token for headless/containerized environments:

1. Install Claude Code CLI: `npm install -g @anthropic-ai/claude-code`
2. Authenticate: `claude login` -> select "Log in with your subscription account"
3. Generate a token: `claude setup-token`
4. Set the env var:
   ```bash
   export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...
   ```
5. The Claude Code SDK picks up the token automatically from the environment. CASCADE also creates `~/.claude.json` with `{"hasCompletedOnboarding": true}` to skip the CLI's interactive onboarding (required for headless environments).

**Docker verification test:**
```bash
bash tests/docker/claude-code-auth/run-test.sh
```

### Subscription Cost Zeroing

When using a Claude Max subscription (OAuth token), API costs are covered by the subscription. Enable `subscriptionCostZero` to prevent these costs from counting against the per-card budget:

```json
{
  "agentBackend": {
    "default": "claude-code",
    "subscriptionCostZero": true
  }
}
```

When enabled and the backend is `claude-code`, reported costs are zeroed after each session.

## Dashboard

CASCADE includes a web dashboard for exploring agent runs, logs, LLM calls, and debug analyses.

### Running the Dashboard

```bash
npm run dev          # Backend on :3000 (existing tsx watch)
npm run dev:web      # Frontend on :5173 (Vite, proxies /trpc + /api to :3000)
```

### Production Build

```bash
npm run build:web    # Vite builds frontend to dist/web/
npm run build        # tsc compiles backend to dist/
npm start            # Serves API + static frontend on single port
```

### Architecture

The dashboard is a single-process deployment. The Hono server mounts tRPC routes (`/trpc/*`), auth routes (`/api/auth/*`), and in production serves the built frontend as static files.

- **API**: tRPC v11 via `@hono/trpc-server` for end-to-end type safety
- **Auth**: Session cookies (HTTP-only, 30-day expiry) with bcrypt password hashing
- **Frontend**: React 19 + Vite + Tailwind CSS v4 + shadcn/ui + TanStack Router
- **Type sharing**: Frontend imports `type AppRouter` from the backend (type-only, no server code in bundle)

### User Management

Users are managed via direct database inserts:

```bash
# Generate bcrypt hash
node -e "import('bcrypt').then(b => b.default.hash('password', 10).then(console.log))"

# Insert user
psql $DATABASE_URL -c "INSERT INTO users (org_id, email, password_hash, name, role) VALUES ('my-org', 'user@example.com', '\$2b\$10\$...', 'User Name', 'admin');"
```

### Key Files

- `src/api/trpc.ts` - tRPC context, procedures, auth middleware
- `src/api/router.ts` - Root router composition (exports `type AppRouter`)
- `src/api/routers/` - tRPC routers (auth, runs, projects)
- `src/api/auth/` - Login/logout Hono handlers, session resolution
- `web/src/lib/trpc.ts` - Frontend tRPC client (type-safe via AppRouter import)

## CLI (`cascade`)

CASCADE includes a `cascade` CLI for managing the platform from the terminal. It consumes the same tRPC endpoints as the web dashboard — no business logic duplication, full type safety.

### Setup

```bash
npm run build                    # Compile TypeScript
cascade login --server http://localhost:3000 --email you@example.com --password secret
cascade whoami                   # Verify session
```

Config is stored in `~/.cascade/cli.json`. Override with env vars for CI/scripts:

```bash
export CASCADE_SERVER_URL=http://localhost:3000
export CASCADE_SESSION_TOKEN=<token>
```

### Commands

```bash
# Auth
cascade login --server URL --email X --password Y
cascade logout
cascade whoami

# Runs
cascade runs list [--project ID] [--status running,failed] [--agent-type impl] [--limit 20]
cascade runs show <run-id>
cascade runs logs <run-id>                    # Pipe: cascade runs logs ID | grep error
cascade runs llm-calls <run-id>
cascade runs llm-call <run-id> <call-number>
cascade runs debug <run-id>                    # View debug analysis
cascade runs debug <run-id> --analyze          # Trigger new debug analysis
cascade runs debug <run-id> --analyze --wait   # Trigger and wait for completion
cascade runs trigger --project <id> --agent-type <type> [--card-id ID] [--model MODEL]
cascade runs retry <run-id> [--model MODEL]

# Projects
cascade projects list
cascade projects show <id>
cascade projects create --id my-project --name "My Project" --repo owner/repo
cascade projects update <id> --model claude-sonnet-4-5-20250929
cascade projects delete <id> --yes
cascade projects integrations <id>
cascade projects integration-set <id> --type trello --config '{"boardId":"..."}'
cascade projects overrides <id>
cascade projects override-set <id> --key GITHUB_TOKEN --credential-id 5
cascade projects override-set <id> --key GITHUB_TOKEN --credential-id 7 --agent-type review
cascade projects override-rm <id> --key GITHUB_TOKEN

# Credentials
cascade credentials list
cascade credentials create --name "GitHub Bot" --key GITHUB_TOKEN --value ghp_... [--default]
cascade credentials update <id> --value new-secret
cascade credentials delete <id> --yes

# Defaults
cascade defaults show
cascade defaults set --model claude-sonnet-4-5-20250929 --max-iterations 25 --agent-backend claude-code

# Organization
cascade org show
cascade org update --name "My Org"

# Agent Configs
cascade agents list [--project-id ID]
cascade agents create --agent-type implementation --model claude-sonnet-4-5-20250929 [--project-id ID]
cascade agents update <id> --max-iterations 30
cascade agents delete <id> --yes

# Webhooks
cascade webhooks list <project-id>
cascade webhooks create <project-id> --callback-url https://cascade.example.com
cascade webhooks delete <project-id> --callback-url https://cascade.example.com
```

### Global Flags

- `--json` — Machine-readable JSON output (all commands). Pipe to `jq` for scripting.
- `--server URL` — Override server URL for a single invocation.

### Architecture

Each command is a thin adapter: **parse flags → call tRPC → format output**. All business logic lives server-side.

```
src/cli/dashboard/
├── _shared/          # Config, tRPC client, base class, formatters
├── login.ts          # Auth (HTTP, not tRPC)
├── logout.ts
├── whoami.ts
├── runs/             # 6 commands
├── projects/         # 10 commands
├── credentials/      # 4 commands
├── defaults/         # 2 commands
├── org/              # 2 commands
├── agents/           # 4 commands
└── webhooks/         # 3 commands
```

The `cascade` binary is separate from `cascade-tools` (which is for agents). The `cascade-tools` binary uses a custom oclif config in `bin/cascade-tools.js` to discover only agent tool commands (`dist/cli/pm/`, `dist/cli/github/`, `dist/cli/session/`), while `cascade` discovers only dashboard commands (`dist/cli/dashboard/`).

## Adding New Triggers

1. Create trigger handler in `src/triggers/`
2. Implement `TriggerHandler` interface
3. Register in `src/triggers/index.ts`

## Adding New Agents

1. Create agent in `src/agents/`
2. Define system prompt in `src/agents/prompts/`
3. Register in agent registry

## Agent Resilience Features

CASCADE integrates llmist's resilience features to ensure reliable operation during long-running sessions:

### Rate Limiting (Proactive)
- Model-specific rate limits with safety margins (80-90%)
- Tracks requests per minute (RPM), tokens per minute (TPM), and daily token usage
- Prevents 429 errors by throttling requests before hitting API limits
- Configured in `src/config/rateLimits.ts`

### Retry Strategy (Reactive)
- Handles transient failures (rate limits, 5xx errors, timeouts, connection issues)
- 5 retry attempts with exponential backoff (1s → 60s max)
- Respects `Retry-After` headers from providers
- Jitter randomization prevents thundering herd problems
- Configured in `src/config/retryConfig.ts`

### Context Compaction
- Prevents context window overflow on long-running sessions
- **Implementation agent**: Triggers at 70% context usage, reduces to 40%, preserves 8 recent turns
- **Other agents**: Triggers at 80% context usage, reduces to 50%, preserves 5 recent turns
- Hybrid strategy: intelligently mixes summarization and sliding-window
- Configured in `src/config/compactionConfig.ts`

### Iteration Hints
- Ephemeral trailing messages showing iteration progress
- Urgency warnings at >80%: "⚠️ ITERATION BUDGET: 17/20 - Only 3 remaining!"
- Helps LLM prioritize and wrap up before hitting iteration limits
- Configured in `src/config/hintConfig.ts`

**Monitoring**: Check `llmist-*.log` for rate limiting events. Compaction events are logged to main agent logs with details (tokens saved, reduction percentage, messages removed).

## Debugging Production Sessions

### Manual Session Download

Download session logs and card data from a Trello card for debugging:

```bash
npm run tool:download-session https://trello.com/c/abc123/card-name
# or just the card ID
npm run tool:download-session abc123
```

This downloads all `.gz` log attachments (ungzipped), plus card description, checklists, and comments into a temp directory.

### Automatic Debug Analysis

CASCADE includes a debug agent that automatically analyzes agent session logs:

1. **Automatic Trigger**: When an agent uploads a session log (`.zip` file) to a Trello card, the debug agent automatically triggers
2. **Log Analysis**: The debug agent downloads, extracts, and analyzes the session logs to identify:
   - Errors and exceptions
   - Failed gadget calls
   - Iteration loops and inefficiencies
   - Excessive LLM calls
   - Scope creep or confusion patterns
3. **Debug Card Creation**: Creates a new card in the DEBUG list with:
   - Title: `{agent-type} - {original card name}`
   - Executive summary of what went wrong
   - Key issues found
   - Timeline of events
   - Actionable recommendations
   - Link back to the original card

**Setup**: Add a `debug` list to your Trello board and configure it in `config/projects.json`:

```json
{
  "trello": {
    "lists": {
      "briefing": "...",
      "planning": "...",
      "todo": "...",
      "debug": "YOUR_DEBUG_LIST_ID"
    }
  }
}
```

The debug agent only analyzes logs uploaded by the authenticated CASCADE user and matching the pattern `{agent-type}-{timestamp}.zip`.
