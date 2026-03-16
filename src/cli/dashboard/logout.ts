import { Command } from '@oclif/core';
import chalk from 'chalk';
import { clearConfig, loadConfig } from './_shared/config.js';

export default class Logout extends Command {
	static override description = 'Log out of the CASCADE dashboard.';

	async run(): Promise<void> {
		const config = loadConfig();
		if (config) {
			// Best-effort server-side logout
			// Use the cookie name from config to match the server's environment
			const cookieName = config.cookieName ?? 'cascade_session';
			try {
				await fetch(`${config.serverUrl}/api/auth/logout`, {
					method: 'POST',
					headers: { Cookie: `${cookieName}=${config.sessionToken}` },
				});
			} catch {
				// Ignore — server may be unreachable
			}
		}

		clearConfig();
		this.log(chalk.green('✓ Logged out.'));
	}
}
