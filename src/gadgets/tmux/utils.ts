import { resolve } from 'node:path';

/**
 * Sanitize session name by replacing invalid characters with dashes.
 */
export function sanitizeSessionName(name: string): string {
	return name.replace(/[^a-zA-Z0-9_-]/g, '-');
}

/**
 * Unescape tmux control mode output (octal escapes like \012 -> \n)
 */
export function unescapeOutput(s: string): string {
	return s.replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(Number.parseInt(oct, 8)));
}

// ANSI escape code patterns (using hex to avoid lint errors about control chars)
const ESC = '\u001b';
const BEL = '\u0007';
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*[a-zA-Z]`, 'g');
const OSC_PATTERN = new RegExp(`${ESC}\\][^${BEL}]*${BEL}`, 'g');
const DCS_PATTERN = new RegExp(`${ESC}[PX^_][^${ESC}]*${ESC}\\\\`, 'g');

/**
 * Strip ANSI escape codes from output
 */
export function stripAnsi(s: string): string {
	return s
		.replace(ANSI_PATTERN, '')
		.replace(OSC_PATTERN, '')
		.replace(DCS_PATTERN, '')
		.replace(/\r/g, '');
}

/**
 * Sleep helper
 */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve working directory for tmux commands.
 * Relative paths are resolved against process.cwd() (the repo root),
 * since the tmux control session runs in /tmp.
 */
export function resolveWorkingDirectory(cwd?: string): string {
	return cwd ? resolve(cwd) : process.cwd();
}
