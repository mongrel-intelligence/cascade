import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
	{
		extends: './vitest.config.ts',
		test: {
			name: 'unit',
			include: ['tests/unit/**/*.test.ts'],
			setupFiles: ['./tests/setup.ts'],
		},
	},
	{
		extends: './vitest.config.ts',
		test: {
			name: 'integration',
			include: ['tests/integration/**/*.test.ts'],
			setupFiles: ['./tests/integration/setup.ts'],
			testTimeout: 30_000,
			hookTimeout: 30_000,
			pool: 'forks',
			poolOptions: { forks: { singleFork: true } },
		},
	},
]);
