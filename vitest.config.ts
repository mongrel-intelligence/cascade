import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Use fewer threads in CI to reduce memory pressure; use more locally for speed.
const isCI = process.env.CI === 'true' || process.env.CI === '1';

const resolve = {
	// Order matters: web-side prefixes must come before the catch-all `@`.
	alias: [
		{
			find: /^@\/components\/(.*)/,
			replacement: path.resolve(__dirname, './web/src/components/$1'),
		},
		{ find: /^@\/lib\/(.*)/, replacement: path.resolve(__dirname, './web/src/lib/$1') },
		{ find: /^@\/hooks\/(.*)/, replacement: path.resolve(__dirname, './web/src/hooks/$1') },
		// Dedupe @trpc/client to a single copy. The web workspace has its own
		// node_modules/@trpc/client, so without this a web/src file and a test
		// file resolve different TRPCClientError classes and `instanceof` (used
		// by isTRPCClientError) fails across copies. Mirrors the react/react-dom
		// dedupe below. Must precede the catch-all `@` alias.
		{ find: /^@trpc\/client$/, replacement: path.resolve(__dirname, 'node_modules/@trpc/client') },
		// Dedupe @tanstack/react-query to the single (web-workspace) copy. It only
		// exists under web/node_modules, so a `vi.mock('@tanstack/react-query')`
		// resolved from a tests/ file would otherwise miss the component's
		// web-resolved import — the real `useQueryClient` then runs against a
		// second React copy and throws `Cannot read properties of null (useContext)`.
		// Pinning the specifier lets the mock apply to both. Mirrors the @trpc/client
		// dedupe above. Must precede the catch-all `@` alias.
		{
			find: /^@tanstack\/react-query$/,
			replacement: path.resolve(__dirname, 'web/node_modules/@tanstack/react-query'),
		},
		{ find: '@', replacement: path.resolve(__dirname, './src') },
		{ find: 'react', replacement: path.resolve(__dirname, 'node_modules/react') },
		{ find: 'react-dom', replacement: path.resolve(__dirname, 'node_modules/react-dom') },
	],
};

// Shared settings inherited by every unit project
const sharedTest = {
	globals: true,
	environment: 'node' as const,
	clearMocks: true,
	unstubEnvs: true,
	setupFiles: ['./tests/setup.ts'],

	// hookTimeout bumped from the 10s default — several manifest tests do
	// dynamic-import in `beforeAll` (~2.3s isolated, but well over 10s under
	// the parallel-fork CPU pressure of the full pre-push run). Matches the
	// integration project's 30s. testTimeout left at the 5s default — that's
	// per-test logic, not module-load.
	hookTimeout: 30_000,

	// ── Dependency resolution ─────────────────────────────────────────────────
	// Explicit moduleDirectories reduces file-system traversal during collect.
	// Cache note: in CI, cache node_modules/.vitest between runs for speed.
	deps: {
		moduleDirectories: ['node_modules'],
	},

	// ── Fork pool settings ───────────────────────────────────────────────────
	// maxForks: 4 in CI (lower memory pressure), 8 locally (12 CPUs available)
	// minForks: 2 avoids cold-start overhead on worker spin-up
	pool: 'forks' as const,
	poolOptions: {
		forks: {
			maxForks: isCI ? 4 : 8,
			minForks: 2,
		},
	},
};

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		clearMocks: true,
		unstubEnvs: true,

		coverage: {
			provider: 'v8',
			reporter: ['text', 'lcov', 'html'],
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.test.ts', 'src/types/**', 'src/index.ts'],
			thresholds: {
				lines: 80,
				functions: 80,
				branches: 75,
				statements: 80,
			},
		},

		// ── Workspace projects (Vitest v3 preferred API) ──────────────────────
		// Split unit tests into 4 domain projects to reduce per-worker module
		// graph size and parallelize the collect phase.
		projects: [
			// ── Unit: Triggers ──────────────────────────────────────────────
			// ~37 files — heaviest mocks, many files mock trigger-check.js
			{
				test: {
					name: 'unit-triggers',
					include: ['tests/unit/triggers/**/*.test.ts'],
					...sharedTest,
				},
				resolve,
			},

			// ── Unit: Backends ──────────────────────────────────────────────
			// ~25 files — complex mock setups (adapter.test.ts has 18 vi.mock calls)
			{
				test: {
					name: 'unit-backends',
					include: ['tests/unit/backends/**/*.test.ts'],
					...sharedTest,
				},
				resolve,
			},

			// ── Unit: API / Router ──────────────────────────────────────────
			// ~50 files — API and router tests
			{
				test: {
					name: 'unit-api',
					include: ['tests/unit/api/**/*.test.ts', 'tests/unit/router/**/*.test.ts'],
					...sharedTest,
				},
				resolve,
			},

			// ── Unit: Core ──────────────────────────────────────────────────
			// ~159 files — agents, gadgets, config, db, utils, cli, pm, github,
			// jira, trello, web, webhook, queue, and top-level unit tests.
			// isolate: false skips per-file module re-evaluation, reducing the
			// collect phase overhead. Safe here because these tests use simple
			// mocks with no inter-test shared state. Files that use
			// vi.useFakeTimers() all call vi.useRealTimers() in afterEach/afterAll.
			{
				test: {
					name: 'unit-core',
					include: [
						'tests/unit/agents/**/*.test.ts',
						'tests/unit/gadgets/**/*.test.ts',
						'tests/unit/config/**/*.test.ts',
						'tests/unit/db/**/*.test.ts',
						'tests/unit/friction/**/*.test.ts',
						'tests/unit/utils/**/*.test.ts',
						'tests/unit/cli/**/*.test.ts',
						'tests/unit/pm/**/*.test.ts',
						'tests/unit/integrations/**/*.test.ts',
						'tests/unit/github/**/*.test.ts',
						'tests/unit/gitlab/**/*.test.ts',
						'tests/unit/jira/**/*.test.ts',
						'tests/unit/linear/**/*.test.ts',
						'tests/unit/trello/**/*.test.ts',
						'tests/unit/web/**/*.test.ts',
						'tests/unit/webhook/**/*.test.ts',
						'tests/unit/queue/**/*.test.ts',
						'tests/unit/integration-helpers/**/*.test.ts',
						'tests/unit/tools/**/*.test.ts',
						'tests/unit/openrouter/**/*.test.ts',
						'tests/unit/sentry/**/*.test.ts',
						'tests/unit/docker/**/*.test.ts',
						'tests/unit/*.test.ts',
					],
					...sharedTest,
					isolate: false,
				},
				resolve,
			},

			// ── Integration ─────────────────────────────────────────────────
			// Kept on forks + singleFork (requires real DB, no parallel workers)
			{
				test: {
					name: 'integration',
					include: ['tests/integration/**/*.test.ts'],
					setupFiles: ['./tests/integration/setup.ts'],
					globals: true,
					environment: 'node',
					clearMocks: true,
					unstubEnvs: true,
					testTimeout: 30_000,
					hookTimeout: 30_000,
					pool: 'forks',
					poolOptions: { forks: { singleFork: true } },
					deps: {
						moduleDirectories: ['node_modules'],
					},
				},
				resolve,
			},
		],
	},
	resolve,
});
