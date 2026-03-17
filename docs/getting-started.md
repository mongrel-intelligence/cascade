# Getting Started with CASCADE

This guide walks you through setting up CASCADE using Docker Compose — from zero to a working instance that turns PM cards into pull requests.

---

## Prerequisites

- **Docker** and **Docker Compose** (v2+)
- ~6 GB disk space (the worker image includes Claude Code CLI and other agent tools)
- A GitHub repository you want CASCADE to work on
- At least one LLM API key (OpenRouter, Anthropic, or OpenAI) or a Claude Max subscription

---

## 1. Installation

```bash
git clone https://github.com/zbigniewsobiecki/cascade.git
cd cascade
cp .env.docker.example .env
```

Edit `.env` if you need to change defaults (ports, passwords, etc.). The defaults work out of the box for local use. If port 3000 or 3001 is already in use, set `ROUTER_PORT` or `DASHBOARD_PORT` in `.env`.

---

## 2. Build and Start

```bash
bash setup.sh
```

This single command builds all images, runs database migrations, and starts every service.

Verify everything is running:

```bash
docker compose ps                          # All services healthy
curl http://localhost:3001/health           # Dashboard API
curl http://localhost:3000/health           # Router
curl -s http://localhost:3001 | head -5     # Frontend HTML
```

<details>
<summary>Manual alternative (individual commands)</summary>

```bash
# Build all images (dashboard, router, worker)
docker compose build
docker compose --profile build-only build worker

# Run database migrations
docker compose --profile setup run --rm migrate

# Start services
docker compose up -d
```

</details>

---

## 3. Create Admin User

```bash
docker compose exec dashboard node dist/tools/create-admin-user.mjs \
  --email admin@example.com \
  --password changeme \
  --name "Admin"
```

---

## 4. First Login

Open **http://localhost:3001** in your browser and log in with the credentials you just created.

You can also log in via the CLI (useful for scripting — requires Node.js installed locally):

```bash
npm install && npm run build
node bin/cascade.js login --server http://localhost:3001 --email admin@example.com --password changeme
```

---

## 5. Create Your First Project

> **Note:** CLI commands in steps 5–10 require Node.js installed locally with `npm install && npm run build`. All operations can also be done through the dashboard UI.

Via the dashboard: **Projects** > **New Project** — fill in the project ID, name, and GitHub repository (`owner/repo`).

Or via CLI:

```bash
node bin/cascade.js projects create \
  --id my-project \
  --name "My Project" \
  --repo owner/repo-name
```

---

## 6. Add Credentials

CASCADE needs credentials to interact with GitHub, your PM tool, and LLM providers. All credentials are stored encrypted in the database, scoped to your project.

Via the dashboard: **Projects** > select project > **Credentials** to manage project credentials.

Or via CLI:

### GitHub bot tokens

CASCADE uses two separate GitHub accounts to prevent feedback loops:

- **Implementer** — writes code, creates PRs
- **Reviewer** — reviews PRs, approves or requests changes

Create [personal access tokens](https://github.com/settings/tokens) (or fine-grained tokens) for each bot account with `repo` scope.

```bash
node bin/cascade.js projects credentials-set my-project \
  --key GITHUB_TOKEN_IMPLEMENTER \
  --value ghp_... \
  --name "Implementer Bot"

node bin/cascade.js projects credentials-set my-project \
  --key GITHUB_TOKEN_REVIEWER \
  --value ghp_... \
  --name "Reviewer Bot"
```

### LLM API keys

Which credentials you need depends on which agent engine you plan to use. You can always add more later.

#### LLMist engine (default)

LLMist supports OpenRouter, Anthropic, and OpenAI. Store the key for whichever provider you prefer:

```bash
# OpenRouter (recommended — access to many models via one key)
node bin/cascade.js projects credentials-set my-project \
  --key OPENROUTER_API_KEY \
  --value sk-or-... \
  --name "OpenRouter"

# Or: Anthropic API key directly
node bin/cascade.js projects credentials-set my-project \
  --key ANTHROPIC_API_KEY \
  --value sk-ant-... \
  --name "Anthropic"

# Or: OpenAI API key directly
node bin/cascade.js projects credentials-set my-project \
  --key OPENAI_API_KEY \
  --value sk-... \
  --name "OpenAI"
```

#### Claude Code engine

Requires either an Anthropic API key or a Claude Max subscription token:

```bash
# Option A: Anthropic API key
node bin/cascade.js projects credentials-set my-project \
  --key ANTHROPIC_API_KEY \
  --value sk-ant-... \
  --name "Anthropic"

# Option B: Claude Max subscription (long-lived OAuth token)
# Generate with: claude login && claude setup-token
node bin/cascade.js projects credentials-set my-project \
  --key CLAUDE_CODE_OAUTH_TOKEN \
  --value sk-ant-oat01-... \
  --name "Claude Code OAuth"
```

#### Codex engine

Requires either an OpenAI API key or a ChatGPT Plus/Pro subscription:

```bash
# Option A: OpenAI API key — just store the key, no extra setup needed
node bin/cascade.js projects credentials-set my-project \
  --key OPENAI_API_KEY \
  --value sk-... \
  --name "OpenAI"

# Option B: ChatGPT Plus/Pro subscription auth
# First, authenticate on a machine with a browser:
#   codex login
# Then store the auth token:
node bin/cascade.js projects credentials-set my-project \
  --key CODEX_AUTH_JSON \
  --value "$(cat ~/.codex/auth.json)" \
  --name "Codex Subscription Auth"
```

When using subscription auth, CASCADE automatically writes `~/.codex/auth.json` in the worker before each run and captures any token refreshes the Codex CLI performs back into the database — so the credential stays current across ephemeral worker environments.

You can also manage all of this through the dashboard UI: **Projects** > select project > **Credentials**.

---

## 7. Choose Agent Engine

CASCADE supports multiple agent engines. The default is **LLMist** — change it if you want to use a different engine.

| Engine | Description |
|--------|-------------|
| `llmist` | LLMist SDK with CASCADE gadgets (default) |
| `claude-code` | Anthropic Claude Code SDK |
| `codex` | OpenAI Codex CLI |
| `opencode` | OpenCode headless agent |

Via the dashboard: **Projects** > select project > **Settings** — choose the engine from the dropdown.

Or via CLI:

```bash
node bin/cascade.js projects update my-project --agent-engine codex
```

You can also override the engine per agent type in the **Agent Configs** tab.

---

## 8. Connect a PM Integration

Configure via the dashboard: **Projects** > select project > **Settings** > **Integrations** > **PM** tab.

Or via CLI:

### Trello

1. Get your Trello API key from https://trello.com/power-ups/admin
2. Generate a token with that key
3. Find your board ID and list IDs (use the Trello API or append `.json` to your board URL)

```bash
# Store Trello credentials (project-scoped)
node bin/cascade.js projects credentials-set my-project --key TRELLO_API_KEY --value ... --name "Trello API Key"
node bin/cascade.js projects credentials-set my-project --key TRELLO_TOKEN --value ... --name "Trello Token"

# Configure the integration
node bin/cascade.js projects integration-set my-project \
  --category pm --provider trello \
  --config '{"boardId":"BOARD_ID","lists":{"todo":"LIST_ID","inProgress":"LIST_ID","inReview":"LIST_ID"},"labels":{"readyToProcess":"LABEL_ID","processing":"LABEL_ID","processed":"LABEL_ID","error":"LABEL_ID"}}'
```

### JIRA

```bash
# Store JIRA credentials (project-scoped)
node bin/cascade.js projects credentials-set my-project --key JIRA_EMAIL --value you@company.com --name "JIRA Email"
node bin/cascade.js projects credentials-set my-project --key JIRA_API_TOKEN --value ... --name "JIRA API Token"

# Configure the integration
node bin/cascade.js projects integration-set my-project \
  --category pm --provider jira \
  --config '{"baseUrl":"https://yourorg.atlassian.net","projectKey":"PROJ","statuses":{"todo":"To Do","inProgress":"In Progress","inReview":"In Review"}}'
```

---

## 9. Set Up Webhooks

CASCADE needs to receive webhooks from GitHub (and optionally your PM tool) to trigger agents.

Your CASCADE instance must be reachable from the internet. For local development, use a tunnel like [ngrok](https://ngrok.com/) or [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/).

Configure via the dashboard: **Projects** > select project > **Settings** > **Webhooks** tab.

Or via CLI:

```bash
# Example with ngrok
ngrok http 3000

# Create webhooks using the tunnel URL
node bin/cascade.js webhooks create my-project \
  --callback-url https://your-tunnel.ngrok.io
```

This creates webhooks on GitHub (and Trello if configured) pointing to your Router.

---

## 10. Configure Triggers

Triggers control which events activate which agents.

Configure via the dashboard: **Projects** > select project > **Agent Configs** tab.

Or via CLI:

```bash
# Enable implementation when a card moves to the right status
node bin/cascade.js projects trigger-set my-project \
  --agent implementation --event pm:status-changed --enable

# Enable review after CI passes (for CASCADE's own PRs)
node bin/cascade.js projects trigger-set my-project \
  --agent review --event scm:check-suite-success --enable \
  --params '{"authorMode":"own"}'

# Enable respond-to-review when the reviewer requests changes
node bin/cascade.js projects trigger-set my-project \
  --agent respond-to-review --event scm:pr-review-submitted --enable

# See all available triggers for an agent
node bin/cascade.js projects trigger-discover --agent implementation
```

---

## 11. Test It

1. Create a card in your PM tool (Trello/JIRA) with a clear description of what code change you want
2. Move it to the status that triggers the implementation agent (or add the "Ready to Process" label)
3. Watch the dashboard — a new run should appear within seconds
4. The agent clones your repo, writes code, and opens a pull request

Check the dashboard for real-time logs, LLM call traces, and debug information.

---

## Production Deployment

### HTTPS with a Reverse Proxy

For production, put CASCADE behind a reverse proxy (nginx, Caddy, Traefik) that terminates TLS:

```bash
# .env
CORS_ORIGIN=https://cascade.yourdomain.com
COOKIE_DOMAIN=yourdomain.com
```

### Credential Encryption

Generate an encryption key and set it before storing any credentials:

```bash
# Generate key
openssl rand -hex 32

# Add to .env
CREDENTIAL_MASTER_KEY=<your-64-char-hex-key>

# Restart services
docker compose down && docker compose up -d

# Encrypt existing plaintext credentials (if any)
docker compose exec dashboard node dist/tools/migrate-credentials-encrypt.mjs
```

### Updating

```bash
git pull
bash setup.sh
```

---

## Troubleshooting

### Docker socket permissions

If the router can't spawn workers:

```
Error: connect EACCES /var/run/docker.sock
```

Make sure the Docker socket is readable by the container. On Linux, you may need to add the container's user to the `docker` group or adjust socket permissions.

### Worker image not found

If you see `No such image: cascade-worker:local`, the worker image wasn't built. The worker uses a profile, so it needs an explicit build:

```bash
docker compose --profile build-only build worker
```

### Workers can't connect to PostgreSQL

Workers use `CASCADE_POSTGRES_HOST=postgres` to connect to the database inside the Docker network. Verify the network name matches:

```bash
docker network ls | grep cascade
# Should show: cascade_default
```

The `name: cascade` in `docker-compose.yml` ensures the network is always `cascade_default`.

### Migration fails

If migrations fail, check that PostgreSQL is healthy:

```bash
docker compose ps postgres
docker compose logs postgres
```

Re-run migrations:

```bash
docker compose --profile setup run --rm migrate
```

### Frontend not loading

If `http://localhost:3001` returns JSON instead of the web UI, the frontend wasn't built into the dashboard image. Rebuild:

```bash
docker compose build dashboard
docker compose up -d dashboard
```
