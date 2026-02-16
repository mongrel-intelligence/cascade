import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	schema: [
		'./src/db/schema/organizations.ts',
		'./src/db/schema/credentials.ts',
		'./src/db/schema/defaults.ts',
		'./src/db/schema/projects.ts',
		'./src/db/schema/runs.ts',
		'./src/db/schema/secrets.ts',
	],
	out: './src/db/migrations',
	dialect: 'postgresql',
	dbCredentials: {
		url: process.env.DATABASE_URL ?? '',
	},
});
