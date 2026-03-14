import path from 'node:path';
import { defineProject } from 'vitest/config';

export default defineProject({
	test: {
		name: 'unit',
		include: ['tests/unit/**/*.test.ts'],
		setupFiles: ['./tests/setup.ts'],
		globals: true,
		environment: 'node',
		clearMocks: true,
		unstubEnvs: true,
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
			react: path.resolve(__dirname, 'node_modules/react'),
			'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
		},
	},
});
