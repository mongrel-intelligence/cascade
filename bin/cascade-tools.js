#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Config, run } from '@oclif/core';

// Bootstrap all integrations before oclif loads any command. The CLI
// runs commands lazily, and Spec 006/5 removed the legacy self-bootstrap
// path, so side-effect imports have to fire at the entry point.
// Without this, `cascade-tools pm <cmd>` throws `Unknown PM integration type`.
await import('../dist/cli/bootstrap.js');

// cascade-tools uses its own oclif config independent of package.json,
// which now points to the dashboard CLI (cascade binary).
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const pjson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));

pjson.oclif = {
	bin: 'cascade-tools',
	commands: {
		strategy: 'pattern',
		target: './dist/cli',
		globPatterns: ['**/*.js', '!**/dashboard/**', '!**/_shared/**', '!base.js', '!bootstrap.js'],
	},
	topicSeparator: ' ',
};

const config = await Config.load({ root, pjson });
try {
	await run(process.argv.slice(2), config);
} catch (err) {
	// oclif's `this.exit(code)` throws an ExitError. We've already emitted the
	// cascade-tools error envelope (stdout JSON + stderr prose) at that point;
	// propagating the ExitError to Node's default handler would spew a stack
	// trace that obscures our readable prose. Swallow ExitError quietly and
	// let the exit code stand. Anything else still propagates.
	const code =
		typeof err?.oclif?.exit === 'number' ? err.oclif.exit : err?.code === 'EEXIT' ? 1 : undefined;
	if (code !== undefined) {
		process.exit(code);
	}
	throw err;
}
