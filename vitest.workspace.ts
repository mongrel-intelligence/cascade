/**
 * Workspace project definitions for CASCADE unit tests.
 *
 * NOTE: As of Vitest v3, the `--workspace` flag is deprecated. The project
 * definitions below are now embedded directly in `vitest.config.ts` via the
 * `test.projects` field (the v3-preferred API). This file is kept for
 * documentation purposes — see `vitest.config.ts` for the authoritative config.
 *
 * Domain split rationale:
 *   - unit-triggers  (~37 files): heaviest mocks, many files mock trigger-check.js
 *   - unit-backends  (~25 files): complex setups (adapter.test.ts has 18 vi.mock calls)
 *   - unit-api       (~50 files): API + router tests
 *   - unit-core     (~159 files): agents, gadgets, config, db, utils, cli, pm,
 *                                 github, jira, trello, web, webhook, queue
 *
 * Pool choice: unit projects use `forks` (child_process.fork) because some tests
 * call process.chdir(), which is unsupported in worker threads. The pool is sized
 * env-aware: maxForks:4 in CI (lower memory), maxForks:8 locally (12 CPUs).
 */
export const unitProjects = ['unit-triggers', 'unit-backends', 'unit-api', 'unit-core'] as const;

export type UnitProject = (typeof unitProjects)[number];
