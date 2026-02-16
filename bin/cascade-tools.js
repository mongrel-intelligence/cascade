#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Config, run } from '@oclif/core';

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
		globPatterns: ['**/*.js', '!**/dashboard/**', '!**/_shared/**', '!base.js'],
	},
	topicSeparator: ' ',
};

const config = await Config.load({ root, pjson });
await run(process.argv.slice(2), config);
