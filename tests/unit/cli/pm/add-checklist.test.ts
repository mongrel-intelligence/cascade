import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockPMProvider } from '../../../helpers/mockPMProvider.js';

const mockProvider = createMockPMProvider();

vi.mock('../../../../src/pm/index.js', () => ({
	getPMProvider: vi.fn(() => mockProvider),
}));

// Import after mocks so the module picks up the mocked getPMProvider
import { parseItem } from '../../../../src/cli/pm/add-checklist.js';
import { addChecklist } from '../../../../src/gadgets/pm/core/addChecklist.js';
import { writePMWriteSidecar } from '../../../../src/gadgets/session/core/sidecar.js';

// ---------------------------------------------------------------------------
// Unit tests for parseItem() — the JSON-parsing helper
// ---------------------------------------------------------------------------

describe('parseItem', () => {
	it('returns a plain string unchanged', () => {
		expect(parseItem('Simple task')).toBe('Simple task');
	});

	it('returns empty string unchanged', () => {
		expect(parseItem('')).toBe('');
	});

	it('parses JSON with name and description into an object', () => {
		const raw = JSON.stringify({ name: 'Extract input types', description: 'Create types file' });
		expect(parseItem(raw)).toEqual({
			name: 'Extract input types',
			description: 'Create types file',
		});
	});

	it('parses JSON with name only (no description)', () => {
		const raw = JSON.stringify({ name: 'Write tests' });
		expect(parseItem(raw)).toEqual({ name: 'Write tests' });
	});

	it('keeps raw string for invalid JSON', () => {
		const raw = '{not valid json}';
		expect(parseItem(raw)).toBe(raw);
	});

	it('keeps raw string when JSON has no name property', () => {
		const raw = JSON.stringify({ foo: 'bar' });
		expect(parseItem(raw)).toBe(raw);
	});

	it('keeps raw string when JSON name is not a string', () => {
		const raw = JSON.stringify({ name: 42 });
		expect(parseItem(raw)).toBe(raw);
	});

	it('keeps raw string for a JSON array', () => {
		const raw = JSON.stringify(['step 1', 'step 2']);
		expect(parseItem(raw)).toBe(raw);
	});

	it('keeps raw string for a JSON primitive (number)', () => {
		const raw = '123';
		expect(parseItem(raw)).toBe(raw);
	});

	it('keeps raw string for a JSON primitive (boolean)', () => {
		const raw = 'true';
		expect(parseItem(raw)).toBe(raw);
	});

	it('keeps raw string when description is not a string (ignores non-string description)', () => {
		// description must be string; if it's not, it should be omitted
		const raw = JSON.stringify({ name: 'Task', description: 99 });
		expect(parseItem(raw)).toEqual({ name: 'Task' });
	});

	it('parses a string that looks like JSON but is a nested JSON status field unchanged', () => {
		// A JSON object without "name" stays as-is
		const raw = JSON.stringify({ status: 'pending' });
		expect(parseItem(raw)).toBe(raw);
	});
});

// ---------------------------------------------------------------------------
// Integration tests via addChecklist() — verifying end-to-end item handling
// ---------------------------------------------------------------------------

describe('addChecklist with JSON --item strings (CLI integration)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('passes parsed JSON items with name+description to addChecklistItem', async () => {
		mockProvider.createChecklist.mockResolvedValue({
			id: 'cl1',
			name: 'Subtasks',
			workItemId: 'PROJ-1',
			items: [],
		});
		mockProvider.addChecklistItem.mockResolvedValue(undefined);

		const rawItems = [
			JSON.stringify({
				name: 'Extract input types',
				description: 'Create types/service-input.types.ts',
			}),
			JSON.stringify({ name: 'Update imports', description: 'Fix circular deps' }),
		];

		await addChecklist({
			workItemId: 'PROJ-1',
			checklistName: 'Subtasks',
			items: rawItems.map(parseItem),
		});

		expect(mockProvider.addChecklistItem).toHaveBeenCalledWith(
			'cl1',
			'Extract input types',
			false,
			'Create types/service-input.types.ts',
		);
		expect(mockProvider.addChecklistItem).toHaveBeenCalledWith(
			'cl1',
			'Update imports',
			false,
			'Fix circular deps',
		);
	});

	it('passes plain string items unchanged', async () => {
		mockProvider.createChecklist.mockResolvedValue({
			id: 'cl1',
			name: 'Tasks',
			workItemId: 'PROJ-2',
			items: [],
		});
		mockProvider.addChecklistItem.mockResolvedValue(undefined);

		await addChecklist({
			workItemId: 'PROJ-2',
			checklistName: 'Tasks',
			items: ['Plain task A', 'Plain task B'].map(parseItem),
		});

		expect(mockProvider.addChecklistItem).toHaveBeenCalledWith(
			'cl1',
			'Plain task A',
			false,
			undefined,
		);
		expect(mockProvider.addChecklistItem).toHaveBeenCalledWith(
			'cl1',
			'Plain task B',
			false,
			undefined,
		);
	});

	it('handles mixed plain strings and JSON objects', async () => {
		mockProvider.createChecklist.mockResolvedValue({
			id: 'cl1',
			name: 'Mixed',
			workItemId: 'PROJ-3',
			items: [],
		});
		mockProvider.addChecklistItem.mockResolvedValue(undefined);

		const rawItems = [
			'Plain string item',
			JSON.stringify({ name: 'JSON item', description: 'Details here' }),
			'Another plain item',
		];

		await addChecklist({
			workItemId: 'PROJ-3',
			checklistName: 'Mixed',
			items: rawItems.map(parseItem),
		});

		expect(mockProvider.addChecklistItem).toHaveBeenCalledTimes(3);
		expect(mockProvider.addChecklistItem).toHaveBeenCalledWith(
			'cl1',
			'Plain string item',
			false,
			undefined,
		);
		expect(mockProvider.addChecklistItem).toHaveBeenCalledWith(
			'cl1',
			'JSON item',
			false,
			'Details here',
		);
		expect(mockProvider.addChecklistItem).toHaveBeenCalledWith(
			'cl1',
			'Another plain item',
			false,
			undefined,
		);
	});

	it('keeps unparseable JSON strings as raw item names (backward compat)', async () => {
		mockProvider.createChecklist.mockResolvedValue({
			id: 'cl1',
			name: 'Tasks',
			workItemId: 'PROJ-4',
			items: [],
		});
		mockProvider.addChecklistItem.mockResolvedValue(undefined);

		const badJson = '{not: valid}';
		await addChecklist({
			workItemId: 'PROJ-4',
			checklistName: 'Tasks',
			items: [badJson].map(parseItem),
		});

		expect(mockProvider.addChecklistItem).toHaveBeenCalledWith(
			'cl1',
			'{not: valid}',
			false,
			undefined,
		);
	});

	it('keeps JSON without name property as a raw string', async () => {
		mockProvider.createChecklist.mockResolvedValue({
			id: 'cl1',
			name: 'Tasks',
			workItemId: 'PROJ-5',
			items: [],
		});
		mockProvider.addChecklistItem.mockResolvedValue(undefined);

		const raw = JSON.stringify({ status: 'pending', priority: 'high' });
		await addChecklist({
			workItemId: 'PROJ-5',
			checklistName: 'Tasks',
			items: [raw].map(parseItem),
		});

		expect(mockProvider.addChecklistItem).toHaveBeenCalledWith('cl1', raw, false, undefined);
	});
});

// ---------------------------------------------------------------------------
// Tests for writePMWriteSidecar
// ---------------------------------------------------------------------------

describe('writePMWriteSidecar', () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), 'cascade-sidecar-test-'));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
		Reflect.deleteProperty(process.env, 'CASCADE_PM_WRITE_SIDECAR_PATH');
	});

	it('writes sidecar file with correct JSON when path is set', () => {
		const sidecarPath = join(tmpDir, 'pm-write.json');

		const result = writePMWriteSidecar(sidecarPath, 'card-xyz');

		expect(result).toBe(true);
		expect(existsSync(sidecarPath)).toBe(true);
		const written = JSON.parse(readFileSync(sidecarPath, 'utf-8')) as Record<string, unknown>;
		expect(written.written).toBe(true);
		expect(written.command).toBe('add-checklist');
		expect(written.workItemId).toBe('card-xyz');
		expect(typeof written.timestamp).toBe('string');
	});

	it('does not write sidecar when path is undefined', () => {
		const result = writePMWriteSidecar(undefined, 'card-xyz');

		expect(result).toBe(false);
	});

	it('does not write sidecar when path is the string "undefined"', () => {
		const result = writePMWriteSidecar('undefined', 'card-xyz');

		expect(result).toBe(false);
	});

	it('returns false and swallows error when sidecar write fails', () => {
		const badPath = join(tmpDir, 'nonexistent-subdir', 'pm-write.json');

		const result = writePMWriteSidecar(badPath, 'card-xyz');

		expect(result).toBe(false);
		expect(existsSync(badPath)).toBe(false);
	});
});
