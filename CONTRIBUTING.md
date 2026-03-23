# Contributing to Cascade

Thank you for your interest in contributing to Cascade! This guide will help you get started.

## Prerequisites

- **Node.js** 22+ (see `engines` in `package.json`)
- **PostgreSQL** 16+ (we recommend [Supabase](https://supabase.com/) for hosted, or Docker for local)
- **Redis** (for BullMQ job queue)
- **Docker** (optional, for integration tests and container builds)

## Development Setup

1. **Fork and clone** the repository:
   ```bash
   git clone https://github.com/<your-username>/cascade.git
   cd cascade
   ```

2. **Install dependencies**:
   ```bash
   npm install
   cd web && npm install && cd ..
   ```

3. **Configure environment**: Copy `.env.example` to `.env` and fill in the required values. See [Getting Started](./docs/getting-started.md) for detailed setup instructions.

4. **Set up the database**:
   ```bash
   npm run db:migrate
   ```

5. **Build the project**:
   ```bash
   npm run build
   ```

6. **Start Redis** (required for the router):
   ```bash
   # macOS
   brew install redis && brew services start redis
   # Or use the setup script
   .cascade/setup.sh
   ```

7. **Run the development servers**:

   Start all services in one terminal:
   ```bash
   npm run dev:all      # Router + Dashboard API + Frontend (color-coded output)
   ```

   Or start each service in a separate terminal:
   ```bash
   npm run dev                                           # Router (:3000)
   node --env-file=.env dist/dashboard.js               # Dashboard API (:3001)
   npm run dev:web                                       # Frontend (Vite, :5173)
   ```

   > **Note:** The Dashboard API must be running for the frontend to show data. The Vite dev server proxies `/trpc` and `/api` to `localhost:3001`.

## Running Tests

```bash
npm test                 # Unit tests
npm run test:integration # Integration tests (requires PostgreSQL)
npm run test:coverage    # Unit tests with coverage
npm run test:watch       # Watch mode
```

For integration tests, start the test database first:

```bash
npm run test:db:up       # Start PostgreSQL in Docker
npm run test:integration
npm run test:db:down     # Clean up
```

## Code Style

- **Linter**: [Biome](https://biomejs.dev/) — run `npm run lint` to check, `npm run lint:fix` to auto-fix
- **Type checking**: TypeScript strict mode — run `npm run typecheck`
- **No `any`**: Use proper types. If you must escape the type system, add a comment explaining why.

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(triggers): add JIRA webhook support
fix(worker): prevent duplicate job processing
docs: update self-hosting guide
refactor(agents): extract shared prompt builder
```

This is enforced by commitlint via lefthook pre-commit hooks.

## Pull Request Workflow

1. **Create a feature branch** from `dev`:
   ```bash
   git checkout dev
   git pull origin dev
   git checkout -b feature/my-change
   ```

2. **Make your changes** with clear, focused commits.

3. **Ensure all checks pass**:
   ```bash
   npm run verify   # runs lint + typecheck + unit tests in one command
   ```

4. **Open a PR** targeting the `dev` branch. PRs to `main` must come from `dev` (enforced by CI).

5. **Fill in the PR template** — describe what changed, why, and how to test it.

## Project Structure

See [CLAUDE.md](./CLAUDE.md) for a detailed architecture overview. Key directories:

- `src/router/` — Webhook receiver (enqueues jobs to Redis)
- `src/triggers/` — Event handlers (Trello, GitHub, JIRA)
- `src/agents/` — AI agent implementations
- `src/gadgets/` — Tools agents can use
- `src/api/` — Dashboard API (tRPC)
- `web/` — Dashboard frontend (React 19, Vite, Tailwind v4)

## Adding New Triggers

1. Create a trigger handler in `src/triggers/`
2. Implement the `TriggerHandler` interface
3. Register it in `src/triggers/index.ts`

## Adding New Agents

Agents are defined using YAML definition files. Built-in definitions live in `src/agents/definitions/`.

1. **Write a YAML definition** — model your file on an existing one in `src/agents/definitions/` (e.g. `implementation.yaml`)
2. **Import the definition**:
   ```bash
   cascade definitions import --file my-agent.yaml
   ```
   Or use the **Agent Definitions** tab in the dashboard.
3. **Create an `agent_configs` row** to enable the agent for a project:
   ```bash
   cascade agents create --agent-type my-agent --project-id <project-id>
   ```
4. **Discover available triggers** for the new agent type:
   ```bash
   cascade projects trigger-discover --agent my-agent   # see available events
   ```

5. **Configure triggers** — enable the events that should activate the agent:
   ```bash
   cascade projects trigger-set <project-id> --agent my-agent --event pm:status-changed --enable
   ```

## The `.cascade/` Directory

When Cascade works on a repository, it looks for a `.cascade/` directory at the root of that repo. This directory lets you customize agent behavior — setup scripts, post-edit hooks, test runners, and environment variables.

See **[`.cascade/` Directory Guide](./docs/cascade-directory.md)** for the full reference.

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `Cannot connect to Redis` | Redis not running | `redis-server` or `brew services start redis` |
| `ECONNREFUSED 5432` | PostgreSQL not running | `pg_ctl start` or start Docker |
| `dist/ not found` when running CLI | Build needed | `npm run build` |
| Frontend shows no data | Dashboard API not running | `node --env-file=.env dist/dashboard.js` |
| Node version error | Node < 22 | Install Node 22+ (`nvm use 22`) |
| Integration tests silently skip | No test database | `npm run test:db:up` first |
| `commitlint` hook fails | Non-conventional commit message | Use format `feat(scope): description` |

## Getting Help

- Open an [issue](https://github.com/mongrel-intelligence/cascade/issues) for bugs or feature requests
- Check existing issues and discussions before creating new ones
