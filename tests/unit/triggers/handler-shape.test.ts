import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function listTsFiles(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) {
			out.push(...listTsFiles(full));
		} else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
			out.push(full);
		}
	}
	return out;
}

/**
 * Static-grep guard against re-introducing the duplicate `skip()` helpers
 * that lived inside `check-suite-failure.ts` and `pr-conflict-detected.ts`
 * (both literal copy-pastes of the same body) before the R1 refactor
 * consolidated them into `src/triggers/shared/skip.ts`.
 *
 * Future regressions where someone adds a local `function skip(...)` to a
 * trigger handler — instead of importing from the shared module — fail CI
 * with a precise file path. Same pattern as `trigger-event-consistency.test.ts`
 * and `pm-router-adapter-pm-scope.test.ts`.
 */
describe('trigger handler shape — no local skip() helpers', () => {
	const repoRoot = process.cwd();
	const allTriggerFiles = listTsFiles(join(repoRoot, 'src/triggers'));
	const handlerFiles = allTriggerFiles.filter(
		(f) =>
			!f.endsWith('/registry.ts') &&
			!f.endsWith('/index.ts') &&
			!f.endsWith('/types.ts') &&
			!f.endsWith('/builtins.ts') &&
			!f.endsWith('/config-resolver.ts') &&
			!f.includes('/shared/'),
	);
	const githubHandlerFiles = allTriggerFiles.filter(
		(f) =>
			f.includes('/github/') &&
			!f.endsWith('/utils.ts') &&
			!f.endsWith('/types.ts') &&
			!f.endsWith('/index.ts') &&
			!f.endsWith('/register.ts') &&
			!f.endsWith('/check-polling.ts'),
	);

	it('every trigger handler imports skip() from shared/skip.js, never defines it locally', () => {
		const offenders: Array<{ file: string; matchedLine: string }> = [];

		for (const file of handlerFiles) {
			const contents = readFileSync(file, 'utf8');
			// Match a top-level skip-builder declaration. Allowed shapes that
			// the shared module owns are NOT in handler files (they live under
			// src/triggers/shared/skip.ts which is excluded above).
			const localDefinitionPattern = /^(?:export\s+)?function\s+skip\s*\(/m;
			const match = contents.match(localDefinitionPattern);
			if (match) {
				offenders.push({ file, matchedLine: match[0].trim() });
			}
		}

		expect(
			offenders,
			`Trigger handlers must NOT define a local 'function skip(' — import { skip } from '../shared/skip.js' instead. ` +
				`Offending files:\n${offenders.map((o) => `  - ${o.file}: ${o.matchedLine}`).join('\n')}`,
		).toEqual([]);
	});

	it('every GitHub trigger handler that returns a self-skip imports the shared skip helper', () => {
		// Looser check: any GitHub handler that has at least one `return skip(`
		// call must import `skip` from the shared module. This catches the case
		// where someone copy-pastes a `skip()` call but forgets to wire it to
		// the shared import (would otherwise produce a TS reference error).
		const offenders: string[] = [];
		for (const file of githubHandlerFiles) {
			const contents = readFileSync(file, 'utf8');
			const usesSkip = /\breturn\s+skip\s*\(/.test(contents);
			const importsSkip = /from ['"]\.\.\/shared\/skip\.js['"]/.test(contents);
			if (usesSkip && !importsSkip) offenders.push(file);
		}

		expect(
			offenders,
			`Files using 'return skip(' but not importing from '../shared/skip.js':\n${offenders.map((f) => `  - ${f}`).join('\n')}`,
		).toEqual([]);
	});
});
