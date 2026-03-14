/**
 * Create an admin user for the CASCADE dashboard.
 *
 * Usage (local, with tsx):
 *   node --env-file=.env --import tsx tools/create-admin-user.ts \
 *     --email admin@example.com --password changeme --name "Admin"
 *
 * Inside Docker:
 *   docker compose exec dashboard node dist/tools/create-admin-user.mjs \
 *     --email admin@example.com --password changeme --name "Admin"
 */

import bcrypt from 'bcrypt';
import { closeDb, getDb } from '../src/db/client.js';
import { users } from '../src/db/schema/index.js';

function parseArgs(argv: string[]): { email: string; password: string; name: string } {
	let email = '';
	let password = '';
	let name = '';

	for (let i = 2; i < argv.length; i++) {
		if (argv[i] === '--email' && argv[i + 1]) {
			email = argv[++i];
		} else if (argv[i] === '--password' && argv[i + 1]) {
			password = argv[++i];
		} else if (argv[i] === '--name' && argv[i + 1]) {
			name = argv[++i];
		}
	}

	if (!email || !password || !name) {
		console.error('Usage: create-admin-user --email <email> --password <password> --name <name>');
		process.exit(1);
	}

	return { email, password, name };
}

async function main(): Promise<void> {
	const { email, password, name } = parseArgs(process.argv);

	const db = getDb();
	const passwordHash = await bcrypt.hash(password, 10);

	await db
		.insert(users)
		.values({
			orgId: 'default',
			email,
			passwordHash,
			name,
			role: 'superadmin',
		})
		.onConflictDoUpdate({
			target: users.email,
			set: { passwordHash, name, role: 'superadmin' },
		});

	const port = process.env.DASHBOARD_PORT || process.env.PORT || '3001';
	const line = '='.repeat(58);
	console.log(`
${line}
  CASCADE — Admin user ready!
${line}

  Email:     ${email}
  Role:      superadmin

  Next steps:

  1. Open the dashboard:
     http://localhost:${port}

  2. Log in with the credentials above

  3. Create your first project and add credentials
     via the dashboard UI

${line}`);

	await closeDb();
}

main().catch(async (err) => {
	console.error('Failed to create user:', String(err));
	await closeDb();
	process.exit(1);
});
