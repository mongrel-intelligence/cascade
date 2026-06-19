import { defineConfig } from 'drizzle-kit';
// drizzle-kit connects via the `url` below and IGNORES a `dbCredentials.ssl` object
// when a `url` is set, so the SSL intent must be encoded in the connection string as
// `sslmode`. `applyDbSslModeToUrl` derives it from DATABASE_SSL (shared with the runtime
// client's resolver), letting `DATABASE_SSL=no-verify` work against managed Postgres with
// self-signed certs (e.g. Supabase's pooler), which strict verification would reject.
import { applyDbSslModeToUrl } from './src/db/ssl-config';

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
		url: applyDbSslModeToUrl(process.env.DATABASE_URL ?? ''),
	},
});
