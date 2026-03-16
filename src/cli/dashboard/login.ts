import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { saveConfig } from './_shared/config.js';

export default class Login extends Command {
	static override description = 'Log in to the CASCADE dashboard.';

	static override flags = {
		server: Flags.string({
			description: 'Server URL (e.g. http://localhost:3000)',
			required: true,
		}),
		email: Flags.string({ description: 'Login email', required: true }),
		password: Flags.string({ description: 'Login password', required: true }),
		org: Flags.string({ description: 'Organization ID (persisted for subsequent commands)' }),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(Login);
		const serverUrl = flags.server.replace(/\/$/, '');

		const response = await fetch(`${serverUrl}/api/auth/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email: flags.email, password: flags.password }),
		});

		if (!response.ok) {
			const body = (await response.json()) as { error?: string };
			this.error(body.error ?? `Login failed (${response.status})`);
		}

		// Extract session token and cookie name from Set-Cookie header
		// Parse the cookie name dynamically from the server's response to handle
		// environment-specific cookie names (e.g., cascade_session_development)
		const setCookie = response.headers.get('set-cookie') ?? '';
		const match = setCookie.match(/(cascade_session[^=]*)=([^;]+)/);
		if (!match) {
			this.error('Login succeeded but no session cookie received.');
		}

		const [, cookieName, sessionToken] = match;
		saveConfig({ serverUrl, sessionToken, cookieName, orgId: flags.org });

		const user = (await response.json()) as { email: string; name: string };
		const orgSuffix = flags.org ? ` [org: ${flags.org}]` : '';
		this.log(
			chalk.green(`✓ Logged in as ${user.name} (${user.email}) at ${serverUrl}${orgSuffix}`),
		);

		// Show if overrides are active
		if (
			process.env.CASCADE_SERVER_URL ||
			process.env.CASCADE_SESSION_TOKEN ||
			process.env.CASCADE_ORG_ID
		) {
			this.log(
				'Note: CASCADE_SERVER_URL / CASCADE_SESSION_TOKEN / CASCADE_ORG_ID env vars will override stored config.',
			);
		}
	}
}
