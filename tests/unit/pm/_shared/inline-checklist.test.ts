import { describe, expect, it } from 'vitest';
import {
	addItemToChecklist,
	appendChecklistSection,
	hashChecklistItemId,
	parseInlineChecklists,
	removeChecklistItem,
	toggleChecklistItem,
	upsertChecklistSection,
	upsertItemToChecklist,
} from '../../../../src/pm/_shared/inline-checklist.js';

// ---------------------------------------------------------------------------
// hashChecklistItemId
// ---------------------------------------------------------------------------

describe('hashChecklistItemId', () => {
	it('returns a deterministic cl- prefixed hex ID', () => {
		const id = hashChecklistItemId('✅ Acceptance Criteria', 'Tests verify X');
		expect(id).toMatch(/^cl-[0-9a-f]{8}$/);
	});

	it('is stable across calls', () => {
		const a = hashChecklistItemId('AC', 'item');
		const b = hashChecklistItemId('AC', 'item');
		expect(a).toBe(b);
	});

	it('differs for different item text', () => {
		const a = hashChecklistItemId('AC', 'item A');
		const b = hashChecklistItemId('AC', 'item B');
		expect(a).not.toBe(b);
	});

	it('uses checklist name as namespace', () => {
		const a = hashChecklistItemId('Checklist A', 'same item');
		const b = hashChecklistItemId('Checklist B', 'same item');
		expect(a).not.toBe(b);
	});
});

// ---------------------------------------------------------------------------
// parseInlineChecklists
// ---------------------------------------------------------------------------

describe('parseInlineChecklists', () => {
	it('parses a single checklist section', () => {
		const desc = `Some description.

### ✅ Acceptance Criteria
- [ ] First criterion
- [x] Second criterion`;

		const result = parseInlineChecklists(desc);
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe('✅ Acceptance Criteria');
		expect(result[0].items).toHaveLength(2);
		expect(result[0].items[0]).toMatchObject({ name: 'First criterion', complete: false });
		expect(result[0].items[1]).toMatchObject({ name: 'Second criterion', complete: true });
		expect(result[0].items[0].id).toMatch(/^cl-[0-9a-f]{8}$/);
	});

	it('parses multiple checklist sections', () => {
		const desc = `### ✅ AC
- [ ] Item 1

### 🔗 Dependencies
- [x] Dep A
- [ ] Dep B`;

		const result = parseInlineChecklists(desc);
		expect(result).toHaveLength(2);
		expect(result[0].name).toBe('✅ AC');
		expect(result[0].items).toHaveLength(1);
		expect(result[1].name).toBe('🔗 Dependencies');
		expect(result[1].items).toHaveLength(2);
	});

	it('returns empty array for no checklist sections', () => {
		expect(parseInlineChecklists('Just some text.\n\nMore text.')).toEqual([]);
	});

	it('ignores headings without checkbox items', () => {
		const desc = `### Not a checklist
This is just a paragraph.

### ✅ Real Checklist
- [ ] Item`;

		const result = parseInlineChecklists(desc);
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe('✅ Real Checklist');
	});

	it('trims whitespace from item names', () => {
		const desc = `### AC
- [ ]   Spaced item  `;

		const result = parseInlineChecklists(desc);
		expect(result[0].items[0].name).toBe('Spaced item');
	});

	it('returns empty array for empty description', () => {
		expect(parseInlineChecklists('')).toEqual([]);
	});

	it('ignores non-h3 headings', () => {
		const desc = `## H2 heading
- [ ] Not captured

### H3 heading
- [ ] Captured`;

		const result = parseInlineChecklists(desc);
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe('H3 heading');
	});

	it('keeps parsing checklist items separated by rich markdown detail lines', () => {
		const desc = `### AC
- [ ] First
  Indented detail for first item.

Normal prose between rows.
- bullet detail that is not a checkbox
- [ ] Second

### Other
- [x] Third`;

		const result = parseInlineChecklists(desc);
		expect(result).toHaveLength(2);
		expect(result[0].items.map((item) => item.name)).toEqual(['First', 'Second']);
		expect(result[1].items.map((item) => item.name)).toEqual(['Third']);
	});
});

// ---------------------------------------------------------------------------
// appendChecklistSection
// ---------------------------------------------------------------------------

describe('appendChecklistSection', () => {
	it('appends to empty description', () => {
		const result = appendChecklistSection('', '✅ AC', [{ name: 'Item 1', checked: false }]);
		expect(result).toBe('### ✅ AC\n- [ ] Item 1');
	});

	it('appends after existing content with separator', () => {
		const result = appendChecklistSection('Existing text.', '✅ AC', [
			{ name: 'A', checked: false },
		]);
		expect(result).toBe('Existing text.\n\n### ✅ AC\n- [ ] A');
	});

	it('appends after an existing checklist section', () => {
		const existing = '### First\n- [ ] X';
		const result = appendChecklistSection(existing, 'Second', [{ name: 'Y', checked: true }]);
		expect(result).toBe('### First\n- [ ] X\n\n### Second\n- [x] Y');
	});

	it('handles checked and unchecked items', () => {
		const result = appendChecklistSection('', 'AC', [
			{ name: 'Done', checked: true },
			{ name: 'Pending', checked: false },
		]);
		expect(result).toBe('### AC\n- [x] Done\n- [ ] Pending');
	});

	it('produces heading only when items list is empty', () => {
		const result = appendChecklistSection('', 'Empty', []);
		expect(result).toBe('### Empty');
	});
});

// ---------------------------------------------------------------------------
// addItemToChecklist
// ---------------------------------------------------------------------------

describe('addItemToChecklist', () => {
	it('adds item to existing checklist section', () => {
		const desc = '### AC\n- [ ] Existing';
		const result = addItemToChecklist(desc, 'AC', 'New item');
		expect(result).toBe('### AC\n- [ ] Existing\n- [ ] New item');
	});

	it('throws when checklist section does not exist', () => {
		expect(() => addItemToChecklist('No checklist here.', 'AC', 'Item')).toThrow();
	});

	it('adds checked item with checked=true', () => {
		const desc = '### AC\n- [ ] First';
		const result = addItemToChecklist(desc, 'AC', 'Done item', true);
		expect(result).toBe('### AC\n- [ ] First\n- [x] Done item');
	});

	it('defaults to unchecked', () => {
		const desc = '### AC\n- [x] First';
		const result = addItemToChecklist(desc, 'AC', 'Unchecked');
		expect(result).toBe('### AC\n- [x] First\n- [ ] Unchecked');
	});

	it('adds after the last checkbox even when detail lines appear between rows', () => {
		const desc = '### AC\n- [ ] First\n  Detail\n- [ ] Second\n\n### Next\n- [ ] Other';
		const result = addItemToChecklist(desc, 'AC', 'Third');
		expect(result).toBe(
			'### AC\n- [ ] First\n  Detail\n- [ ] Second\n- [ ] Third\n\n### Next\n- [ ] Other',
		);
	});

	it('adds after trailing detail lines that follow the last checkbox', () => {
		// Regression: detail after the last checkbox must not be displaced under the new item.
		const desc = '### AC\n- [ ] First\n  Detail line';
		const result = addItemToChecklist(desc, 'AC', 'Second');
		expect(result).toBe('### AC\n- [ ] First\n  Detail line\n- [ ] Second');
	});
});

// ---------------------------------------------------------------------------
// toggleChecklistItem
// ---------------------------------------------------------------------------

describe('toggleChecklistItem', () => {
	const desc = '### AC\n- [ ] Item A\n- [x] Item B';

	it('toggles unchecked to checked', () => {
		const checklists = parseInlineChecklists(desc);
		const itemId = checklists[0].items[0].id;
		const result = toggleChecklistItem(desc, itemId, true, checklists);
		expect(result).toBe('### AC\n- [x] Item A\n- [x] Item B');
	});

	it('toggles checked to unchecked', () => {
		const checklists = parseInlineChecklists(desc);
		const itemId = checklists[0].items[1].id;
		const result = toggleChecklistItem(desc, itemId, false, checklists);
		expect(result).toBe('### AC\n- [ ] Item A\n- [ ] Item B');
	});

	it('throws when item ID not found', () => {
		const checklists = parseInlineChecklists(desc);
		expect(() => toggleChecklistItem(desc, 'cl-00000000', true, checklists)).toThrow();
	});

	it('toggles the right item when two checklists have same item text', () => {
		const multi = '### CL-A\n- [ ] Same\n\n### CL-B\n- [ ] Same';
		const checklists = parseInlineChecklists(multi);
		const idB = checklists[1].items[0].id;
		const result = toggleChecklistItem(multi, idB, true, checklists);
		expect(result).toContain('### CL-A\n- [ ] Same');
		expect(result).toContain('### CL-B\n- [x] Same');
	});

	it('toggles items after prose in the same checklist section', () => {
		const rich = '### AC\n- [ ] First\nPlain detail\n- [ ] Second';
		const checklists = parseInlineChecklists(rich);
		const result = toggleChecklistItem(rich, checklists[0].items[1].id, true, checklists);
		expect(result).toBe('### AC\n- [ ] First\nPlain detail\n- [x] Second');
	});
});

// ---------------------------------------------------------------------------
// removeChecklistItem
// ---------------------------------------------------------------------------

describe('removeChecklistItem', () => {
	it('removes an item from a checklist', () => {
		const desc = '### AC\n- [ ] Keep\n- [ ] Remove';
		const checklists = parseInlineChecklists(desc);
		const removeId = checklists[0].items[1].id;
		const result = removeChecklistItem(desc, removeId, checklists);
		expect(result).toBe('### AC\n- [ ] Keep');
	});

	it('removes section heading when last item is removed', () => {
		const desc = 'Intro text.\n\n### AC\n- [ ] Only item';
		const checklists = parseInlineChecklists(desc);
		const itemId = checklists[0].items[0].id;
		const result = removeChecklistItem(desc, itemId, checklists);
		expect(result).toBe('Intro text.');
	});

	it('throws when item ID not found', () => {
		const desc = '### AC\n- [ ] Item';
		const checklists = parseInlineChecklists(desc);
		expect(() => removeChecklistItem(desc, 'cl-00000000', checklists)).toThrow();
	});

	it('removes items after prose in the same checklist section', () => {
		const desc = '### AC\n- [ ] Keep\nSome detail\n- [ ] Remove\n\n### Next\n- [ ] Other';
		const checklists = parseInlineChecklists(desc);
		const result = removeChecklistItem(desc, checklists[0].items[1].id, checklists);
		expect(result).toBe('### AC\n- [ ] Keep\nSome detail\n\n### Next\n- [ ] Other');
	});

	it('removes the whole section including trailing detail when deleting the only item', () => {
		// Regression: detail lines after the sole checkbox must not be left orphaned.
		const desc = '### AC\n- [ ] Only\nDetail line\n\n### Next\n- [ ] Other';
		const checklists = parseInlineChecklists(desc);
		const result = removeChecklistItem(desc, checklists[0].items[0].id, checklists);
		expect(result).toBe('### Next\n- [ ] Other');
	});

	it('removes trailing detail lines when deleting a non-last item in a multi-item section', () => {
		// Regression: detail after a deleted checkbox in a multi-item section must not be left orphaned.
		const desc = '### AC\n- [ ] Remove\n  Detail for remove\n- [ ] Keep';
		const checklists = parseInlineChecklists(desc);
		const result = removeChecklistItem(desc, checklists[0].items[0].id, checklists);
		expect(result).toBe('### AC\n- [ ] Keep');
	});

	it('removes trailing detail lines when deleting the last item in a multi-item section', () => {
		// Regression: trailing detail after the last checkbox must not become attached to the previous item.
		const desc = '### AC\n- [ ] First\n- [ ] Last\n  Trailing detail';
		const checklists = parseInlineChecklists(desc);
		const result = removeChecklistItem(desc, checklists[0].items[1].id, checklists);
		expect(result).toBe('### AC\n- [ ] First');
	});
});

// ---------------------------------------------------------------------------
// Round-trip integration
// ---------------------------------------------------------------------------

describe('full round-trip', () => {
	it('append → parse → toggle → parse → remove → parse', () => {
		let desc = appendChecklistSection('Feature description.', '✅ AC', [
			{ name: 'Criterion A', checked: false },
			{ name: 'Criterion B', checked: false },
		]);

		let checklists = parseInlineChecklists(desc);
		expect(checklists).toHaveLength(1);
		expect(checklists[0].items).toHaveLength(2);
		const idA = checklists[0].items[0].id;
		const idB = checklists[0].items[1].id;

		desc = toggleChecklistItem(desc, idA, true, checklists);
		checklists = parseInlineChecklists(desc);
		expect(checklists[0].items[0].complete).toBe(true);
		expect(checklists[0].items[0].id).toBe(idA);
		expect(checklists[0].items[1].id).toBe(idB);

		desc = removeChecklistItem(desc, idB, checklists);
		checklists = parseInlineChecklists(desc);
		expect(checklists[0].items).toHaveLength(1);
		expect(checklists[0].items[0].id).toBe(idA);

		desc = removeChecklistItem(desc, idA, checklists);
		checklists = parseInlineChecklists(desc);
		expect(checklists).toHaveLength(0);
		expect(desc).toBe('Feature description.');
	});
});

// ---------------------------------------------------------------------------
// upsertChecklistSection
// ---------------------------------------------------------------------------

describe('upsertChecklistSection', () => {
	it('appends a new section when none exists — same result as appendChecklistSection', () => {
		const desc = 'Existing text.';
		const result = upsertChecklistSection(desc, '✅ AC', [{ name: 'Item', checked: false }]);
		expect(result).toBe('Existing text.\n\n### ✅ AC\n- [ ] Item');
	});

	it('returns description unchanged when a section with the same name already exists', () => {
		const desc = 'Existing text.\n\n### ✅ AC\n- [ ] Old item';
		const result = upsertChecklistSection(desc, '✅ AC', [{ name: 'New item', checked: false }]);
		// Section already present — idempotent, no duplicate heading added
		expect(result).toBe(desc);
		expect(result.split('\n').filter((l) => l === '### ✅ AC')).toHaveLength(1);
	});

	it('returns description unchanged for an empty existing section', () => {
		const desc = 'Existing text.\n\n### ✅ AC';
		const result = upsertChecklistSection(desc, '✅ AC', []);
		expect(result).toBe(desc);
	});

	it('appends a new section even when a different section already exists', () => {
		const desc = '### Other\n- [ ] Foo';
		const result = upsertChecklistSection(desc, '✅ AC', []);
		expect(result).toContain('### Other');
		expect(result).toContain('### ✅ AC');
	});
});

// ---------------------------------------------------------------------------
// upsertItemToChecklist
// ---------------------------------------------------------------------------

describe('upsertItemToChecklist', () => {
	it('appends a new item when it does not exist — same result as addItemToChecklist', () => {
		const desc = '### ✅ AC\n- [ ] Existing';
		const result = upsertItemToChecklist(desc, '✅ AC', 'New item');
		expect(result).toBe('### ✅ AC\n- [ ] Existing\n- [ ] New item');
	});

	it('returns description unchanged when the item already exists', () => {
		const desc = '### ✅ AC\n- [ ] Existing';
		const result = upsertItemToChecklist(desc, '✅ AC', 'Existing');
		expect(result).toBe(desc);
		expect(result.split('\n').filter((l) => l === '- [ ] Existing')).toHaveLength(1);
	});

	it('is case-sensitive: same text with different casing is treated as a new item', () => {
		const desc = '### ✅ AC\n- [ ] existing';
		const result = upsertItemToChecklist(desc, '✅ AC', 'Existing');
		expect(result).toContain('- [ ] existing');
		expect(result).toContain('- [ ] Existing');
	});

	it('respects checked state when appending a new item', () => {
		const desc = '### ✅ AC\n- [ ] First';
		const result = upsertItemToChecklist(desc, '✅ AC', 'Done', true);
		expect(result).toContain('- [x] Done');
	});
});
