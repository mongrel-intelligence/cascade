/**
 * Structural regression guard for the shared Combobox component.
 *
 * cmdk v1+ always sets `data-disabled="false"` on every non-disabled
 * CommandItem. Tailwind's bare `data-[disabled]:` variant generates the
 * CSS selector `[data-disabled]`, which matches any element that *has* the
 * attribute — including `data-disabled="false"`. This caused every option
 * in every cascade dashboard combobox to receive `pointer-events-none` and
 * `opacity-50`, making them visually greyed-out and impossible to click.
 *
 * The fix is `data-[disabled=true]:` which generates `[data-disabled="true"]`
 * and only activates when the item is explicitly disabled.
 *
 * This test reads the source directly (Combobox uses React hooks so it
 * cannot be called as a plain function outside a React rendering context,
 * and the unit environment has no jsdom). The source-read pattern follows
 * the precedent in `pm-wizard-styling-guard.test.ts`.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const COMBOBOX_PATH = resolve(REPO_ROOT, 'web/src/components/ui/combobox.tsx');

describe('Combobox — disabled-item CSS regression guard', () => {
	it('uses data-[disabled=true] not bare data-[disabled] for pointer-events', () => {
		const source = readFileSync(COMBOBOX_PATH, 'utf8');
		// Must NOT have the bare attribute selector — it matches data-disabled="false".
		expect(source, 'bare data-[disabled]: matches data-disabled="false" set by cmdk').not.toMatch(
			/data-\[disabled\]:pointer-events-none/,
		);
		// Must use the value-qualified selector — only fires when actually disabled.
		expect(source, 'data-[disabled=true]: must be present').toContain(
			'data-[disabled=true]:pointer-events-none',
		);
	});

	it('uses data-[disabled=true] not bare data-[disabled] for opacity', () => {
		const source = readFileSync(COMBOBOX_PATH, 'utf8');
		expect(source, 'bare data-[disabled]: matches data-disabled="false" set by cmdk').not.toMatch(
			/data-\[disabled\]:opacity-50/,
		);
		expect(source, 'data-[disabled=true]: must be present').toContain(
			'data-[disabled=true]:opacity-50',
		);
	});
});

describe('Combobox — name-search regression guard', () => {
	it('passes cmdk keywords (label + detail) on each CommandItem so name typing matches', () => {
		const source = readFileSync(COMBOBOX_PATH, 'utf8');
		// cmdk's default filter scores against the item's `value` PLUS `keywords`.
		// Without keywords, only `value` (e.g. the JIRA project key) is matched, so
		// operators typing a project *name* find nothing. This guard locks in the
		// keywords prop so a future refactor can't silently drop name-search.
		expect(
			source,
			'CommandItem must set keywords={...} so cmdk matches on label/detail, not just value',
		).toMatch(/keywords=\{/);
		expect(
			source,
			'keywords should include the visible label so typing the name matches',
		).toContain('option.label');
	});
});
