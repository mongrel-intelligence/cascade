import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ErrorSink } from '../../../../../src/gadgets/shared/cli/errorSink.js';
import {
	rejectMultipleStdinConsumers,
	resolveDirectParams,
} from '../../../../../src/gadgets/shared/cli/params.js';
import type {
	CLIAutoResolved,
	FileInputAlternative,
	ToolDefinition,
} from '../../../../../src/gadgets/shared/toolDefinition.js';

let tmpDir = '';

function makeSink(): ErrorSink {
	return {
		stdout: new Writable({
			write(_chunk, _enc, cb) {
				cb();
			},
		}),
		stderr: new Writable({
			write(_chunk, _enc, cb) {
				cb();
			},
		}),
		exit: vi.fn<(code: number) => never>(() => {
			throw new Error('exit');
		}),
	};
}

function writeTempFile(name: string, content: string): string {
	tmpDir = tmpDir || mkdtempSync(join(tmpdir(), 'cascade-cli-params-test-'));
	const path = join(tmpDir, name);
	writeFileSync(path, content);
	return path;
}

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
	tmpDir = '';
});

const fileAlt: FileInputAlternative = {
	paramName: 'comments',
	fileFlag: 'comments-file',
	parseAs: 'json',
};

const autoResolved: CLIAutoResolved = { paramName: 'owner', resolvedFrom: 'git-remote' };

const def: ToolDefinition = {
	name: 'TestTool',
	description: 'Test',
	parameters: {
		owner: { type: 'string', describe: 'Owner', required: true },
		body: { type: 'string', describe: 'Body', required: true },
		config: { type: 'object', describe: 'Config', optional: true },
		comments: { type: 'array', items: 'object', describe: 'Comments', required: true },
		comment: { type: 'string', describe: 'Internal', gadgetOnly: true },
	},
	examples: [{ params: { comments: [{ path: 'x.ts' }] } }],
};

describe('CLI parameter resolution', () => {
	it('prefers JSON file-input alternatives over inline values and skips auto-resolved params', () => {
		const filePath = writeTempFile('comments.json', '[{"path":"from-file.ts"}]');
		const params = resolveDirectParams(
			def,
			{
				owner: 'inline-owner',
				body: 'hello',
				config: '{"ok":true}',
				comments: '[{"path":"inline.ts"}]',
				'comments-file': filePath,
			},
			new Map([['comments', fileAlt]]),
			new Map([['owner', autoResolved]]),
			makeSink(),
		);
		expect(params).toEqual({
			body: 'hello',
			config: { ok: true },
			comments: [{ path: 'from-file.ts' }],
		});
	});

	it('wraps a top-level object for array-of-object file inputs', () => {
		const filePath = writeTempFile('comments.json', '{"path":"from-file.ts"}');
		const params = resolveDirectParams(
			def,
			{
				body: 'hello',
				'comments-file': filePath,
			},
			new Map([['comments', fileAlt]]),
			new Map([['owner', autoResolved]]),
			makeSink(),
		);

		expect(params).toEqual({
			body: 'hello',
			comments: [{ path: 'from-file.ts' }],
		});
	});

	it('wraps a top-level object for inline array-of-object values', () => {
		const params = resolveDirectParams(
			def,
			{
				body: 'hello',
				comments: '{"path":"inline.ts"}',
			},
			new Map([['comments', fileAlt]]),
			new Map([['owner', autoResolved]]),
			makeSink(),
		);

		expect(params).toEqual({
			body: 'hello',
			comments: [{ path: 'inline.ts' }],
		});
	});

	it('keeps arrays unchanged without validating individual entries', () => {
		const params = resolveDirectParams(
			def,
			{
				body: 'hello',
				comments: '["AddChecklist-compatible string entry",{"path":"inline.ts"}]',
			},
			new Map([['comments', fileAlt]]),
			new Map([['owner', autoResolved]]),
			makeSink(),
		);

		expect(params).toEqual({
			body: 'hello',
			comments: ['AddChecklist-compatible string entry', { path: 'inline.ts' }],
		});
	});

	it('emits json-parse when array-of-object JSON has an impossible top-level shape', () => {
		const sink = makeSink();
		expect(() =>
			resolveDirectParams(
				def,
				{
					body: 'hello',
					comments: '"not an array"',
				},
				new Map([['comments', fileAlt]]),
				new Map([['owner', autoResolved]]),
				sink,
			),
		).toThrow('exit');
		expect(sink.exit).toHaveBeenCalledWith(1);
	});

	it('emits missing-required when neither inline nor file value is present', () => {
		expect(() =>
			resolveDirectParams(
				def,
				{ body: 'hello' },
				new Map([['comments', fileAlt]]),
				new Map([['owner', autoResolved]]),
				makeSink(),
			),
		).toThrow('exit');
	});
});

// ---------------------------------------------------------------------------
// MNG-1059: multiple-stdin-consumer guard
// ---------------------------------------------------------------------------

describe('rejectMultipleStdinConsumers (MNG-1059)', () => {
	const fileAlts: FileInputAlternative[] = [
		{ paramName: 'body', fileFlag: 'body-file' },
		{ paramName: 'comments', fileFlag: 'comments-file', parseAs: 'json' },
	];

	it('no-ops when no file flags are set', () => {
		const sink = makeSink();
		rejectMultipleStdinConsumers(fileAlts, { body: 'hello' }, sink);
		expect(sink.exit).not.toHaveBeenCalled();
	});

	it('no-ops when only one file flag is set to "-"', () => {
		const sink = makeSink();
		rejectMultipleStdinConsumers(
			fileAlts,
			{ 'body-file': '-', 'comments-file': '/tmp/comments.json' },
			sink,
		);
		expect(sink.exit).not.toHaveBeenCalled();
	});

	it('no-ops when both file flags resolve to real paths (not stdin)', () => {
		const sink = makeSink();
		rejectMultipleStdinConsumers(
			fileAlts,
			{ 'body-file': '/tmp/body.md', 'comments-file': '/tmp/comments.json' },
			sink,
		);
		expect(sink.exit).not.toHaveBeenCalled();
	});

	it('emits flag-parse envelope when two file flags are both set to "-"', () => {
		const stdoutChunks: string[] = [];
		const sink: ErrorSink = {
			stdout: new Writable({
				write(chunk, _enc, cb) {
					stdoutChunks.push(chunk.toString());
					cb();
				},
			}),
			stderr: new Writable({
				write(_chunk, _enc, cb) {
					cb();
				},
			}),
			exit: vi.fn<(code: number) => never>(() => {
				throw new Error('exit');
			}),
		};

		expect(() =>
			rejectMultipleStdinConsumers(fileAlts, { 'body-file': '-', 'comments-file': '-' }, sink),
		).toThrow('exit');

		expect(sink.exit).toHaveBeenCalledWith(1);
		const envelope = JSON.parse(stdoutChunks.join('').trim()) as {
			success: boolean;
			error: { type: string; flag?: string; message?: string; hint?: string };
		};
		expect(envelope.success).toBe(false);
		expect(envelope.error.type).toBe('flag-parse');
		expect(envelope.error.flag).toBe('body-file,comments-file');
		expect(envelope.error.message).toContain('stdin can only be drained once');
		expect(envelope.error.hint).toContain('temp file');
	});

	it('does not emit when only one of three file flags is "-"', () => {
		const sink = makeSink();
		const alts: FileInputAlternative[] = [
			{ paramName: 'body', fileFlag: 'body-file' },
			{ paramName: 'comments', fileFlag: 'comments-file' },
			{ paramName: 'description', fileFlag: 'description-file' },
		];
		rejectMultipleStdinConsumers(
			alts,
			{
				'body-file': '-',
				'comments-file': '/tmp/c.json',
				'description-file': '/tmp/d.md',
			},
			sink,
		);
		expect(sink.exit).not.toHaveBeenCalled();
	});

	it('emits when three file flags all set to "-"', () => {
		const stdoutChunks: string[] = [];
		const sink: ErrorSink = {
			stdout: new Writable({
				write(chunk, _enc, cb) {
					stdoutChunks.push(chunk.toString());
					cb();
				},
			}),
			stderr: new Writable({
				write(_chunk, _enc, cb) {
					cb();
				},
			}),
			exit: vi.fn<(code: number) => never>(() => {
				throw new Error('exit');
			}),
		};
		const alts: FileInputAlternative[] = [
			{ paramName: 'body', fileFlag: 'body-file' },
			{ paramName: 'comments', fileFlag: 'comments-file' },
			{ paramName: 'description', fileFlag: 'description-file' },
		];

		expect(() =>
			rejectMultipleStdinConsumers(
				alts,
				{ 'body-file': '-', 'comments-file': '-', 'description-file': '-' },
				sink,
			),
		).toThrow('exit');

		const envelope = JSON.parse(stdoutChunks.join('').trim()) as {
			error: { flag?: string };
		};
		expect(envelope.error.flag).toBe('body-file,comments-file,description-file');
	});
});
