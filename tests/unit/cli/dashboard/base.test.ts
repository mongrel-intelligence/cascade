import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoadConfig = vi.fn();
const mockCreateDashboardClient = vi.fn();
const mockWithSpinner = vi
	.fn()
	.mockImplementation((_msg: string, fn: () => Promise<unknown>) => fn());

vi.mock('../../../../src/cli/dashboard/_shared/config.js', () => ({
	loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
}));

vi.mock('../../../../src/cli/dashboard/_shared/client.js', () => ({
	createDashboardClient: (...args: unknown[]) => mockCreateDashboardClient(...args),
}));

vi.mock('../../../../src/cli/dashboard/_shared/spinner.js', () => ({
	withSpinner: (...args: unknown[]) => mockWithSpinner(...args),
	isSilentMode: vi.fn().mockReturnValue(false),
}));

vi.mock('chalk', () => ({
	default: {
		bold: (s: string) => s,
		blue: (s: string) => s,
		green: (s: string) => s,
		red: (s: string) => s,
		yellow: (s: string) => s,
		dim: (s: string) => s,
	},
}));

import { TRPCClientError } from '@trpc/client';
import { DashboardCommand, extractBaseFlags } from '../../../../src/cli/dashboard/_shared/base.js';

// Concrete subclass for testing
class TestCommand extends DashboardCommand {
	static override id = 'test';
	static override description = 'Test command';

	async run(): Promise<void> {
		// Access client to trigger lazy initialization
		const _client = this.client;
	}
}

class TestErrorCommand extends DashboardCommand {
	static override id = 'test-error';
	static override description = 'Test error command';

	errorToThrow: unknown = null;

	async run(): Promise<void> {
		this.handleError(this.errorToThrow as Error);
	}
}

class TestOutputCommand extends DashboardCommand {
	static override id = 'test-output';
	static override description = 'Test output command';

	lastResult: unknown;

	async run(): Promise<void> {}

	callSuccess(msg: string): void {
		this.success(msg);
	}

	callInfo(msg: string): void {
		this.info(msg);
	}

	async callWithSpinner<T>(message: string, fn: () => Promise<T>): Promise<T> {
		return this.withSpinner(message, fn);
	}

	callFilterColumns<T extends { key: string }>(columns: T[], columnsFlag?: string): T[] {
		return this.filterColumns(columns, columnsFlag);
	}

	callResolveFormat(flags: { format?: string; json?: boolean }): string {
		return this.resolveFormat(flags);
	}

	callOutputFormatted(
		rows: Record<string, unknown>[],
		columns: { key: string; header: string; format?: (v: unknown) => string }[],
		flags: { format?: string; json?: boolean; columns?: string },
		data?: unknown,
		emptyMessage?: string,
	): void {
		this.outputFormatted(rows, columns, flags, data, emptyMessage);
	}
}

describe('extractBaseFlags', () => {
	it('returns undefined when no overrides present', () => {
		expect(extractBaseFlags([])).toBeUndefined();
		expect(extractBaseFlags(['--json', 'list'])).toBeUndefined();
	});

	it('extracts --org value', () => {
		expect(extractBaseFlags(['--org', 'test-org'])).toEqual({ org: 'test-org' });
	});

	it('extracts --server value', () => {
		expect(extractBaseFlags(['--server', 'http://localhost:4000'])).toEqual({
			server: 'http://localhost:4000',
		});
	});

	it('extracts both flags together', () => {
		expect(extractBaseFlags(['--org', 'my-org', '--server', 'http://x'])).toEqual({
			org: 'my-org',
			server: 'http://x',
		});
	});

	it('handles --org=value equals syntax', () => {
		expect(extractBaseFlags(['--org=my-org'])).toEqual({ org: 'my-org' });
	});

	it('handles --server=value equals syntax', () => {
		expect(extractBaseFlags(['--server=http://x'])).toEqual({ server: 'http://x' });
	});

	it('ignores flag at end without value', () => {
		expect(extractBaseFlags(['--org'])).toBeUndefined();
		expect(extractBaseFlags(['--server'])).toBeUndefined();
	});

	it('stops parsing at --', () => {
		expect(extractBaseFlags(['--', '--org', 'test-org'])).toBeUndefined();
	});

	it('extracts base flags mixed with other flags', () => {
		expect(extractBaseFlags(['--json', '--org', 'my-org', '--limit', '20'])).toEqual({
			org: 'my-org',
		});
	});
});

describe('DashboardCommand', () => {
	describe('config loading', () => {
		it('errors when not logged in (no config)', async () => {
			mockLoadConfig.mockReturnValue(null);

			const cmd = new TestCommand([], {} as never);
			await expect(cmd.run()).rejects.toThrow('Not logged in');
		});

		it('creates client from loaded config', async () => {
			const config = { serverUrl: 'http://localhost:3000', sessionToken: 'tok' };
			mockLoadConfig.mockReturnValue(config);
			mockCreateDashboardClient.mockReturnValue({});

			const cmd = new TestCommand([], {} as never);
			await cmd.run();

			expect(mockCreateDashboardClient).toHaveBeenCalledWith(config);
		});
	});

	describe('outputJson', () => {
		it('prints JSON to console', () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

			const cmd = new TestCommand([], {} as never);
			cmd.outputJson({ hello: 'world' });

			expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({ hello: 'world' }, null, 2));
			consoleSpy.mockRestore();
		});
	});

	describe('--org flag integration', () => {
		it('passes orgId override to createDashboardClient', async () => {
			const config = { serverUrl: 'http://localhost:3000', sessionToken: 'tok' };
			mockLoadConfig.mockReturnValue(config);
			mockCreateDashboardClient.mockReturnValue({});

			const cmd = new TestCommand(['--org', 'my-org'], {} as never);
			await cmd.run();

			expect(mockCreateDashboardClient).toHaveBeenCalledWith(
				expect.objectContaining({ orgId: 'my-org' }),
			);
		});

		it('passes server override to createDashboardClient', async () => {
			const config = { serverUrl: 'http://localhost:3000', sessionToken: 'tok' };
			mockLoadConfig.mockReturnValue(config);
			mockCreateDashboardClient.mockReturnValue({});

			const cmd = new TestCommand(['--server', 'http://other:4000'], {} as never);
			await cmd.run();

			expect(mockCreateDashboardClient).toHaveBeenCalledWith(
				expect.objectContaining({ serverUrl: 'http://other:4000' }),
			);
		});

		it('passes both --org and --server overrides', async () => {
			const config = { serverUrl: 'http://localhost:3000', sessionToken: 'tok' };
			mockLoadConfig.mockReturnValue(config);
			mockCreateDashboardClient.mockReturnValue({});

			const cmd = new TestCommand(
				['--org', 'my-org', '--server', 'http://other:4000'],
				{} as never,
			);
			await cmd.run();

			expect(mockCreateDashboardClient).toHaveBeenCalledWith(
				expect.objectContaining({ serverUrl: 'http://other:4000', orgId: 'my-org' }),
			);
		});
	});

	describe('handleError', () => {
		it('shows login message for UNAUTHORIZED tRPC errors', async () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const err = new TRPCClientError('Unauthorized');
			Object.assign(err, { data: { code: 'UNAUTHORIZED' } });

			const cmd = new TestErrorCommand([], {} as never);
			cmd.errorToThrow = err;

			// handleError calls this.error() which throws oclif CLIError
			await expect(cmd.run()).rejects.toThrow();
		});

		it('shows actionable message for NOT_FOUND tRPC errors', async () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const err = new TRPCClientError('Not found');
			Object.assign(err, { data: { code: 'NOT_FOUND' } });

			const cmd = new TestErrorCommand([], {} as never);
			cmd.errorToThrow = err;

			await expect(cmd.run()).rejects.toThrow();
		});

		it('shows actionable message for FORBIDDEN tRPC errors', async () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const err = new TRPCClientError('Forbidden');
			Object.assign(err, { data: { code: 'FORBIDDEN' } });

			const cmd = new TestErrorCommand([], {} as never);
			cmd.errorToThrow = err;

			await expect(cmd.run()).rejects.toThrow();
		});

		it('shows actionable message for BAD_REQUEST tRPC errors', async () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const err = new TRPCClientError('email is required');
			Object.assign(err, { data: { code: 'BAD_REQUEST' } });

			const cmd = new TestErrorCommand([], {} as never);
			cmd.errorToThrow = err;

			await expect(cmd.run()).rejects.toThrow();
		});

		it('rethrows non-TRPCClientError errors', async () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const err = new TypeError('something else');

			const cmd = new TestErrorCommand([], {} as never);
			cmd.errorToThrow = err;

			await expect(cmd.run()).rejects.toThrow('something else');
		});

		it('prints stack trace to stderr when --verbose flag is present', async () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const err = new TRPCClientError('Some error');
			Object.assign(err, { data: { code: 'NOT_FOUND' } });

			const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

			const cmd = new TestErrorCommand(['--verbose'], {} as never);
			cmd.errorToThrow = err;

			await expect(cmd.run()).rejects.toThrow();

			expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('TRPCClientError'));
			stderrSpy.mockRestore();
		});

		it('does NOT print stack trace without --verbose flag', async () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const err = new TRPCClientError('Some error');
			Object.assign(err, { data: { code: 'NOT_FOUND' } });

			const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

			const cmd = new TestErrorCommand([], {} as never);
			cmd.errorToThrow = err;

			await expect(cmd.run()).rejects.toThrow();

			expect(stderrSpy).not.toHaveBeenCalled();
			stderrSpy.mockRestore();
		});
	});

	describe('success helper', () => {
		it('prints a green ✓ prefixed message', () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

			const cmd = new TestOutputCommand([], {} as never);
			cmd.callSuccess('Operation completed');

			expect(consoleSpy).toHaveBeenCalledWith('✓ Operation completed');
			consoleSpy.mockRestore();
		});
	});

	describe('info helper', () => {
		it('prints a blue ℹ prefixed message', () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

			const cmd = new TestOutputCommand([], {} as never);
			cmd.callInfo('Some information');

			expect(consoleSpy).toHaveBeenCalledWith('ℹ Some information');
			consoleSpy.mockRestore();
		});
	});

	describe('withSpinner helper', () => {
		it('calls withSpinner from spinner module with the message and fn', async () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			mockWithSpinner.mockImplementation((_msg: string, fn: () => Promise<unknown>) => fn());

			const cmd = new TestOutputCommand([], {} as never);
			const result = await cmd.callWithSpinner('Loading...', async () => 'done');

			expect(result).toBe('done');
			expect(mockWithSpinner).toHaveBeenCalledWith(
				'Loading...',
				expect.any(Function),
				expect.objectContaining({ silent: false }),
			);
		});

		it('passes silent=true when --json flag is present', async () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			mockWithSpinner.mockImplementation((_msg: string, fn: () => Promise<unknown>) => fn());

			const cmd = new TestOutputCommand(['--json'], {} as never);
			await cmd.callWithSpinner('Loading...', async () => null);

			expect(mockWithSpinner).toHaveBeenCalledWith(
				'Loading...',
				expect.any(Function),
				expect.objectContaining({ silent: true }),
			);
		});

		it('passes silent=true when --format=csv flag is present', async () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			mockWithSpinner.mockImplementation((_msg: string, fn: () => Promise<unknown>) => fn());

			const cmd = new TestOutputCommand(['--format=csv'], {} as never);
			await cmd.callWithSpinner('Loading...', async () => null);

			expect(mockWithSpinner).toHaveBeenCalledWith(
				'Loading...',
				expect.any(Function),
				expect.objectContaining({ silent: true }),
			);
		});
	});

	describe('resolveFormat', () => {
		it('returns table by default', () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const cmd = new TestOutputCommand([], {} as never);
			expect(cmd.callResolveFormat({})).toBe('table');
		});

		it('returns json when --json flag is true', () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const cmd = new TestOutputCommand([], {} as never);
			expect(cmd.callResolveFormat({ json: true })).toBe('json');
		});

		it('returns json when --format json is set', () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const cmd = new TestOutputCommand([], {} as never);
			expect(cmd.callResolveFormat({ format: 'json' })).toBe('json');
		});

		it('--json flag takes precedence over --format', () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const cmd = new TestOutputCommand([], {} as never);
			expect(cmd.callResolveFormat({ format: 'csv', json: true })).toBe('json');
		});

		it('returns csv when --format csv is set', () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const cmd = new TestOutputCommand([], {} as never);
			expect(cmd.callResolveFormat({ format: 'csv' })).toBe('csv');
		});

		it('returns compact when --format compact is set', () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const cmd = new TestOutputCommand([], {} as never);
			expect(cmd.callResolveFormat({ format: 'compact' })).toBe('compact');
		});
	});

	describe('filterColumns', () => {
		const columns = [
			{ key: 'id', header: 'ID' },
			{ key: 'name', header: 'Name' },
			{ key: 'status', header: 'Status' },
		];

		it('returns all columns when no filter provided', () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const cmd = new TestOutputCommand([], {} as never);
			expect(cmd.callFilterColumns(columns)).toEqual(columns);
		});

		it('returns all columns when empty string provided', () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const cmd = new TestOutputCommand([], {} as never);
			expect(cmd.callFilterColumns(columns, '')).toEqual(columns);
		});

		it('filters to specific columns', () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const cmd = new TestOutputCommand([], {} as never);
			const result = cmd.callFilterColumns(columns, 'id,status');
			expect(result).toHaveLength(2);
			expect(result.map((c) => c.key)).toEqual(['id', 'status']);
		});

		it('handles whitespace around column names', () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const cmd = new TestOutputCommand([], {} as never);
			const result = cmd.callFilterColumns(columns, 'id , name');
			expect(result).toHaveLength(2);
			expect(result.map((c) => c.key)).toEqual(['id', 'name']);
		});

		it('returns empty array when no columns match', () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const cmd = new TestOutputCommand([], {} as never);
			const result = cmd.callFilterColumns(columns, 'nonexistent');
			expect(result).toHaveLength(0);
		});
	});

	describe('outputFormatted', () => {
		let consoleSpy: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		});

		afterEach(() => {
			consoleSpy.mockRestore();
		});

		const rows = [
			{ id: '1', name: 'Alice', status: 'active' },
			{ id: '2', name: 'Bob', status: 'inactive' },
		];
		const columns = [
			{ key: 'id', header: 'ID' },
			{ key: 'name', header: 'Name' },
			{ key: 'status', header: 'Status' },
		];

		it('outputs table format by default', () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const cmd = new TestOutputCommand([], {} as never);
			cmd.callOutputFormatted(rows, columns, {});

			// header + separator + 2 rows = 4 calls
			expect(consoleSpy).toHaveBeenCalledTimes(4);
			expect(consoleSpy.mock.calls[0][0]).toContain('ID');
		});

		it('outputs JSON format when format=json', () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const cmd = new TestOutputCommand([], {} as never);
			const data = { items: rows };
			cmd.callOutputFormatted(rows, columns, { format: 'json' }, data);

			expect(consoleSpy).toHaveBeenCalledTimes(1);
			const output = consoleSpy.mock.calls[0][0];
			expect(output).toContain('"items"');
		});

		it('outputs CSV format when format=csv', () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const cmd = new TestOutputCommand([], {} as never);
			cmd.callOutputFormatted(rows, columns, { format: 'csv' });

			// header + 2 rows = 3 calls
			expect(consoleSpy).toHaveBeenCalledTimes(3);
			expect(consoleSpy.mock.calls[0][0]).toBe('ID,Name,Status');
			expect(consoleSpy.mock.calls[1][0]).toBe('1,Alice,active');
		});

		it('outputs compact format when format=compact', () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const cmd = new TestOutputCommand([], {} as never);
			cmd.callOutputFormatted(rows, columns, { format: 'compact' });

			expect(consoleSpy).toHaveBeenCalledTimes(2);
			expect(consoleSpy.mock.calls[0][0]).toBe('id=1 name=Alice status=active');
		});

		it('filters columns when --columns flag provided', () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const cmd = new TestOutputCommand([], {} as never);
			cmd.callOutputFormatted(rows, columns, { format: 'csv', columns: 'id,status' });

			expect(consoleSpy.mock.calls[0][0]).toBe('ID,Status');
			expect(consoleSpy.mock.calls[1][0]).toBe('1,active');
		});

		it('uses rows as JSON data when no data param provided', () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const cmd = new TestOutputCommand([], {} as never);
			cmd.callOutputFormatted(rows, columns, { format: 'json' });

			const output = JSON.parse(consoleSpy.mock.calls[0][0]);
			expect(output).toHaveLength(2);
			expect(output[0].id).toBe('1');
		});

		it('shows emptyMessage when table format with empty rows', () => {
			mockLoadConfig.mockReturnValue({ serverUrl: 'x', sessionToken: 'y' });
			const cmd = new TestOutputCommand([], {} as never);
			cmd.callOutputFormatted([], columns, {}, undefined, 'No items yet. Create one!');

			expect(consoleSpy).toHaveBeenCalledWith('  No items yet. Create one!');
		});
	});
});
