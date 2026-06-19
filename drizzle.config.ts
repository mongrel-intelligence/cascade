import { defineConfig } from 'drizzle-kit';
// Shared SSL resolver so migrations connect identically to the runtime client.
// Lets `DATABASE_SSL=no-verify` work against managed Postgres with self-signed
// certs (e.g. Supabase's pooler), which strict verification would reject.
import { resolveDbSslConfig } from './src/db/ssl-config';

export default defineConfig({
	schema: [
		'./src/db/schema/organizations.ts',
		'./src/db/schema/credentials.ts',
		'./src/db/schema/defaults.ts',
		'./src/db/schema/projects.ts',
		'./src/db/schema/agentConfigs.ts',
		'./src/db/schema/integrations.ts',
		'./src/db/schema/runs.ts',
		'./src/db/schema/promptPartials.ts',
	],
	out: './src/db/migrations',
	dialect: 'postgresql',
	dbCredentials: {
		url: process.env.DATABASE_URL ?? '',
		ssl: resolveDbSslConfig(),
	},
});
