import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ErrorSink } from '../../../../../src/gadgets/shared/cli/errorSink.js';
import { resolveDirectParams } from '../../../../../src/gadgets/shared/cli/params.js';
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
