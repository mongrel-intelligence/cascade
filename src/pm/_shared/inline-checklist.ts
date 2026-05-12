import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedChecklistItem {
	id: string;
	name: string;
	complete: boolean;
}

export interface ParsedChecklist {
	name: string;
	items: ParsedChecklistItem[];
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

export function hashChecklistItemId(checklistName: string, itemText: string): string {
	const hash = createHash('sha256').update(`${checklistName}\0${itemText}`).digest('hex');
	return `cl-${hash.slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const H3_REGEX = /^### (.+)$/;
const HEADING_REGEX = /^#{1,6}\s+/;
const CHECKBOX_REGEX = /^- \[([ x])\] (.+)$/;

export function parseInlineChecklists(description: string): ParsedChecklist[] {
	if (!description) return [];

	const state: ParseState = { checklists: [], current: null };
	for (const line of description.split('\n')) {
		applyLineToParseState(state, classifyLine(line, state.current));
	}
	flushCurrent(state);
	return state.checklists;
}

export function checklistSectionContainsItems(
	description: string,
	checklistName: string,
	items: { name: string; checked?: boolean }[],
): boolean {
	const deduped = dedupeChecklistSections(description, checklistName);
	const section = findChecklistSection(deduped.split('\n'), checklistName);
	if (!section) return false;
	const sectionItems = collectSectionItems(deduped.split('\n'), section);
	return items.every((item) => {
		const actual = sectionItems.get(item.name);
		if (actual === undefined) return false;
		return item.checked === undefined || actual === item.checked || actual === true;
	});
}

export function checklistItemStateSatisfied(
	description: string,
	checklistName: string,
	itemName: string,
	checked: boolean,
): boolean {
	const deduped = dedupeChecklistSections(description, checklistName);
	const section = findChecklistSection(deduped.split('\n'), checklistName);
	if (!section) return false;
	return collectSectionItems(deduped.split('\n'), section).get(itemName) === checked;
}

interface ParseState {
	checklists: ParsedChecklist[];
	current: ParsedChecklist | null;
}

function applyLineToParseState(state: ParseState, action: LineClassification): void {
	switch (action.action) {
		case 'new-section':
			flushCurrent(state);
			state.current = { name: action.name, items: [] };
			return;
		case 'add-item':
			state.current?.items.push(action.item);
			return;
		case 'end-section':
			flushCurrent(state);
			state.current = null;
			return;
		case 'skip':
			return;
	}
}

function flushCurrent(state: ParseState): void {
	if (state.current && state.current.items.length > 0) {
		state.checklists.push(state.current);
	}
}

type LineClassification =
	| { action: 'new-section'; name: string }
	| { action: 'add-item'; item: ParsedChecklistItem }
	| { action: 'end-section' }
	| { action: 'skip' };

function classifyLine(line: string, current: { name: string } | null): LineClassification {
	const h3Match = line.match(H3_REGEX);
	if (h3Match) return { action: 'new-section', name: h3Match[1] };

	if (current && HEADING_REGEX.test(line)) return { action: 'end-section' };

	const cbMatch = line.match(CHECKBOX_REGEX);
	if (cbMatch && current) {
		const name = cbMatch[2].trim();
		return {
			action: 'add-item',
			item: {
				id: hashChecklistItemId(current.name, name),
				name,
				complete: cbMatch[1] === 'x',
			},
		};
	}

	if (current && line.trim() === '') return { action: 'skip' };
	if (current) return { action: 'skip' };
	return { action: 'skip' };
}

// ---------------------------------------------------------------------------
// Synthetic checklist ID helpers (shared by JIRA and Linear adapters)
// ---------------------------------------------------------------------------

/**
 * Prefix used to construct synthetic checklist IDs for inline-markdown
 * providers (JIRA and Linear).  Format: `inline-<workItemId>-<nameHash>`.
 */
export const INLINE_CHECKLIST_ID_PREFIX = 'inline-';

/**
 * Build a synthetic checklist ID that encodes the work-item ID and a
 * stable 8-char hash of the checklist name.
 */
export function buildChecklistId(workItemId: string, checklistName: string): string {
	const hash = hashChecklistItemId('', checklistName).slice(3); // strip 'cl-' prefix
	return `${INLINE_CHECKLIST_ID_PREFIX}${workItemId}-${hash}`;
}

/**
 * Parse a synthetic checklist ID back into its constituent parts.
 * Returns `null` when the ID does not follow the `inline-` format.
 */
export function parseChecklistId(
	checklistId: string,
): { workItemId: string; nameHash: string } | null {
	if (!checklistId.startsWith(INLINE_CHECKLIST_ID_PREFIX)) return null;
	const rest = checklistId.slice(INLINE_CHECKLIST_ID_PREFIX.length);
	// Last segment is 8-char hex hash; everything before is the workItemId
	const m = rest.match(/^(.+)-([0-9a-f]{8})$/);
	if (!m) return null;
	return { workItemId: m[1], nameHash: m[2] };
}

// ---------------------------------------------------------------------------
// Find a checklist section name by hash (includes empty sections)
// ---------------------------------------------------------------------------

/**
 * Returns the name of the first `### ` heading in `description` whose hash of
 * its name (via `hashChecklistItemId('', name).slice(3)`) matches `nameHash`.
 * Useful for finding empty checklist sections that the parser drops.
 */
export function findChecklistNameByHash(description: string, nameHash: string): string | null {
	if (!description) return null;
	for (const line of description.split('\n')) {
		const m = line.match(H3_REGEX);
		if (m) {
			const name = m[1];
			if (hashChecklistItemId('', name).slice(3) === nameHash) return name;
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Appending a new checklist section
// ---------------------------------------------------------------------------

export function appendChecklistSection(
	description: string,
	checklistName: string,
	items: { name: string; checked: boolean }[],
): string {
	const lines: string[] = [`### ${checklistName}`];
	for (const item of items) {
		lines.push(`- [${item.checked ? 'x' : ' '}] ${item.name}`);
	}
	const section = lines.join('\n');

	if (!description) return section;
	return `${description.trimEnd()}\n\n${section}`;
}

export function upsertChecklistSection(
	description: string,
	checklistName: string,
	items: { name: string; checked: boolean }[],
): string {
	const deduped = dedupeChecklistSections(description, checklistName);
	const lines = deduped ? deduped.split('\n') : [];
	const section = findChecklistSection(lines, checklistName);

	if (!section) {
		return appendChecklistSection(deduped, checklistName, items);
	}

	if (items.length === 0) return deduped;
	return dedupeChecklistSections(
		appendChecklistSection(deduped, checklistName, items),
		checklistName,
	);
}

// ---------------------------------------------------------------------------
// Adding a single item
// ---------------------------------------------------------------------------

export function addItemToChecklist(
	description: string,
	checklistName: string,
	itemName: string,
	checked = false,
): string {
	const lines = description.split('\n');
	const insertIdx = findChecklistInsertionIndex(lines, checklistName);
	if (insertIdx === -1) {
		throw new Error(`Checklist section "${checklistName}" not found in description`);
	}

	const newLine = `- [${checked ? 'x' : ' '}] ${itemName}`;
	lines.splice(insertIdx + 1, 0, newLine);
	return lines.join('\n');
}

export function upsertItemInChecklist(
	description: string,
	checklistName: string,
	itemName: string,
	checked = false,
): string {
	const deduped = dedupeChecklistSections(description, checklistName);
	const lines = deduped.split('\n');
	const section = findChecklistSection(lines, checklistName);
	if (!section) {
		throw new Error(`Checklist section "${checklistName}" not found in description`);
	}

	const existing = findItemLineInSection(lines, section, itemName);
	if (existing !== -1) {
		const existingChecked = lines[existing].match(CHECKBOX_REGEX)?.[1] === 'x';
		if (checked && !existingChecked) {
			lines[existing] = `- [x] ${itemName}`;
		}
		return lines.join('\n');
	}

	return addItemToChecklist(deduped, checklistName, itemName, checked);
}

// ---------------------------------------------------------------------------
// Toggling an item
// ---------------------------------------------------------------------------

export function toggleChecklistItem(
	description: string,
	itemId: string,
	complete: boolean,
	checklists: ParsedChecklist[],
): string {
	const target = findItemById(itemId, checklists);
	if (!target) throw new Error(`Checklist item not found: ${itemId}`);

	return replaceCheckboxLine(description, target.checklistName, target.item.name, complete);
}

// ---------------------------------------------------------------------------
// Removing an item
// ---------------------------------------------------------------------------

export function removeChecklistItem(
	description: string,
	itemId: string,
	checklists: ParsedChecklist[],
): string {
	const target = findItemById(itemId, checklists);
	if (!target) throw new Error(`Checklist item not found: ${itemId}`);

	const lines = description.split('\n');
	const scan = scanSection(lines, target.checklistName, target.item.name);
	if (scan.targetLineIdx === -1) throw new Error(`Checklist item line not found: ${itemId}`);

	if (scan.itemCount === 1) {
		// Remove the entire section: use lastContentIdx so trailing detail lines
		// after the only checkbox are included and not left orphaned.
		const sectionEnd = scan.lastContentIdx !== -1 ? scan.lastContentIdx : scan.targetLineIdx;
		removeSectionBlock(lines, scan.headingIdx, sectionEnd);
	} else {
		// Also remove detail/prose lines immediately following the deleted checkbox
		// (up to the next checkbox, heading, or blank line) so they aren't orphaned.
		let deleteEnd = scan.targetLineIdx;
		for (let i = scan.targetLineIdx + 1; i < lines.length; i++) {
			if (HEADING_REGEX.test(lines[i]) || CHECKBOX_REGEX.test(lines[i]) || lines[i].trim() === '') {
				break;
			}
			deleteEnd = i;
		}
		lines.splice(scan.targetLineIdx, deleteEnd - scan.targetLineIdx + 1);
	}

	return lines.join('\n').trimEnd();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findItemById(
	itemId: string,
	checklists: ParsedChecklist[],
): { checklistName: string; item: ParsedChecklistItem } | null {
	for (const cl of checklists) {
		for (const item of cl.items) {
			if (item.id === itemId) return { checklistName: cl.name, item };
		}
	}
	return null;
}

function replaceCheckboxLine(
	description: string,
	checklistName: string,
	itemName: string,
	complete: boolean,
): string {
	const lines = description.split('\n');
	const scan = scanSection(lines, checklistName, itemName);
	if (scan.targetLineIdx === -1) {
		throw new Error(`Could not find checkbox line for "${itemName}" in section "${checklistName}"`);
	}
	lines[scan.targetLineIdx] = `- [${complete ? 'x' : ' '}] ${itemName}`;
	return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Section scanning
// ---------------------------------------------------------------------------

interface SectionScan {
	headingIdx: number;
	targetLineIdx: number;
	itemCount: number;
	/** Index of the last non-empty line in the section (may be a detail line after the last checkbox). */
	lastContentIdx: number;
}

interface ChecklistSectionSpan {
	name: string;
	startIdx: number;
	endIdx: number;
}

/**
 * An item collected during duplicate-section merging, carrying both its
 * checked state and any trailing detail/prose lines that belong to it
 * (non-blank, non-checkbox, non-heading lines immediately following the
 * checkbox with no blank-line gap).
 */
interface MergedItemInfo {
	checked: boolean;
	/** Detail/prose lines immediately following this item's checkbox row. */
	detail: string[];
}

function dedupeChecklistSections(description: string, checklistName: string): string {
	if (!description) return description;
	const lines = description.split('\n');
	const sections = scanChecklistSections(lines).filter((section) => section.name === checklistName);
	if (sections.length <= 1) return description;

	const first = sections[0];
	// Track items already in the first section so we know which items from
	// duplicate sections are "new" (need to be inserted with their detail)
	// vs "existing" (detail would be orphaned and should be preserved as prose).
	const firstSectionItems = new Set(collectSectionItems(lines, first).keys());
	const mergedItems = collectMergedSectionItemsWithDetail(lines, sections);
	const { lines: rewrittenLines, detailEmittedForItems } = rewriteChecklistSection(
		lines.slice(first.startIdx, first.endIdx),
		mergedItems,
	);
	return removeDuplicateChecklistSections(
		lines,
		sections,
		rewrittenLines,
		firstSectionItems,
		detailEmittedForItems,
	);
}

function findChecklistInsertionIndex(lines: string[], checklistName: string): number {
	const heading = `### ${checklistName}`;
	let insertIdx = -1;
	let inSection = false;

	for (let i = 0; i < lines.length; i++) {
		if (lines[i] === heading) {
			inSection = true;
			insertIdx = i;
			continue;
		}
		if (!inSection) continue;
		if (CHECKBOX_REGEX.test(lines[i])) {
			insertIdx = i;
		} else if (HEADING_REGEX.test(lines[i])) {
			break;
		} else if (lines[i].trim() !== '') {
			// Non-empty detail/prose line — advance insertIdx so new items land
			// after all trailing detail belonging to the previous item, not before it.
			insertIdx = i;
		}
	}

	return insertIdx;
}

/**
 * Collect all items from a single section, each with trailing detail lines.
 *
 * A "detail line" is any non-blank, non-checkbox, non-heading line that
 * immediately follows a checkbox with no blank-line gap between them.  These
 * are treated as belonging to their preceding item and must travel with it
 * when the section is merged elsewhere.
 */
function collectSectionItemsWithDetail(
	lines: string[],
	section: ChecklistSectionSpan,
): Map<string, MergedItemInfo> {
	const items = new Map<string, MergedItemInfo>();
	let currentName: string | null = null;
	for (let i = section.startIdx + 1; i < section.endIdx; i++) {
		const line = lines[i];
		const cbMatch = line.match(CHECKBOX_REGEX);
		if (cbMatch) {
			currentName = cbMatch[2].trim();
			const checked = cbMatch[1] === 'x';
			const existing = items.get(currentName);
			if (!existing) {
				items.set(currentName, { checked, detail: [] });
			} else if (checked) {
				existing.checked = true;
			}
		} else if (HEADING_REGEX.test(line)) {
			break;
		} else if (currentName !== null) {
			if (line.trim() === '') {
				currentName = null; // blank line ends detail attachment
			} else {
				items.get(currentName)?.detail.push(line);
			}
		}
	}
	return items;
}

function collectMergedSectionItemsWithDetail(
	lines: string[],
	sections: ChecklistSectionSpan[],
): Map<string, MergedItemInfo> {
	const merged = new Map<string, MergedItemInfo>();
	for (const section of sections) {
		for (const [name, info] of collectSectionItemsWithDetail(lines, section)) {
			const existing = merged.get(name);
			if (!existing) {
				// First occurrence — keep its checked state and detail.
				merged.set(name, { checked: info.checked, detail: info.detail });
			} else {
				// Subsequent occurrence — merge checked state (any checked wins).
				if (info.checked) existing.checked = true;
				// Detail: first non-empty occurrence wins to avoid duplicating detail.
				if (existing.detail.length === 0 && info.detail.length > 0) {
					existing.detail.push(...info.detail);
				}
			}
		}
	}
	return merged;
}

function rewriteChecklistSection(
	sectionLines: string[],
	mergedItems: Map<string, MergedItemInfo>,
): { lines: string[]; detailEmittedForItems: Set<string> } {
	// Pre-scan section1 to know which items already carry their own detail inline
	// (a non-blank, non-heading line immediately following the checkbox with no
	// blank gap).  Items in this set keep their detail from sectionLines; items
	// NOT in this set receive their detail (if any) from mergedItems so that
	// detail contributed only by a duplicate section stays attached to the item.
	const section1ItemsWithDetail = collectItemsWithDetailFromSection(sectionLines);
	const detailEmittedForItems = new Set<string>();
	const state = { lines: [] as string[], seen: new Set<string>(), lastCheckboxIdx: -1 };
	for (const line of sectionLines) {
		rewriteChecklistSectionLine(
			state,
			line,
			mergedItems,
			section1ItemsWithDetail,
			detailEmittedForItems,
		);
	}
	insertMissingChecklistItemLines(state, mergedItems);
	return { lines: state.lines, detailEmittedForItems };
}

/**
 * Return the set of item names in `sectionLines` that have at least one
 * non-blank detail/prose line immediately following their checkbox (no
 * blank-line gap).  Used to distinguish items whose detail already lives in
 * section 1 (leave it in-place) from items whose detail must be pulled from
 * `mergedItems` (emit inline to keep it attached).
 */
function collectItemsWithDetailFromSection(sectionLines: string[]): Set<string> {
	const withDetail = new Set<string>();
	let currentItem: string | null = null;
	for (let i = 1; i < sectionLines.length; i++) {
		const line = sectionLines[i];
		const cb = line.match(CHECKBOX_REGEX);
		if (cb) {
			currentItem = cb[2].trim();
		} else if (HEADING_REGEX.test(line)) {
			break;
		} else if (currentItem !== null) {
			if (line.trim() === '') {
				currentItem = null;
			} else {
				withDetail.add(currentItem);
			}
		}
	}
	return withDetail;
}

function rewriteChecklistSectionLine(
	state: { lines: string[]; seen: Set<string>; lastCheckboxIdx: number },
	line: string,
	mergedItems: Map<string, MergedItemInfo>,
	section1ItemsWithDetail: Set<string>,
	detailEmittedForItems: Set<string>,
): void {
	const cbMatch = line.match(CHECKBOX_REGEX);
	if (!cbMatch) {
		state.lines.push(line);
		return;
	}
	const itemName = cbMatch[2].trim();
	if (state.seen.has(itemName)) return;
	state.seen.add(itemName);
	const info = mergedItems.get(itemName);
	const checked = (info?.checked ?? false) || cbMatch[1] === 'x';
	state.lines.push(`- [${checked ? 'x' : ' '}] ${itemName}`);
	state.lastCheckboxIdx = state.lines.length - 1;
	// If the item has no detail in section1 but mergedItems carries detail
	// (contributed by a duplicate section), emit it now so the detail stays
	// attached to this item rather than surfacing later as orphaned prose.
	if (!section1ItemsWithDetail.has(itemName) && info?.detail && info.detail.length > 0) {
		for (const dl of info.detail) {
			state.lines.push(dl);
		}
		detailEmittedForItems.add(itemName);
	}
	// Otherwise: detail comes from the source sectionLines on subsequent
	// iterations (preserved in-place).
}

/**
 * Find where to splice new checkbox rows after the last existing checkbox.
 *
 * We scan forward past any non-blank detail/prose lines that immediately follow
 * `lastCheckboxIdx` and stop at the first blank line (section boundary). This
 * ensures newly-merged rows land *after* detail belonging to the previous item,
 * not before it — which would visually re-attribute those detail lines to the
 * wrong (newly-inserted) item.
 */
function findMissingItemsInsertionIndex(lines: string[], lastCheckboxIdx: number): number {
	if (lastCheckboxIdx === -1) {
		return 1; // No checkboxes yet; insert right after the heading.
	}
	let insertIdx = lastCheckboxIdx;
	for (let i = lastCheckboxIdx + 1; i < lines.length; i++) {
		if (lines[i].trim() !== '') {
			insertIdx = i; // Non-blank detail/prose line — advance past it.
		} else {
			break; // Blank line — stop; don't cross section boundaries.
		}
	}
	return insertIdx + 1;
}

function insertMissingChecklistItemLines(
	state: { lines: string[]; seen: Set<string>; lastCheckboxIdx: number },
	mergedItems: Map<string, MergedItemInfo>,
): void {
	const missingItemLines: string[] = [];
	for (const [itemName, info] of mergedItems) {
		if (!state.seen.has(itemName)) {
			missingItemLines.push(`- [${info.checked ? 'x' : ' '}] ${itemName}`);
			// Carry the item's detail lines immediately after its checkbox so they
			// remain attached to the item rather than becoming orphaned prose.
			missingItemLines.push(...info.detail);
		}
	}
	if (missingItemLines.length > 0) {
		const insertIdx = findMissingItemsInsertionIndex(state.lines, state.lastCheckboxIdx);
		state.lines.splice(insertIdx, 0, ...missingItemLines);
	}
}

function removeDuplicateChecklistSections(
	lines: string[],
	sections: ChecklistSectionSpan[],
	rewrittenFirstSection: string[],
	firstSectionItems: Set<string>,
	detailEmittedForItems: Set<string>,
): string {
	const first = sections[0];
	const output: string[] = [];
	for (let i = 0; i < lines.length; ) {
		if (i === first.startIdx) {
			output.push(...rewrittenFirstSection);
			i = first.endIdx;
			continue;
		}
		const duplicate = findSectionStartingAt(sections, i);
		if (duplicate) {
			i = skipRemovedDuplicateSection(
				lines,
				output,
				duplicate,
				firstSectionItems,
				detailEmittedForItems,
			);
			continue;
		}
		output.push(lines[i]);
		i++;
	}

	return output.join('\n').trimEnd();
}

function findSectionStartingAt(
	sections: ChecklistSectionSpan[],
	lineIdx: number,
): ChecklistSectionSpan | undefined {
	return sections.find((section) => section.startIdx === lineIdx);
}

/**
 * Skip a duplicate checklist section during convergence, selectively
 * preserving content that can't be safely re-attached to merged items.
 *
 * Checkbox rows are dropped (they've been merged into the first section
 * rewrite).  The heading itself is also dropped.  What we keep:
 *
 * - Detail lines of EXISTING items whose detail was NOT already emitted
 *   inline in the first-section rewrite: since those items are not being
 *   re-inserted, their detail cannot travel with them and is preserved as
 *   prose.  Items whose detail WAS emitted inline (tracked in
 *   `detailEmittedForItems`) are skipped to avoid duplication.
 *
 * - Truly standalone prose: non-checkbox lines that appear before the
 *   first checkbox or after a blank-line separator (not attached to any
 *   checkbox item).
 *
 * Detail lines of NEW items (items NOT in firstSectionItems) are skipped —
 * they are emitted alongside their checkbox row by insertMissingChecklistItemLines.
 */
function skipRemovedDuplicateSection(
	lines: string[],
	output: string[],
	duplicate: ChecklistSectionSpan,
	firstSectionItems: Set<string>,
	detailEmittedForItems: Set<string>,
): number {
	const proseLines: string[] = [];
	let currentItemName: string | null = null;
	let currentItemIsNew = false;

	for (let i = duplicate.startIdx + 1; i < duplicate.endIdx; i++) {
		const line = lines[i];
		const cbMatch = line.match(CHECKBOX_REGEX);
		if (cbMatch) {
			currentItemName = cbMatch[2].trim();
			// "New" items (not in the first section) are inserted into section 1
			// by insertMissingChecklistItemLines; their detail travels with them.
			currentItemIsNew = !firstSectionItems.has(currentItemName);
		} else if (HEADING_REGEX.test(line)) {
			break;
		} else if (line.trim() === '') {
			// Blank line — end of any item's detail attachment.
			currentItemName = null;
			currentItemIsNew = false;
		} else if (currentItemName === null) {
			// Standalone prose before the first checkbox (or after a blank gap).
			proseLines.push(line);
		} else if (!currentItemIsNew && !detailEmittedForItems.has(currentItemName)) {
			// Detail line of an EXISTING item — preserve as prose ONLY when the
			// detail was NOT already emitted inline in the rewritten first section.
			// (Items in detailEmittedForItems had their detail pulled from
			// mergedItems and emitted right after their checkbox — re-emitting
			// here would duplicate or orphan that detail.)
			proseLines.push(line);
		}
		// else: detail of a NEW item (emitted by insertMissingChecklistItemLines),
		// or detail of an existing item already emitted inline in section 1.
	}

	// Trim leading/trailing blank lines so we don't emit orphaned whitespace.
	while (proseLines.length > 0 && proseLines[0].trim() === '') proseLines.shift();
	while (proseLines.length > 0 && proseLines[proseLines.length - 1].trim() === '') proseLines.pop();

	while (output.length > 0 && output[output.length - 1].trim() === '') output.pop();

	if (proseLines.length > 0) {
		// Preserve prose from the duplicate section after the merged content.
		output.push('');
		output.push(...proseLines);
	}

	let nextIdx = duplicate.endIdx;
	while (nextIdx < lines.length && lines[nextIdx].trim() === '') nextIdx++;
	if (nextIdx < lines.length && output.length > 0 && output[output.length - 1].trim() !== '') {
		output.push('');
	}
	return nextIdx;
}

function scanChecklistSections(lines: string[]): ChecklistSectionSpan[] {
	const sections: ChecklistSectionSpan[] = [];
	for (let i = 0; i < lines.length; i++) {
		const match = lines[i].match(H3_REGEX);
		if (!match) continue;
		let endIdx = lines.length;
		for (let j = i + 1; j < lines.length; j++) {
			if (HEADING_REGEX.test(lines[j])) {
				endIdx = j;
				break;
			}
		}
		sections.push({ name: match[1], startIdx: i, endIdx });
	}
	return sections;
}

function findChecklistSection(lines: string[], checklistName: string): ChecklistSectionSpan | null {
	return scanChecklistSections(lines).find((section) => section.name === checklistName) ?? null;
}

function collectSectionItems(lines: string[], section: ChecklistSectionSpan): Map<string, boolean> {
	const items = new Map<string, boolean>();
	for (let i = section.startIdx + 1; i < section.endIdx; i++) {
		const match = lines[i].match(CHECKBOX_REGEX);
		if (!match) continue;
		const name = match[2].trim();
		items.set(name, (items.get(name) ?? false) || match[1] === 'x');
	}
	return items;
}

function findItemLineInSection(
	lines: string[],
	section: ChecklistSectionSpan,
	itemName: string,
): number {
	for (let i = section.startIdx + 1; i < section.endIdx; i++) {
		const match = lines[i].match(CHECKBOX_REGEX);
		if (match && match[2].trim() === itemName) return i;
	}
	return -1;
}

function scanSection(lines: string[], checklistName: string, targetItemName: string): SectionScan {
	const heading = `### ${checklistName}`;
	let headingIdx = -1;
	let targetLineIdx = -1;
	let inSection = false;
	let itemCount = 0;
	let lastContentIdx = -1;

	for (let i = 0; i < lines.length; i++) {
		if (lines[i] === heading) {
			inSection = true;
			headingIdx = i;
			continue;
		}
		if (!inSection) continue;
		if (HEADING_REGEX.test(lines[i])) break;
		const cbMatch = lines[i].match(CHECKBOX_REGEX);
		if (cbMatch) {
			itemCount++;
			if (cbMatch[2].trim() === targetItemName && targetLineIdx === -1) targetLineIdx = i;
		}
		if (lines[i].trim() !== '') {
			lastContentIdx = i;
		}
	}

	return { headingIdx, targetLineIdx, itemCount, lastContentIdx };
}

function removeSectionBlock(lines: string[], headingIdx: number, lastItemIdx: number): void {
	let endIdx = lastItemIdx;
	while (endIdx + 1 < lines.length && lines[endIdx + 1].trim() === '') endIdx++;
	let startIdx = headingIdx;
	if (startIdx > 0 && lines[startIdx - 1].trim() === '') startIdx--;
	lines.splice(startIdx, endIdx - startIdx + 1);
}
