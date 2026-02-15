# CASCADE - Trello-to-Code Automation Platform

## Quick Start

```bash
npm install
npm run dev
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
- `src/trello/` - Trello API client
- `src/utils/` - Utilities (logging, repo cloning, lifecycle)
- `tools/` - Developer scripts (session debugging, DB seeding, secrets management)

## Environment Variables

Required:
- `DATABASE_URL` - PostgreSQL connection string (Supabase transaction pooler, port 6543)

Optional (infrastructure):
- `PORT` - Server port (default: 3000)
- `LOG_LEVEL` - Logging level (default: info)
- `DATABASE_SSL` - Set to `false` to disable SSL for local PostgreSQL (default: enabled)
- `CLAUDE_CODE_OAUTH_TOKEN` - For Claude Code backend (subscription auth)

**Project credentials** (`GITHUB_TOKEN`, `TRELLO_API_KEY`, `TRELLO_TOKEN`, LLM API keys) are stored per-project in the database `project_secrets` table. There is no env var fallback — the database is the sole source of truth for project-scoped secrets.

## Database Configuration

CASCADE stores all project configuration in PostgreSQL (Supabase). The `config/projects.json` file is no longer used at runtime.

### Schema

- `cascade_defaults` - Global defaults (model, iterations, timeouts, budget)
- `projects` - Per-project config (repo, Trello board/lists/labels, budget, backend)
- `agent_configs` - Per-agent-type overrides (model, iterations, backend, prompt), scoped to global or per-project
- `project_secrets` - Per-project credentials (Trello, GitHub, LLM API keys)

### Database Scripts

```bash
npm run db:generate      # Generate migration SQL from schema changes
npm run db:migrate       # Apply migrations
npm run db:push          # Push schema directly (dev)
npm run db:studio        # Open Drizzle Studio
npm run db:seed          # Seed DB from config/projects.json
```

### Per-Project Secrets

Store per-project credentials in `project_secrets` table. Falls back to global env vars when not set.

```bash
npx tsx tools/manage-secrets.ts set <project-id> TRELLO_API_KEY <value>
npx tsx tools/manage-secrets.ts list <project-id>
npx tsx tools/manage-secrets.ts delete <project-id> <key>
```

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
