# The `.cascade/` Directory

Every repository that CASCADE works on can include a `.cascade/` directory at its root. This directory is how you tell CASCADE how to set up the project, how to lint/typecheck after edits, and how to run tests.

None of these files are required — CASCADE works without them — but they give you precise control over what runs in the agent's environment.

---

## Files at a Glance

| File | Created by | Purpose |
|------|-----------|---------|
| [`setup.sh`](#-setupsh) | You | Install deps, run migrations, prepare the workspace |
| [`on-file-edit.sh`](#-on-file-editsh) | You | Post-edit hook — lint/typecheck a single file |
| [`on-verify.sh`](#-on-verifysh) | You | Verification suite — run tests or a broader check |
| [`env`](#-env) | You | Extra environment variables for the agent session |
| [`context/`](#-context) | CASCADE | Temporary context files (auto-created and cleaned up) |

---

## 🔧 `setup.sh`

**When it runs:** Once, after the repository is cloned and before the agent starts working.

**What it does:** Installs dependencies, runs database migrations, compiles assets — anything the project needs to be in a runnable state for the agent.

**Environment variables available:**

| Variable | Value | Description |
|----------|-------|-------------|
| `AGENT_PROFILE_NAME` | e.g. `implementation` | The agent type that triggered this run |

**Exit codes:** A non-zero exit is logged as a warning but does **not** abort the agent run. Make your setup script idempotent so it can safely run more than once.

**Example:**

```bash
#!/usr/bin/env bash
set -e

echo "Setting up for agent: $AGENT_PROFILE_NAME"

# Install dependencies
npm ci

# Run database migrations (skip for review-only agents)
if [ "$AGENT_PROFILE_NAME" != "review" ]; then
  npm run db:migrate
fi
```

---

## ✏️ `on-file-edit.sh`

**When it runs:** After every file edit by the agent (via the `FileSearchAndReplace`, `WriteFile`, `FileMultiEdit`, etc. gadgets).

**What it does:** Runs a fast per-file lint or typecheck. When this hook is present it **replaces** CASCADE's built-in diagnostics for that file.

**Arguments:**

| `$1` | The absolute path of the file that was just edited |
|------|----------------------------------------------------|

**Exit codes:**
- `0` — No issues; agent continues normally
- Non-zero — Issues found; the output is shown to the agent so it can self-correct

**Tips:**
- Keep this **fast** (< 5 s) — it runs on every single edit
- Target only the edited file, not the whole project
- If your linter doesn't support single-file mode, scope it with `--include` or `--files-from`

**Example:**

```bash
#!/usr/bin/env bash
# Lint and typecheck the edited file
FILE="$1"

case "$FILE" in
  *.ts|*.tsx)
    npx tsc --noEmit --skipLibCheck 2>&1 | grep "$FILE" || true
    npx biome check "$FILE" --no-errors-on-unmatched
    ;;
  *.js)
    npx biome check "$FILE" --no-errors-on-unmatched
    ;;
esac
```

---

## ✅ `on-verify.sh`

**When it runs:** When the agent calls `VerifyChanges` with `scope=tests` or `scope=full`.

**What it does:** Runs your project's test suite (or a subset of it). This is the agent's way of confirming that all changes work end-to-end before opening a pull request.

**Arguments:**

| `$1` | Scope: `diagnostics`, `tests`, or `full` |
|------|------------------------------------------|

**Exit codes:**
- `0` — All tests pass
- Non-zero — Failures; the full output is shown to the agent so it can diagnose and fix

**Tips:**
- Run the minimal set of tests relevant to the change — not the entire suite if it takes 10+ minutes
- Use `$1` to choose between a fast smoke test (`tests`) and a thorough check (`full`)
- You can skip tests for the `diagnostics` scope since CASCADE handles that separately

**Example:**

```bash
#!/usr/bin/env bash
set -e

SCOPE="$1"

case "$SCOPE" in
  diagnostics)
    # Nothing — CASCADE runs tsc + biome itself
    ;;
  tests)
    # Fast unit tests only
    npm test -- --run
    ;;
  full)
    # Full suite including integration tests
    npm run test:all
    ;;
esac
```

---

## 🌐 `env`

**When it is loaded:** At the start of each agent session, before setup and before the agent runs.

**What it does:** Supplies extra environment variables to the agent process — useful for feature flags, test database URLs, or any project-specific knobs.

**Format:** Plain `KEY=VALUE` pairs, one per line. Lines starting with `#` are comments.

```
# .cascade/env
NODE_ENV=test
TEST_DATABASE_URL=postgresql://localhost:5432/myapp_test
FEATURE_FLAGS=new-parser,strict-validation
```

**Protected keys:** The following keys are always skipped, even if present in `.cascade/env`, to prevent override of CASCADE's own credentials and infrastructure settings:

```
TRELLO_API_KEY, TRELLO_TOKEN, GITHUB_TOKEN,
OPENROUTER_API_KEY, CASCADE_WORKSPACE_DIR,
CASCADE_LOCAL_MODE, CASCADE_INTERACTIVE, CONFIG_PATH,
PORT, LOG_LEVEL, LLMIST_LOG_FILE, LLMIST_LOG_TEE,
REDIS_URL, DATABASE_URL, DATABASE_SSL, CREDENTIAL_MASTER_KEY,
JOB_ID, JOB_TYPE, JOB_DATA
```

**Scope:** Variables are loaded for the duration of the agent session and removed when the session ends. They do **not** persist between runs.

---

## 📁 `context/`

**Created by:** CASCADE automatically (when context offloading is enabled).

**What it does:** When a context injection (PR diff, card description, etc.) is too large to embed inline in the agent's prompt, CASCADE writes it to a file under `.cascade/context/` and tells the agent to read it on demand.

**Lifecycle:**
1. Created before the agent starts
2. Used by the agent via its built-in `Read` tool
3. Cleaned up automatically when the agent finishes

**You should:** Add `.cascade/context/` to your `.gitignore` so these temporary files are never accidentally committed:

```gitignore
# CASCADE context files (temporary, managed by CASCADE)
.cascade/context/
```

---

## Best Practices

### Make `setup.sh` idempotent

The setup script may run multiple times (e.g., retries). Use `npm ci` instead of `npm install`, check if migrations are already applied, and avoid side effects that break on re-run.

### Keep hooks fast

`on-file-edit.sh` runs after **every** file edit. Even a 5-second hook adds up across dozens of edits. Profile it and cut anything slow.

### Use `AGENT_PROFILE_NAME` for conditional logic

Different agents have different needs. The review agent doesn't need migrations; the implementation agent does. Branch on `$AGENT_PROFILE_NAME` in `setup.sh` to keep setup lean:

```bash
if [[ "$AGENT_PROFILE_NAME" == "implementation" || "$AGENT_PROFILE_NAME" == "respond-to-review" ]]; then
  npm run db:migrate
fi
```

### Don't store secrets in `.cascade/env`

The `env` file is committed to your repository. Keep secrets in CASCADE's credential store (via the dashboard or CLI) — not in `.cascade/env`. Use `.cascade/env` only for non-sensitive config like database names, feature flags, and test URLs.

### Add `.cascade/context/` to `.gitignore`

The `context/` subdirectory is managed entirely by CASCADE. There is nothing useful to commit there, and its contents can be large. Add it to `.gitignore` to keep your repository clean.
