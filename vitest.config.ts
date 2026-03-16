import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Use fewer threads in CI to reduce memory pressure; use more locally for speed.
const isCI = process.env.CI === 'true' || process.env.CI === '1';

const resolve = {
	alias: {
		'@': path.resolve(__dirname, './src'),
		react: path.resolve(__dirname, 'node_modules/react'),
		'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
	},
};

// Shared settings inherited by every unit project
const sharedTest = {
	globals: true,
	environment: 'node' as const,
	clearMocks: true,
	unstubEnvs: true,
	setupFiles: ['./tests/setup.ts'],

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
						'tests/unit/utils/**/*.test.ts',
						'tests/unit/cli/**/*.test.ts',
						'tests/unit/pm/**/*.test.ts',
						'tests/unit/github/**/*.test.ts',
						'tests/unit/jira/**/*.test.ts',
						'tests/unit/trello/**/*.test.ts',
						'tests/unit/web/**/*.test.ts',
						'tests/unit/webhook/**/*.test.ts',
						'tests/unit/queue/**/*.test.ts',
						'tests/unit/integration-helpers/**/*.test.ts',
						'tests/unit/tools/**/*.test.ts',
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
