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
	if (current) return { action: 'end-section' };
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
	const heading = `### ${checklistName}`;
	let insertIdx = -1;
	let inSection = false;

	for (let i = 0; i < lines.length; i++) {
		if (lines[i] === heading) {
			inSection = true;
			insertIdx = i;
			continue;
		}
		if (inSection) {
			if (CHECKBOX_REGEX.test(lines[i])) {
				insertIdx = i;
			} else if (lines[i].trim() !== '') {
				break;
			}
		}
	}

	if (insertIdx === -1) {
		throw new Error(`Checklist section "${checklistName}" not found in description`);
	}

	const newLine = `- [${checked ? 'x' : ' '}] ${itemName}`;
	lines.splice(insertIdx + 1, 0, newLine);
	return lines.join('\n');
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
		removeSectionBlock(lines, scan.headingIdx, scan.targetLineIdx);
	} else {
		lines.splice(scan.targetLineIdx, 1);
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
}

function scanSection(lines: string[], checklistName: string, targetItemName: string): SectionScan {
	const heading = `### ${checklistName}`;
	let headingIdx = -1;
	let targetLineIdx = -1;
	let inSection = false;
	let itemCount = 0;

	for (let i = 0; i < lines.length; i++) {
		if (lines[i] === heading) {
			inSection = true;
			headingIdx = i;
			continue;
		}
		if (!inSection) continue;
		const cbMatch = lines[i].match(CHECKBOX_REGEX);
		if (cbMatch) {
			itemCount++;
			if (cbMatch[2].trim() === targetItemName && targetLineIdx === -1) targetLineIdx = i;
		} else if (lines[i].trim() !== '') {
			break;
		}
	}

	return { headingIdx, targetLineIdx, itemCount };
}

function removeSectionBlock(lines: string[], headingIdx: number, lastItemIdx: number): void {
	let endIdx = lastItemIdx;
	while (endIdx + 1 < lines.length && lines[endIdx + 1].trim() === '') endIdx++;
	let startIdx = headingIdx;
	if (startIdx > 0 && lines[startIdx - 1].trim() === '') startIdx--;
	lines.splice(startIdx, endIdx - startIdx + 1);
}
