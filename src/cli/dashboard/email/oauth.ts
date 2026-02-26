import * as http from 'node:http';
import * as url from 'node:url';
import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class EmailOAuth extends DashboardCommand {
	static override description =
		'Authenticate Gmail via OAuth. Opens browser and runs local callback server.';

	static override args = {
		projectId: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		port: Flags.integer({
			description: 'Local callback server port',
			default: 8085,
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(EmailOAuth);

		try {
			// Find Google OAuth credentials
			const credentials = await this.client.credentials.list.query();
			const clientIdCred = credentials.find(
				(c: { envVarKey: string }) => c.envVarKey === 'GOOGLE_OAUTH_CLIENT_ID',
			) as { id: number } | undefined;
			const clientSecretCred = credentials.find(
				(c: { envVarKey: string }) => c.envVarKey === 'GOOGLE_OAUTH_CLIENT_SECRET',
			) as { id: number } | undefined;

			if (!clientIdCred || !clientSecretCred) {
				this.error(
					'Google OAuth credentials not configured. Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET credentials first.',
				);
			}

			const redirectUri = `http://127.0.0.1:${flags.port}/callback`;

			// Get OAuth URL
			const { url: authUrl } = await this.client.integrationsDiscovery.gmailOAuthUrl.mutate({
				clientIdCredentialId: clientIdCred.id,
				redirectUri,
				projectId: args.projectId,
			});

			this.log('Opening browser for Google authorization...');
			this.log(`If browser doesn't open, visit: ${authUrl}`);

			// Open browser
			const open = await import('open');
			await open.default(authUrl);

			// Start callback server and wait for code and state
			const { code, state } = await this.waitForCallback(flags.port);

			this.log('Received authorization code. Exchanging for tokens...');

			// Exchange code - pass the state for server-side CSRF validation
			const result = await this.client.integrationsDiscovery.gmailOAuthCallback.mutate({
				clientIdCredentialId: clientIdCred.id,
				clientSecretCredentialId: clientSecretCred.id,
				code,
				redirectUri,
				state,
			});

			if (flags.json) {
				this.outputJson({ email: result.email, success: true });
				return;
			}

			this.log(`Gmail connected successfully for: ${result.email}`);
			this.log('Email integration has been created and credentials linked.');
		} catch (err) {
			this.handleError(err);
		}
	}

	private sendHtmlResponse(
		res: http.ServerResponse,
		title: string,
		message: string,
		isError: boolean,
	): void {
		const color = isError ? '#dc2626' : '#16a34a';
		res.writeHead(200, { 'Content-Type': 'text/html' });
		res.end(`
			<html>
				<body style="font-family: sans-serif; text-align: center; padding: 50px;">
					<h1 style="color: ${color};">${title}</h1>
					<p>${message}</p>
					<p>You can close this window.</p>
				</body>
			</html>
		`);
	}

	private handleOAuthCallback(
		parsedUrl: url.UrlWithParsedQuery,
		res: http.ServerResponse,
		server: http.Server,
		resolve: (value: { code: string; state: string }) => void,
		reject: (reason: Error) => void,
	): boolean {
		if (parsedUrl.pathname !== '/callback') {
			return false;
		}

		const code = parsedUrl.query.code as string | undefined;
		const state = parsedUrl.query.state as string | undefined;
		const error = parsedUrl.query.error as string | undefined;

		if (error) {
			this.sendHtmlResponse(res, 'Authorization Failed', error, true);
			server.close();
			reject(new Error(`OAuth error: ${error}`));
			return true;
		}

		if (code && state) {
			this.sendHtmlResponse(
				res,
				'Authorization Successful!',
				'You can close this window and return to the terminal.',
				false,
			);
			server.close();
			resolve({ code, state });
			return true;
		}

		if (code && !state) {
			this.sendHtmlResponse(res, 'Authorization Failed', 'Missing state parameter', true);
			server.close();
			reject(new Error('OAuth callback missing state parameter'));
			return true;
		}

		return false;
	}

	private waitForCallback(port: number): Promise<{ code: string; state: string }> {
		return new Promise((resolve, reject) => {
			const server = http.createServer((req, res) => {
				const parsedUrl = url.parse(req.url ?? '', true);

				const handled = this.handleOAuthCallback(parsedUrl, res, server, resolve, reject);
				if (!handled) {
					res.writeHead(404);
					res.end('Not found');
				}
			});

			server.listen(port, '127.0.0.1', () => {
				this.log(`Waiting for OAuth callback on http://127.0.0.1:${port}/callback`);
			});

			server.on('error', (err) => {
				reject(new Error(`Failed to start callback server: ${err.message}`));
			});

			// Timeout after 5 minutes
			setTimeout(
				() => {
					server.close();
					reject(new Error('OAuth callback timeout (5 minutes)'));
				},
				5 * 60 * 1000,
			);
		});
	}
}
