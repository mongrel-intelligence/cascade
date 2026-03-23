# Tests

This directory contains all unit and integration tests for CASCADE.

## Table of Contents

- [Project Structure](#project-structure)
- [Running Tests](#running-tests)
- [Factory Catalog](#factory-catalog)
- [Mock Catalog](#mock-catalog)
- [tRPC Test Harness](#trpc-test-harness)
- [DB Mock Helper](#db-mock-helper)
- [PM Provider Mock](#pm-provider-mock)
- [Conventions](#conventions)
- [Adding New Shared Mocks](#adding-new-shared-mocks)

---

## Project Structure

Tests are split into **4 unit projects** (run in parallel) plus **1 integration project** (run serially against a real database). This split reduces per-worker module graph size and parallelises the collect phase.

| Project | Include Pattern | Notes |
|---|---|---|
| `unit-triggers` | `tests/unit/triggers/**` | ~37 files, heavily mocked trigger tests |
| `unit-backends` | `tests/unit/backends/**` | ~25 files, complex adapter mocks |
| `unit-api` | `tests/unit/api/**`, `tests/unit/router/**` | ~50 files, tRPC router tests |
| `unit-core` | All other `tests/unit/**` | ~159 files; `isolate: false` for speed |
| `integration` | `tests/integration/**` | Requires real PostgreSQL; runs serially |

Shared test helpers live in `tests/helpers/`:

```
tests/helpers/
├── factories.ts          # Domain-object factory functions
├── sharedMocks.ts        # Shared mock module objects (trigger/API tests)
├── backendMocks.ts       # Shared mock module objects (backend/gadget tests)
├── trpcTestHarness.ts    # tRPC caller factory + ownership mock + error assertion
├── mockDb.ts             # Drizzle query-chain mock builder
├── mockPMProvider.ts     # PMProvider stub factory
└── mockPersonas.ts       # GitHub bot-identity stub helpers
```

---

## Running Tests

```bash
npm test                 # Run unit tests (all 4 unit projects)
npm run test:unit        # Alias for npm test
npm run test:integration # Run integration tests (requires DB)
npm run test:all         # Run unit + integration tests together
npm run test:coverage    # Coverage report (unit tests only)
npm run test:watch       # Watch mode (unit tests)
```

> **Do not use `npm test -- --project integration`** — it _adds_ the integration project on top
> of the hardcoded unit project flags, running all 5 projects instead of filtering.
> Use `npm run test:integration` instead.

To run a single file quickly:

```bash
npx vitest run tests/unit/triggers/trello/status-changed.test.ts
# Integration (requires DB):
TEST_DATABASE_URL=... npx vitest run --project integration tests/integration/<file>.test.ts
```

---

## Factory Catalog

All factory functions live in **`tests/helpers/factories.ts`**.
Each function accepts an optional `overrides` object (shallow-merged) for test-specific customisation.

### Project Factories

| Function | Returns | Description |
|---|---|---|
| `createMockProject(overrides?)` | `ProjectConfig` | Trello project config with sensible defaults (`boardId: 'board123'`, lists: splitting/planning/todo) |
| `createMockJiraProject(overrides?)` | `ProjectConfig` | JIRA project config with `projectKey: 'PROJ'` and all required label/status fields |

**Example:**

```ts
import { createMockProject, createMockJiraProject } from '../../helpers/factories.js';

const project = createMockProject({ id: 'my-project' });
const jiraProject = createMockJiraProject({ jira: { projectKey: 'ABC', baseUrl: 'https://my.atlassian.net', statuses: {}, labels: {} } });
```

### tRPC User / Context Factories

| Function | Returns | Description |
|---|---|---|
| `createMockUser(overrides?)` | `TRPCUser` | Admin user with `id: 'user-1'`, `orgId: 'org-1'`, `role: 'admin'` |
| `createMockSuperAdmin(overrides?)` | `TRPCUser` | Superadmin user with `role: 'superadmin'` |
| `createMockContext(userOverrides?)` | `TRPCContext` | tRPC context wrapping `createMockUser()` |

**Example:**

```ts
import { createMockContext, createMockUser } from '../../helpers/factories.js';

const ctx = createMockContext({ role: 'member' });
const caller = createCaller(ctx);
```

### Trigger Context Factories

| Function | Returns | Description |
|---|---|---|
| `createTriggerContext(overrides?)` | `TriggerContext` | Generic trigger context with Trello source and empty payload |
| `createTrelloTriggerContext(overrides?)` | `TriggerContext` | Trigger context pre-filled with a Trello action payload |
| `createGitHubTriggerContext(overrides?)` | `TriggerContext` | Trigger context pre-filled with a GitHub PR-opened payload |

### Trello Payload Factories

| Function | Returns | Description |
|---|---|---|
| `createTrelloActionPayload(overrides?)` | `TrelloWebhookPayload` | `{ model, action }` shape for Trello webhooks; defaults to `updateCard` moving a card to the splitting list |
| `createTrelloCard(overrides?)` | `TrelloCard` | Mock Trello card object for `trelloClient.getCard()` return values |

**Example:**

```ts
import { createTrelloActionPayload, createTrelloCard } from '../../helpers/factories.js';

const payload = createTrelloActionPayload({
  action: { data: { listAfter: { id: 'todo-list-id', name: 'Todo' } } },
});

vi.mocked(mockTrelloClientModule.trelloClient.getCard).mockResolvedValue(
  createTrelloCard({ name: 'My Feature Card' }),
);
```

### GitHub Payload Factories

| Function | Returns | Interface |
|---|---|---|
| `createMockPR(overrides?)` | `MockPR` | GitHub PR object used in webhook payloads; defaults to PR #42 on `feature/test` |
| `createCheckSuitePayload(overrides?)` | `CheckSuitePayload` | GitHub check-suite webhook payload; defaults to `conclusion: 'success'` |
| `createReviewPayload(overrides?)` | `ReviewPayload` | GitHub PR review webhook payload; defaults to `state: 'changes_requested'` |

**Example:**

```ts
import { createMockPR, createCheckSuitePayload, createReviewPayload } from '../../helpers/factories.js';

const pr = createMockPR({ draft: true, user: { login: 'cascade-implementer' } });

const checkSuite = createCheckSuitePayload({
  check_suite: { conclusion: 'failure', head_sha: 'abc', id: 1, status: 'completed', pull_requests: [] },
});

const review = createReviewPayload({ review: { state: 'approved', id: 1, body: null, html_url: '...', user: { login: 'reviewer' } } });
```

---

## Mock Catalog

Shared mock module objects live in **`tests/helpers/sharedMocks.ts`** (triggers/API) and **`tests/helpers/backendMocks.ts`** (backends/gadgets).

> **Important:** `vi.mock()` calls must remain in each test file because Vitest hoists them to the top of the file. Import the mock object from `sharedMocks.ts` / `backendMocks.ts`, then reference it inside the `vi.mock()` factory in your test file.

### sharedMocks.ts

| Export | Mocks module | Typical usage |
|---|---|---|
| `mockLogger` | `src/utils/logging.js` | Assert on `info`, `warn`, `error`, `debug` calls |
| `mockConfigProvider` | `src/config/provider.js` | Stub project lookup and credential resolution |
| `mockWithGitHubToken` | `src/github/client.js` (`withGitHubToken`) | Invokes callback directly, skipping real Octokit |
| `mockGithubClient` | `src/github/client.js` (`githubClient`) | Stub any GitHub API call (getPR, createPRReview, etc.) |
| `mockGitHubClientModule` | `src/github/client.js` (full module) | Combine `mockWithGitHubToken` + `mockGithubClient` |
| `mockTriggerCheckModule` | `src/triggers/shared/trigger-check.js` | Defaults to `checkTriggerEnabled → true` |
| `mockGetDb` | `src/db/client.js` (`getDb`) | Wire to a `createMockDb()` result per test |
| `mockDbClientModule` | `src/db/client.js` (full module) | `{ getDb: mockGetDb, closeDb: vi.fn() }` |
| `mockTrelloClientModule` | `src/trello/client.js` | Stub `withTrelloCredentials` and `trelloClient.getCard` |
| `mockJiraClientModule` | `src/jira/client.js` | Stub `withJiraCredentials` and `jiraClient` |
| `mockConfigResolverModule` | `src/triggers/config-resolver.js` | Defaults to `isTriggerEnabled → true`, `getTriggerParameters → {}` |
| `mockAcknowledgmentsModule` | `src/router/acknowledgments.js` | Stub all Trello/JIRA ack functions |
| `mockReactionsModule` | `src/router/reactions.js` | Stub `sendAcknowledgeReaction` |
| `mockSentryModule` | `src/sentry.js` | Assert on `captureException` calls |
| `mockLifecycleModule` | `src/utils/lifecycle.js` | Stub `setWatchdogCleanup` / `clearWatchdogCleanup` |

**Full example using sharedMocks:**

```ts
import { mockLogger, mockConfigProvider, mockTriggerCheckModule } from '../../helpers/sharedMocks.js';

vi.mock('../../../src/utils/logging.js', () => ({ logger: mockLogger }));
vi.mock('../../../src/config/provider.js', () => mockConfigProvider);
vi.mock('../../../src/triggers/shared/trigger-check.js', () => mockTriggerCheckModule);

// In a test:
mockConfigProvider.loadProjectConfigByBoardId.mockResolvedValue(createMockProject());
expect(mockLogger.error).toHaveBeenCalledWith('something went wrong');
```

### backendMocks.ts

| Export | Mocks module | Typical usage |
|---|---|---|
| `mockFileLoggerModule` | `src/utils/fileLogger.js` | Stub `createFileLogger`, `cleanupLogFile`, `cleanupLogDirectory` |
| `mockCascadeEnvModule` | `src/utils/cascadeEnv.js` | Stub `loadCascadeEnv` / `unloadCascadeEnv` |
| `mockRepoModule` | `src/utils/repo.js` (partial) | Stub `cleanupTempDir`, `getWorkspaceDir` (→ `/tmp/cascade-test`), `parseRepoFullName` |
| `mockSessionStateModule` | `src/gadgets/sessionState.js` | Stub sidecar env-var constants + `recordPRCreation`, `recordInitialComment`, etc. |
| `mockAgentLoggerModule` | `src/agents/utils/logging.js` | Stub `createAgentLogger` |

**Example using backendMocks:**

```ts
import { mockFileLoggerModule, mockSessionStateModule } from '../../helpers/backendMocks.js';

vi.mock('../../../src/utils/fileLogger.js', () => mockFileLoggerModule);
vi.mock('../../../src/gadgets/sessionState.js', () => mockSessionStateModule);

// In test setup:
const mockLoggerInstance = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
mockFileLoggerModule.createFileLogger.mockReturnValue(mockLoggerInstance);

// Assert on sidecar:
expect(mockSessionStateModule.recordPRCreation).toHaveBeenCalledWith('https://github.com/...');
```

---

## tRPC Test Harness

**`tests/helpers/trpcTestHarness.ts`** provides three utilities that eliminate boilerplate repeated across API router tests.

### `createCallerFor(routerInstance)`

Returns a typed caller factory for any tRPC router. Replaces the per-file:

```ts
// Before (repeated in every router test file):
function createCaller(ctx: TRPCContext) {
  return fooRouter.createCaller(ctx);
}
```

**Usage:**

```ts
import { fooRouter } from '../../../../src/api/routers/foo.js';
import { createCallerFor } from '../../../helpers/trpcTestHarness.js';
import { createMockContext } from '../../../helpers/factories.js';

const createCaller = createCallerFor(fooRouter);

it('returns the list', async () => {
  const caller = createCaller(createMockContext());
  const result = await caller.list();
  expect(result).toEqual([]);
});
```

### `setupOwnershipCheckMock()`

Returns `{ mockDbSelect, mockDbFrom, mockDbWhere, configureOwnership }` — pre-wired mocks for the Drizzle `select → from → where` ownership check chain used across API router tests.

You still need `vi.mock()` in your test file (because vi.mock calls are hoisted), but the mock implementations come from the harness:

```ts
import { setupOwnershipCheckMock, createCallerFor } from '../../../helpers/trpcTestHarness.js';

const { mockDbSelect, mockDbFrom, mockDbWhere, configureOwnership } = setupOwnershipCheckMock();

vi.mock('../../../../src/db/client.js', () => ({
  getDb: () => ({ select: mockDbSelect }),
}));

vi.mock('../../../../src/db/schema/index.js', () => ({
  projects: { id: 'id', orgId: 'org_id' },
}));

beforeEach(() => {
  mockDbSelect.mockReturnValue({ from: mockDbFrom });
  mockDbFrom.mockReturnValue({ where: mockDbWhere });
});

it('passes when project belongs to org', async () => {
  configureOwnership('org-1');
  const caller = createCaller(createMockContext({ orgId: 'org-1' }));
  const result = await caller.list({ projectId: 'proj-1' });
  expect(result).toEqual([]);
});
```

### `expectTRPCError(promise, code)`

Asserts that a tRPC procedure call rejects with a `TRPCError` of the given code. Replaces 30+ places that used `try/catch` with manual `instanceof` checks.

```ts
import { expectTRPCError } from '../../../helpers/trpcTestHarness.js';

it('throws UNAUTHORIZED when not authenticated', async () => {
  const caller = createCaller({ user: null, effectiveOrgId: null });
  await expectTRPCError(caller.list(), 'UNAUTHORIZED');
});

it('throws FORBIDDEN for non-admin', async () => {
  const caller = createCaller(createMockContext({ role: 'member' }));
  await expectTRPCError(caller.adminOnlyMethod(), 'FORBIDDEN');
});
```

Valid `TRPCErrorCode` values: `PARSE_ERROR`, `BAD_REQUEST`, `INTERNAL_SERVER_ERROR`, `NOT_IMPLEMENTED`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `METHOD_NOT_SUPPORTED`, `TIMEOUT`, `CONFLICT`, `PRECONDITION_FAILED`, `PAYLOAD_TOO_LARGE`, `UNPROCESSABLE_CONTENT`, `TOO_MANY_REQUESTS`, `CLIENT_CLOSED_REQUEST`.

---

## DB Mock Helper

**`tests/helpers/mockDb.ts`** provides `createMockDb()` and `createMockDbWithGetDb()` for mocking Drizzle query chains.

### `createMockDb(opts?)`

Builds a mock Drizzle DB that supports:

- `select().from().where()`
- `select().from().innerJoin().where()`
- `select().from().innerJoin().innerJoin().where()` (with `opts.withDoubleJoin`)
- `insert().values().returning()`
- `insert().values().onConflictDoUpdate()` (with `opts.withUpsert`)
- `update().set().where()`
- `delete().where()`
- `.limit()` terminal on selects (with `opts.withLimit`)
- Thenable chains without `.where()` terminal (with `opts.withThenable`)

Returns `{ db, chain }` where `chain` exposes individual mock functions for assertions.

```ts
import { createMockDb } from '../../helpers/mockDb.js';
import { mockGetDb } from '../../helpers/sharedMocks.js';

vi.mock('../../../src/db/client.js', () => mockDbClientModule);

beforeEach(() => {
  const { db, chain } = createMockDb({ withUpsert: true });
  mockGetDb.mockReturnValue(db);
  chain.returning.mockResolvedValue([{ id: 'row-1' }]);
});
```

### `createMockDbWithGetDb(opts?)`

Convenience wrapper that creates the mock DB and immediately wires it into `mockGetDb` from `sharedMocks.ts`. Use this to replace the common two-liner:

```ts
// Before:
const { db, chain } = createMockDb();
mockGetDb.mockReturnValue(db);

// After:
const { db, chain } = createMockDbWithGetDb();
```

Accepts the same `opts` as `createMockDb()`.

---

## PM Provider Mock

**`tests/helpers/mockPMProvider.ts`** exports `createMockPMProvider()`, which returns a fully-stubbed PMProvider object (Trello type by default).

```ts
import { createMockPMProvider } from '../../helpers/mockPMProvider.js';

const mockProvider = createMockPMProvider();

vi.mock('../../src/pm/index.js', () => ({
  getPMProvider: vi.fn(() => mockProvider),
}));

// Override per test:
mockProvider.getWorkItem.mockResolvedValue({
  id: 'card1',
  title: 'My Card',
  description: 'Details',
  url: 'https://trello.com/c/abc',
  inlineMedia: [{ url: 'https://...', mimeType: 'image/png', source: 'description' }],
});
```

All PMProvider methods are stubbed: `getWorkItem`, `getChecklists`, `getAttachments`, `getWorkItemComments`, `updateWorkItem`, `addComment` (→ resolves `''`), `updateComment`, `createWorkItem`, `listWorkItems`, `moveWorkItem`, `addLabel`, `removeLabel`, `createChecklist`, `addChecklistItem`, `updateChecklistItem`, `deleteChecklistItem`, `addAttachment`, `addAttachmentFile`, `linkPR` (→ resolves `undefined`), `getCustomFieldNumber`, `updateCustomFieldNumber`, `getWorkItemUrl`, `getAuthenticatedUser`.

---

## Conventions

### `vi.mock()` must stay in test files (hoisting)

Vitest hoists `vi.mock()` calls to the top of the file before any imports are evaluated. This means you **cannot** move `vi.mock()` into a helper function or shared setup file — the call must appear at the top level of each test file that needs it.

```ts
// ✅ Correct — top-level in test file, imports mock objects from helpers
import { mockLogger } from '../../helpers/sharedMocks.js';
vi.mock('../../../src/utils/logging.js', () => ({ logger: mockLogger }));

// ❌ Wrong — inside a function (won't be hoisted)
function setup() {
  vi.mock('../../../src/utils/logging.js', () => ({ logger: mockLogger }));
}
```

### Prefer `vi.hoisted()` over wrapper functions

When you need a mock function that is both declared before `vi.mock()` runs and referenced inside the mock factory, use `vi.hoisted()`:

```ts
// ✅ Preferred — vi.hoisted() runs before vi.mock() factories
const { mockListRuns } = vi.hoisted(() => ({
  mockListRuns: vi.fn(),
}));

vi.mock('../../../../src/db/repositories/runsRepository.js', () => ({
  listRuns: mockListRuns,   // direct reference — call tracking works
}));

// ❌ Anti-pattern — anonymous wrapper loses call tracking on the inner mock
vi.mock('../../../../src/db/repositories/runsRepository.js', () => ({
  listRuns: (...args: unknown[]) => mockListRuns(...args),
  //         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  //         toHaveBeenCalledWith() won't work on this wrapper
}));
```

`vi.hoisted()` is the idiomatic Vitest approach and avoids the `(...args) => mockFn(...args)` indirection entirely.

### `clearMocks: true` — automatic mock reset between tests

All unit projects use `clearMocks: true` (set in `vitest.config.ts`). This automatically resets mock call counts and return values between each test. You do **not** need to call `vi.clearAllMocks()` in `afterEach`.

If a mock needs a specific return value, configure it in a `beforeEach` or at the start of the `it()` block.

### `isolate: false` in unit-core — no module re-evaluation

The `unit-core` project uses `isolate: false` to skip per-file module re-evaluation, which reduces the collect phase overhead for its ~159 test files.

**Safe because:** these tests use simple mocks with no inter-test shared state.

**Watch out for:** tests that use `vi.useFakeTimers()` must call `vi.useRealTimers()` in `afterEach` or `afterAll` to avoid timer leakage across test files in the same worker.

---

## Adding New Shared Mocks

Follow this checklist to decide when to extract a mock to a shared helper vs. keeping it inline:

- [ ] **3+ test files** mock the same module in the same way → extract to `sharedMocks.ts` or `backendMocks.ts`
- [ ] **Trigger/API tests** → add to `sharedMocks.ts`
- [ ] **Backend/gadget tests** → add to `backendMocks.ts`
- [ ] **New factory function** (domain object) → add to `factories.ts`
- [ ] The mock is non-trivial (has multiple methods, default return values, or type constraints) → shared is better than inline
- [ ] Add JSDoc comment with a `vi.mock()` usage example to the new export
- [ ] Announce the new export in this README under the appropriate catalog table
