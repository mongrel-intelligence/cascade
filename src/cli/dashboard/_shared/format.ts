import chalk from 'chalk';

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escape codes requires matching ESC
const ANSI_STRIP_RE = /\u001B\[\d+m/g;

interface Column {
	key: string;
	header: string;
	width?: number;
	format?: (value: unknown) => string;
}

export function printTable(rows: Record<string, unknown>[], columns: Column[]): void {
	if (rows.length === 0) {
		console.log('  (no results)');
		return;
	}

	// Calculate column widths
	const widths = columns.map((col) => {
		const headerLen = col.header.length;
		const maxDataLen = rows.reduce((max, row) => {
			const formatted = col.format ? col.format(row[col.key]) : String(row[col.key] ?? '');
			// Strip ANSI codes for width calculation
			const plain = formatted.replace(ANSI_STRIP_RE, '');
			return Math.max(max, plain.length);
		}, 0);
		return col.width ?? Math.max(headerLen, Math.min(maxDataLen, 60));
	});

	// Print header
	const header = columns.map((col, i) => col.header.padEnd(widths[i])).join('  ');
	console.log(chalk.bold(header));
	console.log(columns.map((_, i) => '─'.repeat(widths[i])).join('  '));

	// Print rows
	for (const row of rows) {
		const line = columns
			.map((col, i) => {
				const formatted = col.format ? col.format(row[col.key]) : String(row[col.key] ?? '');
				const plain = formatted.replace(ANSI_STRIP_RE, '');
				const padding = Math.max(0, widths[i] - plain.length);
				return formatted + ' '.repeat(padding);
			})
			.join('  ');
		console.log(line);
	}
}

interface FieldMap {
	label: string;
	format?: (value: unknown) => string;
}

export function printDetail(obj: Record<string, unknown>, fields: Record<string, FieldMap>): void {
	const maxLabel = Math.max(...Object.values(fields).map((f) => f.label.length));

	for (const [key, field] of Object.entries(fields)) {
		const value = obj[key];
		const formatted = field.format ? field.format(value) : String(value ?? '—');
		console.log(`  ${chalk.bold(field.label.padEnd(maxLabel))}  ${formatted}`);
	}
}

export function formatDate(iso: unknown): string {
	if (!iso) return '—';
	const date = new Date(String(iso));
	const now = Date.now();
	const diffMs = now - date.getTime();
	const diffSec = Math.floor(diffMs / 1000);

	if (diffSec < 60) return 'just now';
	if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
	if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
	if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
	return date.toISOString().slice(0, 10);
}

export function formatDuration(ms: unknown): string {
	if (ms == null) return '—';
	const totalMs = Number(ms);
	if (totalMs < 1000) return `${totalMs}ms`;
	const sec = Math.floor(totalMs / 1000);
	if (sec < 60) return `${sec}s`;
	const min = Math.floor(sec / 60);
	const remSec = sec % 60;
	return `${min}m ${remSec}s`;
}

export function formatCost(usd: unknown): string {
	if (usd == null) return '—';
	return `$${Number(usd).toFixed(2)}`;
}

export function formatStatus(status: unknown): string {
	const s = String(status ?? '');
	switch (s) {
		case 'running':
			return chalk.blue(s);
		case 'success':
			return chalk.green(s);
		case 'failed':
			return chalk.red(s);
		case 'cancelled':
			return chalk.yellow(s);
		default:
			return s;
	}
}

export function formatBoolean(val: unknown): string {
	return val ? chalk.green('yes') : chalk.dim('no');
}
