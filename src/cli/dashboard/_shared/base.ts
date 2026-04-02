import { Command, Flags } from '@oclif/core';
import { TRPCClientError } from '@trpc/client';
import chalk from 'chalk';
import { createDashboardClient, type DashboardClient } from './client.js';
import { type CliConfig, loadConfig } from './config.js';
import { formatActionableError, mapError } from './errors.js';
import { printCompact, printCsv, printDetail, printTable } from './format.js';
import { withSpinner } from './spinner.js';

export type OutputFormat = 'table' | 'json' | 'csv' | 'compact';

export function extractBaseFlags(argv: string[]): { server?: string; org?: string } | undefined {
	let server: string | undefined;
	let org: string | undefined;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--') break;
		if (arg === '--server' && i + 1 < argv.length) {
			server = argv[++i];
		} else if (arg.startsWith('--server=')) {
			server = arg.slice('--server='.length);
		} else if (arg === '--org' && i + 1 < argv.length) {
			org = argv[++i];
		} else if (arg.startsWith('--org=')) {
			org = arg.slice('--org='.length);
		}
	}
	if (!server && !org) return undefined;
	return { server, org };
}

export abstract class DashboardCommand extends Command {
	static override baseFlags = {
		format: Flags.string({
			description: 'Output format (table, json, csv, compact)',
			options: ['table', 'json', 'csv', 'compact'],
			default: 'table',
		}),
		json: Flags.boolean({
			description: 'Output as JSON (alias for --format json)',
			default: false,
		}),
		columns: Flags.string({
			description: 'Comma-separated list of columns to display (e.g. --columns id,status,agent)',
		}),
		server: Flags.string({ description: 'Override server URL' }),
		org: Flags.string({ description: 'Override organization context (admin/superadmin only)' }),
		verbose: Flags.boolean({
			description: 'Show full stack trace on error',
			default: false,
		}),
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

	private parseBaseFlags(): { server?: string; org?: string } | undefined {
		return extractBaseFlags(this.argv);
	}

	/**
	 * Resolve the effective output format. --json flag takes precedence as alias for json format.
	 */
	protected resolveFormat(flags: { format?: string; json?: boolean }): OutputFormat {
		if (flags.json) return 'json';
		return (flags.format as OutputFormat | undefined) ?? 'table';
	}

	protected outputJson(data: unknown): void {
		console.log(JSON.stringify(data, null, 2));
	}

	protected outputTable(
		rows: Record<string, unknown>[],
		columns: { key: string; header: string; format?: (v: unknown) => string }[],
		emptyMessage?: string,
	): void {
		printTable(rows, columns, emptyMessage);
	}

	protected outputDetail(
		obj: Record<string, unknown>,
		fields: Record<string, { label: string; format?: (v: unknown) => string }>,
	): void {
		printDetail(obj, fields);
	}

	/**
	 * Filter columns based on the --columns flag value.
	 * Returns the original columns if no filter is specified.
	 */
	protected filterColumns<T extends { key: string }>(columns: T[], columnsFlag?: string): T[] {
		if (!columnsFlag) return columns;
		const keys = columnsFlag
			.split(',')
			.map((k) => k.trim())
			.filter(Boolean);
		if (keys.length === 0) return columns;
		return columns.filter((col) => keys.includes(col.key));
	}

	/**
	 * Output rows in the format specified by the --format / --json flags.
	 * Handles column filtering via --columns flag automatically.
	 */
	protected outputFormatted(
		rows: Record<string, unknown>[],
		columns: { key: string; header: string; format?: (v: unknown) => string }[],
		flags: { format?: string; json?: boolean; columns?: string },
		data?: unknown,
		emptyMessage?: string,
	): void {
		const fmt = this.resolveFormat(flags);
		const filteredColumns = this.filterColumns(columns, flags.columns);

		switch (fmt) {
			case 'json':
				this.outputJson(data ?? rows);
				break;
			case 'csv':
				printCsv(rows, filteredColumns);
				break;
			case 'compact':
				printCompact(rows, filteredColumns);
				break;
			default:
				printTable(rows, filteredColumns, emptyMessage);
				break;
		}
	}

	/**
	 * Print a success message with a green ✓ prefix.
	 */
	protected success(message: string): void {
		console.log(chalk.green(`✓ ${message}`));
	}

	/**
	 * Print an informational message with a blue ℹ prefix.
	 */
	protected info(message: string): void {
		console.log(chalk.blue(`ℹ ${message}`));
	}

	/**
	 * Wrap an async function with an animated spinner.
	 * Automatically suppressed when --json flag is active, NO_COLOR=1, or CI=1.
	 */
	protected withSpinner<T>(message: string, fn: () => Promise<T>): Promise<T> {
		// Suppress spinner when --json flag or non-table format is present
		const isJson = this.argv.includes('--json');
		const hasFormat = this.argv.some((a) => a === '--format' || a.startsWith('--format='));
		const formatVal =
			this.argv.find((a) => a.startsWith('--format='))?.slice('--format='.length) ??
			(hasFormat ? this.argv[this.argv.indexOf('--format') + 1] : undefined);
		const silent = isJson || (formatVal !== undefined && formatVal !== 'table');
		return withSpinner(message, fn, { silent });
	}

	protected handleError(err: unknown): never {
		// Show full stack trace when --verbose flag is present
		const isVerbose = this.argv.includes('--verbose');
		if (isVerbose && err instanceof Error && err.stack) {
			process.stderr.write(`${err.stack}\n`);
		}

		const serverUrl = this._config?.serverUrl;
		const actionable = mapError(err, serverUrl);
		const message = formatActionableError(actionable);

		// For non-TRPC errors (e.g. plain TypeError), re-throw with the actionable message
		if (!(err instanceof TRPCClientError)) {
			throw new Error(message, { cause: err });
		}

		this.error(message);
	}
}
