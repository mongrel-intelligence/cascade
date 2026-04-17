import { describe, expect, it } from 'vitest';
import {
	addItemToChecklist,
	appendChecklistSection,
	hashChecklistItemId,
	parseInlineChecklists,
	removeChecklistItem,
	toggleChecklistItem,
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
