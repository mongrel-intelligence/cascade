# Getting Started with Cascade

This guide walks you through setting up Cascade using Docker Compose — from zero to a working instance that turns PM cards into pull requests.

---

## Prerequisites

- **Docker** and **Docker Compose** (v2+)
- ~8 GB disk space (the worker image ships agent CLIs, a Python shim, and a shared Playwright Chromium cache at `$PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` — see [engine-backends](./architecture/05-engine-backends.md#worker-image-runtime-baseline-mng-1055))
- A GitHub repository you want Cascade to work on
- At least one LLM API key (OpenRouter, Anthropic, or OpenAI) or a Claude Max subscription

---

## 1. Installation

```bash
git clone https://github.com/mongrel-intelligence/cascade.git
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

Cascade needs credentials to interact with GitHub, your PM tool, and LLM providers. All credentials are stored encrypted in the database, scoped to your project.

Via the dashboard: **Projects** > select project > **Credentials** to manage project credentials.

Or via CLI:

### GitHub bot tokens

Cascade uses two separate GitHub accounts to prevent feedback loops:

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

#### LLMist engine

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

#### Claude Code engine (default)

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

When using subscription auth, Cascade automatically writes `~/.codex/auth.json` in the worker before each run and captures any token refreshes the Codex CLI performs back into the database — so the credential stays current across ephemeral worker environments.

You can also manage all of this through the dashboard UI: **Projects** > select project > **Credentials**.

---

## 7. Choose Agent Engine

Cascade supports multiple agent engines. The default is **Claude Code** — change it if you want to use a different engine.

| Engine | Description |
|--------|-------------|
| `claude-code` | Anthropic Claude Code SDK (default) |
| `llmist` | LLMist SDK with Cascade gadgets |
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

### Jira

```bash
# Store Jira credentials (project-scoped)
node bin/cascade.js projects credentials-set my-project --key JIRA_EMAIL --value you@company.com --name "Jira Email"
node bin/cascade.js projects credentials-set my-project --key JIRA_API_TOKEN --value ... --name "Jira API Token"

# Configure the integration
node bin/cascade.js projects integration-set my-project \
  --category pm --provider jira \
  --config '{"baseUrl":"https://yourorg.atlassian.net","projectKey":"PROJ","statuses":{"todo":"To Do","inProgress":"In Progress","inReview":"In Review"}}'
```

#### Scoped API tokens (`authType`)

Cascade also supports Atlassian **API tokens with scopes** ("scoped" tokens) alongside classic unscoped site tokens. Opt in with the `authType` field on the integration config:

```bash
node bin/cascade.js projects integration-set my-project \
  --category pm --provider jira \
  --config '{"baseUrl":"https://yourorg.atlassian.net","projectKey":"PROJ","authType":"scoped","statuses":{"todo":"To Do","inProgress":"In Progress","inReview":"In Review"}}'
```

`authType` is a non-secret connection setting (like `baseUrl`), **not** a credential — the stored `JIRA_EMAIL` / `JIRA_API_TOKEN` are unchanged. Both modes authenticate with **HTTP Basic** (`email:api_token`), so `authType` selects the request *host*, not the auth scheme:

- `authType: "basic"` (or omitted — the historical default) routes REST v3 calls to your tenant **site URL** (`https://yourorg.atlassian.net`). Every existing config keeps working untouched.
- `authType: "scoped"` routes REST v3 calls through the Atlassian **gateway** (`https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/...`). Cascade resolves `cloudId` automatically from `https://yourorg.atlassian.net/_edge/tenant_info` using the same Basic scoped token and caches it per site URL. Direct site REST v3 calls can fail under a scoped token, so the gateway is the supported path for scoped tokens.

**Required scopes.** Grant the token read/write access to Jira work (classic OAuth `read:jira-work` + `write:jira-work`). Programmatic webhook management additionally needs webhook scopes — classic OAuth `manage:jira-webhook`, or the granular `read:field:jira` + `read:project:jira` + `write:webhook:jira`.

**Known limitations under scoped tokens:**

- **Ack reactions are unavailable.** The "eyes" acknowledgment reaction uses Jira's internal `/rest/reactions/1.0/` API, which is not exposed through the scoped gateway. Under `scoped` auth Cascade logs one line and skips the reaction — it is cosmetic and never fails a run. Comments, status transitions, and label writes are unaffected.
- **Webhook auto-registration may be rejected.** Atlassian can restrict programmatic `/rest/api/3/webhook` registration to app callers and requires webhook scopes, so a scoped token may get `401`/`403`. If it does, register the webhook manually in Jira (**System → WebHooks**) pointing at `https://your-router-host/jira/webhook`.
- **`accessible-resources` is not used** to discover `cloudId` — that endpoint is OAuth 2.0 / 3LO guidance and returns `401` for scoped API tokens, so Cascade uses `/_edge/tenant_info` instead.

### Linear

1. Generate a **Personal API key** from https://linear.app/settings/api
2. (Optional) Create a webhook in your Linear workspace settings and note the signing secret

```bash
# Store Linear credentials (project-scoped)
node bin/cascade.js projects credentials-set my-project --key LINEAR_API_KEY --value lin_api_... --name "Linear API Key"

# Optional: webhook secret for signature verification
node bin/cascade.js projects credentials-set my-project --key LINEAR_WEBHOOK_SECRET --value ... --name "Linear Webhook Secret"

# Configure the integration
# teamId: your Linear team UUID (find it via Settings > API or the team URL)
# statuses: map Cascade lifecycle stages to Linear workflow state IDs
node bin/cascade.js projects integration-set my-project \
  --category pm --provider linear \
  --config '{"teamId":"TEAM_UUID","statuses":{"todo":"STATE_UUID","inProgress":"STATE_UUID","done":"STATE_UUID"},"labels":{"readyToProcess":"LABEL_UUID","processing":"LABEL_UUID"}}'
```

If you enable the alerting agent, configure the optional `alerts` PM slot as well. For Trello this is `lists.alerts`; for Jira and Linear this is `statuses.alerts`. Sentry alerts materialize into that list/status before the alerting agent runs.

### Removing an integration

To detach an integration from a project — for example, when migrating from Trello to Linear — remove the stored integration config by category:

```bash
node bin/cascade.js projects integration-delete my-project --category pm --yes
```

This removes only the integration config row; project-scoped credentials (e.g. `TRELLO_TOKEN`, `LINEAR_API_KEY`) are intentionally retained so they can be reused with a replacement integration. To remove a credential as well, use `projects credentials-delete`:

```bash
node bin/cascade.js projects credentials-delete my-project --key TRELLO_TOKEN --yes
```

---

## 9. Set Up Webhooks

Cascade needs to receive webhooks from GitHub, your PM tool, and optionally Sentry to trigger agents.

Your Cascade instance must be reachable from the internet. For local development, use a tunnel like [ngrok](https://ngrok.com/) or [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/).

Configure via the dashboard: **Projects** > select project > **Settings** > **Webhooks** tab.

Or via CLI:

```bash
# Example with ngrok
ngrok http 3000

# Create webhooks using the tunnel URL
node bin/cascade.js webhooks create my-project \
  --callback-url https://your-tunnel.ngrok.io
```

This creates webhooks on GitHub, Trello, and Jira when those integrations are configured, reusing existing hooks when the canonical callback URL already exists. Linear and Sentry are informational/manual setup paths: the dashboard and API show the correct callback URL and whether a signing secret is stored, but you create the webhook in the provider UI. For Sentry, the URL remains `https://your-router-host/sentry/webhook/:projectId`; organization-level deliveries may reach that URL, but Cascade dispatches only payloads whose Sentry project matches the configured `projectSlug`.

| Provider | Setup behavior | Callback URL |
|----------|----------------|--------------|
| GitHub | Programmatic create/list/delete with optional `GITHUB_WEBHOOK_SECRET` for HMAC-SHA256 signature verification | `https://your-router-host/github/webhook` |
| Trello | Programmatic create/list/delete | `https://your-router-host/trello/webhook` |
| Jira | Programmatic create/list/delete plus label ensure | `https://your-router-host/jira/webhook` |
| Linear | Manual setup with optional `LINEAR_WEBHOOK_SECRET` | `https://your-router-host/linear/webhook` |
| Sentry | Manual setup with optional Sentry webhook secret; paired with configured `organizationSlug`/`projectSlug` and filtered by payload project matching `projectSlug` | `https://your-router-host/sentry/webhook/my-project` |

GitHub signature verification is opt-in: set `GITHUB_WEBHOOK_SECRET` (via the dashboard's **Webhook Signing Secret** field or `cascade projects credentials-set <id> --key GITHUB_WEBHOOK_SECRET --value <secret>`) and Cascade verifies HMAC-SHA256 on every delivery; leave it unset to skip verification.

---

## 10. Configure Triggers

Triggers control which events activate which agents.

Configure via the dashboard: **Projects** > select project > **Agent Configs** tab.

Or via CLI:

```bash
# Enable implementation when a card moves to the right status
node bin/cascade.js projects trigger-set my-project \
  --agent implementation --event pm:status-changed --enable

# Enable review after CI passes (for Cascade's own PRs)
node bin/cascade.js projects trigger-set my-project \
  --agent review --event scm:check-suite-success --enable \
  --params '{"authorMode":"own"}'

# Enable respond-to-ci to auto-fix failing CI on Cascade's PRs
node bin/cascade.js projects trigger-set my-project \
  --agent respond-to-ci --event scm:check-suite-failure --enable

# Enable respond-to-review when the reviewer requests changes
node bin/cascade.js projects trigger-set my-project \
  --agent respond-to-review --event scm:pr-review-submitted --enable

# Enable alerting investigations for Sentry issue alerts
node bin/cascade.js projects trigger-set my-project \
  --agent alerting --event alerting:issue-alert --enable

# See all available triggers for an agent
node bin/cascade.js projects trigger-discover --agent implementation
```

### Map a custom workflow status

You can add columns/states beyond the built-in CASCADE stages (Backlog → Splitting → Planning → Todo → In Progress → In Review → Done → Merged) and have them dispatch any custom or built-in agent. This works for Trello, Jira, and Linear with the same wiring:

1. **Register the custom status definition** (superadmin) so the wizard offers a mapping row for it:

   ```bash
   # Dispatches the `prd` agent — the agent must declare a `pm:status-changed` trigger
   node bin/cascade.js workflow-statuses create \
     --key prd --label PRD --agent-type prd --sort-order 1000

   # Or render-only — no agent dispatches when work items land in this status
   node bin/cascade.js workflow-statuses create --key icebox --label Icebox

   node bin/cascade.js workflow-statuses list
   ```

2. **Map the custom key to a provider-native list/status** in the PM wizard's **Status Mapping** step. The wizard renders a row for every registered status (built-in + custom) and saves the mapping in the same provider-native shape:

   - **Trello** stores the list ID under `lists.prd`
   - **Jira** stores the status name under `statuses.prd`
   - **Linear** stores the workflow state UUID under `statuses.prd`

3. **Verify trigger config readiness**. Saving the wizard auto-enables `pm:status-changed` for any custom-status agent the operator just mapped. Confirm via the dashboard's **Agent Configs** tab, or:

   ```bash
   node bin/cascade.js projects trigger-list my-project
   # Look for: agent=prd event=pm:status-changed enabled=true

   # If missing, enable manually:
   node bin/cascade.js projects trigger-set my-project \
     --agent prd --event pm:status-changed --enable
   ```

A custom status only dispatches when its definition has an `agent-type` AND the project trigger config for `(agent, pm:status-changed)` is enabled. Statuses created without `--agent-type` (or updated with `--no-agent`) render in the wizard and persist in the provider config, but the trigger handlers return `null` instead of dispatching — useful for board columns CASCADE should know about but never act on.

---

## 11. Test It

1. Create a card in your PM tool (Trello/Jira/Linear) with a clear description of what code change you want
2. Move it to the status that triggers the implementation agent (or add the "Ready to Process" label)
3. Watch the dashboard — a new run should appear within seconds
4. The agent clones your repo, writes code, and opens a pull request

Check the dashboard for real-time logs, LLM call traces, and debug information.

---

## Production Deployment

### HTTPS with a Reverse Proxy

For production, put Cascade behind a reverse proxy (nginx, Caddy, Traefik) that terminates TLS:

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

### Per-Project Worker Image (Advanced)

Every agent job runs in an ephemeral **worker container**. By default that container is the global Cascade worker image (`ghcr.io/mongrel-intelligence/cascade-worker:latest` in a registry-backed deployment, or `cascade-worker:local` self-hosted). When a project needs extra toolchains in the agent's shell (a language runtime, a linter, an infra CLI, …), a **superadmin** can pin a **per-project worker image**. Leaving it unset keeps the global default — this is purely additive.

> **Superadmin-only.** Setting/clearing the worker image is restricted to superadmins (the dashboard control is hidden for everyone else, and the CLI/API return `FORBIDDEN`). Every change is recorded in the audit log.

#### 1. Derive an image from the Cascade worker base

A project worker image is **not** a bare language image — it must be built `FROM` the Cascade worker base so it carries Cascade's full runtime. The base provides the **hard** requirements (the compiled Cascade app at `/app`, `cascade-tools`, `node`, the engine CLI, `git`, a non-root writable `$HOME`, and a writable `/workspace`) plus the **soft** baseline (`python`/shim, `jq`, `rg`, `fd`, `tmux`, `ast-grep`, Playwright Chromium). Your image just layers the project's extra tools on top — pin the base to a specific tag/digest for reproducibility, and drop back to the non-root `node` user after any `root`-only steps:

```dockerfile
# Dockerfile.my-worker
FROM ghcr.io/mongrel-intelligence/cascade-worker:latest
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends <your-extra-tool> \
  && rm -rf /var/lib/apt/lists/*
USER node
```

#### 2. Make the image available to the router

The router resolves and launches the image, so it must be reachable from the **router host**. Two topologies:

- **Registry-backed** — build and push to a registry the router can pull from, then reference it by its registry path:

  ```bash
  docker build -f Dockerfile.my-worker -t registry.example.com/my-cascade-worker:1 .
  docker push registry.example.com/my-cascade-worker:1
  ```

- **Self-hosted / local** — build it on the same Docker host the router uses (derive from the local base `cascade-worker:local`); no registry needed, the router finds the local image:

  ```bash
  docker build -f Dockerfile.my-worker -t my-cascade-worker:local .
  ```

#### 3. Set it on the project and confirm `verified`

In the dashboard, open **Projects → _your project_ → Settings → General** and find the **Worker Image** card. Paste the image reference (e.g. `registry.example.com/my-cascade-worker:1` or `my-cascade-worker:local`) and click **Set**. The status updates live:

- **Verifying…** — the router pulled the image and is running its compatibility smoke-test. The card polls until it resolves.
- **Verified — pinned to `sha256:…`** — the image passed; that immutable digest is what every worker for this project now launches.
- **Validation failed: `<reason>`** — fail-closed; the reason names the missing requirement and **no job ever launches on a failed image**.

Click **Clear** to revert the project to the global default.

The same operations are available from the CLI (superadmin):

```bash
node bin/cascade.js projects update my-project --worker-image registry.example.com/my-cascade-worker:1
node bin/cascade.js projects update my-project --clear-worker-image
node bin/cascade.js projects show my-project        # shows the reference + lifecycle status
```

> **Tip:** A deliberately incompatible image (e.g. `FROM alpine`, which lacks the Cascade runtime) reaches **failed** with a reason naming the first missing requirement — a quick way to confirm the fail-closed behavior. Trigger a job after a **verified** result to see the custom toolchain available in the agent's shell.

#### Alternative: supply a Dockerfile and let Cascade build it

If you'd rather not build and host an image yourself, supply **only the extra layers** and Cascade builds the image for you on top of the pinned worker base. This is mutually exclusive with a referenced image — a project has a single effective image source, so choosing one clears the other.

> **Single-daemon constraint.** The image Cascade builds stays **local to the router that built it** — it is never pushed to a registry. A Dockerfile-sourced project must therefore be served by the **same single router daemon** that built its image. Use the referenced-image path above for multi-router / registry-backed topologies.

**1. Write the extra layers.** Provide only the `RUN` / `COPY` / `ENV` lines you want on top of the base — **do not** write your own `FROM`; Cascade prepends the pinned `FROM cascade-worker` for you (and drops back to the non-root `node` user after any `root`-only steps):

```dockerfile
# extra-layers.Dockerfile — NO `FROM`; Cascade supplies the pinned base.
RUN sudo apt-get update \
  && sudo apt-get install -y --no-install-recommends protobuf-compiler \
  && sudo rm -rf /var/lib/apt/lists/*
```

**2. Save it.** In the dashboard, open **Projects → _your project_ → Settings → General → Worker Image**, choose the **Dockerfile** source, paste the extra layers, and click **Set**. The equivalent from the CLI/API (superadmin):

```bash
node bin/cascade.js projects update my-project --dockerfile-file ./extra-layers.Dockerfile   # or "-" for stdin
node bin/cascade.js projects update my-project --clear-dockerfile          # revert to the global default
```

**3. Watch it build and verify.** The card reflects the router-side build lifecycle live (it polls while a build is in flight):

- **Building…** — the router resolved the base digest, prepended the `FROM`, and is building + smoke-testing the image.
- **Verified — pinned to `<local image id>`** — the build passed; that immutable local image is what every worker for this project now launches.
- **Failed: `<reason>`** — fail-closed; the reason names the failure (e.g. a Docker `build failed:` error, or `runtime requirement missing:` from the smoke-test) and **no job ever launches**. Fix the layers and **Set** again.

**4. Rebuild to pick up a refreshed base.** When the worker base image is updated, click **Rebuild** (or `projects update my-project --rebuild-worker-image`) to re-run the build against the current base **without editing the content**. While a rebuild runs, the project keeps launching its **last verified** image — a *failed* rebuild reads **"Verified … · last rebuild failed: `<reason>`"** (the project stays runnable), not a misleading top-level "Failed".

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
