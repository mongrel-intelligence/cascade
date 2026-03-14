import path from 'node:path';
import { defineProject } from 'vitest/config';

export default defineProject({
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
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
			react: path.resolve(__dirname, 'node_modules/react'),
			'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
		},
	},
});
