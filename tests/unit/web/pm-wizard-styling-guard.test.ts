/**
 * Regression guard: PM wizard component files must not render raw HTML
 * interactive elements (<input>, <button>, <select>, <label>) directly.
 * They must route through the shadcn/ui primitives (`Input`, `Button`,
 * `NativeSelect`, `Label`) so the dashboard theme + Tailwind reset apply.
 *
 * The original regression (specs 010/3 + 011 + 012) shipped raw elements
 * with BEM-style class names (`pm-wizard-*`) that were defined nowhere in
 * the CSS bundle — on the dark theme the Linear API-key input rendered as
 * an invisible <input type="password"> because there was no border, no
 * padding, and browser-default transparent background. Root `tsc` and the
 * SSR tests passed because neither asserted visual output.
 *
 * This test greps every `.tsx` source under pm-providers/** for
 * `createElement('input' | 'button' | 'select' | 'label', ...)` and JSX
 * `<input | <button | <select | <label` patterns, asserting zero matches.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const WIZARD_ROOT = resolve(REPO_ROOT, 'web/src/components/projects/pm-providers');

// Files allowed to use a raw element, with a reason. Empty by design — add
// entries only with justification.
const ALLOWLIST = new Set<string>([]);

const RAW_HTML_ELEMENTS = ['input', 'button', 'select', 'label'] as const;

function walkTsx(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) {
			if (entry === 'node_modules' || entry === 'dist') continue;
			walkTsx(full, out);
		} else if (entry.endsWith('.tsx')) {
			out.push(full);
		}
	}
	return out;
}

/**
 * Strip block comments (`/* ... *\/`) and line comments (`// ...`) so that
 * mentions of raw elements in JSDoc prose don't trigger false positives.
 */
function stripComments(source: string): string {
	// Block comments — non-greedy, multi-line.
	let out = source.replace(/\/\*[\s\S]*?\*\//g, '');
	// Line comments — everything from `//` to EOL. Naive but sufficient here:
	// the wizard files never embed `//` inside string literals in a way that
	// would confuse this (URLs use template literals / string concat).
	out = out.replace(/\/\/[^\n]*/g, '');
	return out;
}

function findViolations(source: string): string[] {
	const stripped = stripComments(source);
	const violations: string[] = [];
	for (const tag of RAW_HTML_ELEMENTS) {
		const createElementRe = new RegExp(`createElement\\(\\s*['"]${tag}['"]`, 'g');
		for (const m of stripped.matchAll(createElementRe)) {
			violations.push(`createElement('${tag}'): index ${m.index}`);
		}
		const jsxRe = new RegExp(`<${tag}(?=[\\s/>])`, 'g');
		for (const m of stripped.matchAll(jsxRe)) {
			violations.push(`<${tag}: index ${m.index}`);
		}
	}
	return violations;
}

describe('pm-wizard styling guard', () => {
	const files = walkTsx(WIZARD_ROOT)
		.map((abs) => relative(REPO_ROOT, abs))
		.sort();

	it('finds wizard component files to audit', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it.each(files)('%s uses shadcn primitives, not raw HTML interactive elements', (relPath) => {
		if (ALLOWLIST.has(relPath)) return;
		const source = readFileSync(resolve(REPO_ROOT, relPath), 'utf8');
		const violations = findViolations(source);
		expect(
			violations,
			`${relPath} must route interactive elements through shadcn primitives ` +
				`(Input, Button, NativeSelect, Label). Found raw HTML: ${violations.join(', ')}`,
		).toEqual([]);
	});
});
