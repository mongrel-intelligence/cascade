/**
 * Tests for the shared cascade-tools error envelope helper (spec 014).
 *
 * The envelope is the single channel every cascade-tools failure emits on:
 * - Structured JSON on stdout: `{"success":false,"error":{...}}`
 * - One-line prose summary on stderr (for humans running the CLI directly)
 * - Exit code 1
 *
 * Consumed by cliCommandFactory for flag-parse, JSON-parse, missing-required,
 * enum-mismatch, unknown-flag, auth, and runtime failure paths.
 */

import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import {
	type CliErrorEnvelope,
	emitCliError,
	truncateGot,
} from '../../../../src/gadgets/shared/errorEnvelope.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWritable(): { stream: Writable; written: () => string } {
	const chunks: string[] = [];
	const stream = new Writable({
		write(chunk, _enc, cb) {
			chunks.push(chunk.toString());
			cb();
		},
	});
	return { stream, written: () => chunks.join('') };
}

function parseFirstJsonLine(blob: string): { success: boolean; error: CliErrorEnvelope } {
	const line = blob.split('\n').find((l) => l.trim().startsWith('{')) ?? '';
	return JSON.parse(line) as { success: boolean; error: CliErrorEnvelope };
}

const ESC = String.fromCharCode(0x1b);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('emitCliError', () => {
	it('writes a stable JSON envelope to stdout (success:false + error fields)', () => {
		const stdout = makeWritable();
		const stderr = makeWritable();
		const exit = vi.fn<(code: number) => never>(() => {
			throw new Error('exit');
		});

		expect(() =>
			emitCliError({
				type: 'json-parse',
				flag: 'comments',
				message: 'invalid JSON payload',
				got: "[{'path':'a'}]",
				expected: '[{"path":"<file>","line":<num>,"body":"<text>"}]',
				hint: 'use --comments-file for long payloads',
				stdout: stdout.stream,
				stderr: stderr.stream,
				exit,
			}),
		).toThrow('exit');

		const parsed = parseFirstJsonLine(stdout.written());
		expect(parsed.success).toBe(false);
		expect(parsed.error.type).toBe('json-parse');
		expect(parsed.error.flag).toBe('comments');
		expect(parsed.error.message).toBe('invalid JSON payload');
		expect(parsed.error.got).toBe("[{'path':'a'}]");
		expect(parsed.error.expected).toBe('[{"path":"<file>","line":<num>,"body":"<text>"}]');
		expect(parsed.error.hint).toBe('use --comments-file for long payloads');
	});

	it('mirrors a prose summary to stderr (≤120 chars, no ANSI, mentions flag + type)', () => {
		const stdout = makeWritable();
		const stderr = makeWritable();
		const exit = vi.fn<(code: number) => never>(() => {
			throw new Error('exit');
		});

		expect(() =>
			emitCliError({
				type: 'json-parse',
				flag: 'comments',
				message: 'invalid JSON payload',
				stdout: stdout.stream,
				stderr: stderr.stream,
				exit,
			}),
		).toThrow('exit');

		const err = stderr.written().trim();
		expect(err.length).toBeGreaterThan(0);
		expect(err.length).toBeLessThanOrEqual(120);
		// No ANSI escape sequences (ESC = 0x1b)
		expect(err.indexOf(ESC)).toBe(-1);
		// References the flag and the type
		expect(err).toContain('--comments');
		expect(err).toContain('json-parse');
	});

	it('truncates `got` to ~80 chars with an ellipsis when longer', () => {
		const stdout = makeWritable();
		const stderr = makeWritable();
		const exit = vi.fn<(code: number) => never>(() => {
			throw new Error('exit');
		});

		const longInput = 'x'.repeat(500);

		expect(() =>
			emitCliError({
				type: 'json-parse',
				flag: 'comments',
				message: 'invalid JSON',
				got: longInput,
				stdout: stdout.stream,
				stderr: stderr.stream,
				exit,
			}),
		).toThrow('exit');

		const parsed = parseFirstJsonLine(stdout.written());
		expect(parsed.error.got?.length).toBeLessThanOrEqual(83);
		expect(parsed.error.got?.endsWith('...')).toBe(true);
	});

	it('omits optional fields (got, expected, hint, example) from the envelope when not provided', () => {
		const stdout = makeWritable();
		const stderr = makeWritable();
		const exit = vi.fn<(code: number) => never>(() => {
			throw new Error('exit');
		});

		expect(() =>
			emitCliError({
				type: 'missing-required',
				flag: 'body',
				message: '--body is required',
				stdout: stdout.stream,
				stderr: stderr.stream,
				exit,
			}),
		).toThrow('exit');

		const parsed = parseFirstJsonLine(stdout.written());
		expect(parsed.error).not.toHaveProperty('got');
		expect(parsed.error).not.toHaveProperty('expected');
		expect(parsed.error).not.toHaveProperty('hint');
		expect(parsed.error).not.toHaveProperty('example');
	});

	it('calls exit with code 1', () => {
		const stdout = makeWritable();
		const stderr = makeWritable();
		const exit = vi.fn<(code: number) => never>(() => {
			throw new Error('exit');
		});

		expect(() =>
			emitCliError({
				type: 'runtime',
				message: 'boom',
				stdout: stdout.stream,
				stderr: stderr.stream,
				exit,
			}),
		).toThrow('exit');

		expect(exit).toHaveBeenCalledOnce();
		expect(exit).toHaveBeenCalledWith(1);
	});
});

describe('truncateGot', () => {
	it('returns the input unchanged when short', () => {
		expect(truncateGot('hello')).toBe('hello');
	});

	it('truncates to max+ellipsis when long', () => {
		const result = truncateGot('x'.repeat(200), 80);
		expect(result.length).toBe(83);
		expect(result.endsWith('...')).toBe(true);
	});
});
