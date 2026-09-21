/**
 * Budgets for tests that spawn the built `cascade-tools` CLI. A cold oclif boot takes 2-5 s
 * and more under full-suite CPU pressure, far past vitest's 5 s default. The test budget
 * stays strictly above the spawn budget so a hung CLI fails on the spawn's captured stderr,
 * not on an opaque vitest timeout.
 */
export const CLI_SPAWN_TIMEOUT_MS = 30_000;
export const CLI_TEST_TIMEOUT_MS = CLI_SPAWN_TIMEOUT_MS + 5_000;
