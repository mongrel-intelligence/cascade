import { Command, Flags } from '@oclif/core';
import { TRPCClientError } from '@trpc/client';
import { type DashboardClient, createDashboardClient } from './client.js';
import { type CliConfig, loadConfig } from './config.js';
import { printDetail, printTable } from './format.js';

export abstract class DashboardCommand extends Command {
	static override baseFlags = {
		json: Flags.boolean({ description: 'Output as JSON', default: false }),
		server: Flags.string({ description: 'Override server URL' }),
		org: Flags.string({ description: 'Override organization context (admin only)' }),
	};

	private _client: DashboardClient | undefined;
	private _config: CliConfig | undefined;

	protected get config_(): CliConfig {
		if (!this._config) {
			const config = loadConfig();
			if (!config) {
				this.error('Not logged in. Run `cascade login` first.');
			}
			this._config = config;
		}
		return this._config;
	}

	protected get client(): DashboardClient {
		if (!this._client) {
			const config = this.config_;
			// Allow --server and --org flags to override
			const flags = this.parseBaseFlags();
			if (flags?.server) {
				config.serverUrl = flags.server;
			}
			if (flags?.org) {
				config.orgId = flags.org;
			}
			this._client = createDashboardClient(config);
		}
		return this._client;
	}

	private parseBaseFlags(): { server?: string; json?: boolean; org?: string } | undefined {
		// Base flags are parsed in run() — this is a fallback for the getter
		return undefined;
	}

	protected outputJson(data: unknown): void {
		console.log(JSON.stringify(data, null, 2));
	}

	protected outputTable(
		rows: Record<string, unknown>[],
		columns: { key: string; header: string; format?: (v: unknown) => string }[],
	): void {
		printTable(rows, columns);
	}

	protected outputDetail(
		obj: Record<string, unknown>,
		fields: Record<string, { label: string; format?: (v: unknown) => string }>,
	): void {
		printDetail(obj, fields);
	}

	protected handleError(err: unknown): never {
		if (err instanceof TRPCClientError) {
			const code = (err.data as { code?: string } | undefined)?.code;
			if (code === 'UNAUTHORIZED') {
				this.error('Session expired. Run `cascade login`.');
			}
			this.error(err.message);
		}
		throw err;
	}
}
