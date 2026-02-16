import { Command } from '@oclif/core';
import { clearConfig, loadConfig } from './_shared/config.js';

export default class Logout extends Command {
	static override description = 'Log out of the CASCADE dashboard.';

	async run(): Promise<void> {
		const config = loadConfig();
		if (config) {
			// Best-effort server-side logout
			try {
				await fetch(`${config.serverUrl}/api/auth/logout`, {
					method: 'POST',
					headers: { Cookie: `cascade_session=${config.sessionToken}` },
				});
			} catch {
				// Ignore — server may be unreachable
			}
		}

		clearConfig();
		this.log('Logged out.');
	}
}
