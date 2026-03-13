# Contributing to CASCADE

Thank you for your interest in contributing to CASCADE! This guide will help you get started.

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

3. **Configure environment**: Copy `.env.example` to `.env` and fill in the required values. See [GETTING_STARTED.md](./GETTING_STARTED.md) for detailed setup instructions.

4. **Set up the database**:
   ```bash
   npm run db:migrate
   ```

5. **Start Redis** (required for the router):
   ```bash
   # macOS
   brew install redis && brew services start redis
   # Or use the setup script
   .cascade/setup.sh
   ```

6. **Run the development servers**:
   ```bash
   npm run dev          # Router (webhook receiver)
   npm run dev:web      # Dashboard frontend (separate terminal)
   ```

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
   npm run lint
   npm run typecheck
   npm test
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

1. Create the agent in `src/agents/`
2. Define its system prompt in `src/agents/prompts/`
3. Register it in the agent registry

## Getting Help

- Open an [issue](https://github.com/zbigniewsobiecki/cascade/issues) for bugs or feature requests
- Check existing issues and discussions before creating new ones
