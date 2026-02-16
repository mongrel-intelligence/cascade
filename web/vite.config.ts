import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [react(), tailwindcss()],
	server: {
		port: 5173,
		proxy: {
			'/trpc': 'http://localhost:3000',
			'/api': 'http://localhost:3000',
		},
	},
	build: {
		outDir: '../dist/web',
		emptyOutDir: true,
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
		},
	},
});
