import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDbWithGetDb } from '../../../helpers/mockDb.js';
import { mockDbClientModule } from '../../../helpers/sharedMocks.js';

vi.mock('../../../../src/db/client.js', () => mockDbClientModule);

vi.mock('../../../../src/db/schema/index.js', () => ({
	promptPartials: {
		id: 'id',
		orgId: 'org_id',
		name: 'name',
		content: 'content',
		createdAt: 'created_at',
		updatedAt: 'updated_at',
	},
}));

import {
	deletePartial,
	getPartial,
	listPartials,
	loadPartials,
	upsertPartial,
} from '../../../../src/db/repositories/partialsRepository.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePartialRow(
	overrides: Partial<{
		id: number;
		orgId: string | null;
		name: string;
		content: string;
		createdAt: Date | null;
		updatedAt: Date | null;
	}> = {},
) {
	return {
		id: 1,
		orgId: null,
		name: 'header',
		content: '# Hello',
		createdAt: new Date('2024-01-01'),
		updatedAt: new Date('2024-01-01'),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('partialsRepository', () => {
	let mockDb: ReturnType<typeof createMockDbWithGetDb>;

	beforeEach(() => {
		mockDb = createMockDbWithGetDb();
	});

	// ==========================================================================
	// loadPartials
	// ==========================================================================

	describe('loadPartials', () => {
		it('loads global partials when no orgId provided', async () => {
			const globalRow = makePartialRow({ name: 'footer', content: '# Footer' });
			mockDb.chain.where.mockResolvedValueOnce([globalRow]);

			const result = await loadPartials();

			expect(result).toBeInstanceOf(Map);
			expect(result.get('footer')).toBe('# Footer');
		});

		it('returns empty Map when table is missing (no orgId)', async () => {
			mockDb.chain.where.mockRejectedValueOnce(
				new Error('relation "prompt_partials" does not exist'),
			);

			const result = await loadPartials();

			expect(result).toBeInstanceOf(Map);
			expect(result.size).toBe(0);
		});

		it('loads globals and overlays org partials when orgId provided', async () => {
			const globalRow = makePartialRow({
				id: 1,
				orgId: null,
				name: 'shared',
				content: 'global content',
			});
			const orgRow = makePartialRow({
				id: 2,
				orgId: 'org-1',
				name: 'shared',
				content: 'org content',
			});

			// First call: global partials; second call: org partials
			mockDb.chain.where.mockResolvedValueOnce([globalRow]).mockResolvedValueOnce([orgRow]);

			const result = await loadPartials('org-1');

			// Org should override global for the same name
			expect(result.get('shared')).toBe('org content');
		});

		it('org partials do not replace unrelated globals', async () => {
			const globalRow = makePartialRow({
				id: 1,
				orgId: null,
				name: 'header',
				content: 'global header',
			});
			const orgRow = makePartialRow({
				id: 2,
				orgId: 'org-1',
				name: 'footer',
				content: 'org footer',
			});

			mockDb.chain.where.mockResolvedValueOnce([globalRow]).mockResolvedValueOnce([orgRow]);

			const result = await loadPartials('org-1');

			expect(result.get('header')).toBe('global header');
			expect(result.get('footer')).toBe('org footer');
			expect(result.size).toBe(2);
		});

		it('returns empty Map when table is missing (with orgId)', async () => {
			mockDb.chain.where.mockRejectedValueOnce(
				new Error('relation "prompt_partials" does not exist'),
			);

			const result = await loadPartials('org-1');

			expect(result).toBeInstanceOf(Map);
			expect(result.size).toBe(0);
		});

		it('rethrows non-table-missing errors', async () => {
			mockDb.chain.where.mockRejectedValueOnce(new Error('connection timeout'));

			await expect(loadPartials()).rejects.toThrow('connection timeout');
		});
	});

	// ==========================================================================
	// listPartials
	// ==========================================================================

	describe('listPartials', () => {
		it('returns only global partials when no orgId provided', async () => {
			const globalRow = makePartialRow({ id: 1, orgId: null, name: 'header' });
			mockDb.chain.where.mockResolvedValueOnce([globalRow]);

			const result = await listPartials();

			expect(result).toHaveLength(1);
			expect(result[0].name).toBe('header');
			expect(result[0].orgId).toBeNull();
		});

		it('returns empty array when no globals exist and no orgId', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await listPartials();

			expect(result).toEqual([]);
		});

		it('returns globals and org-scoped partials when orgId provided', async () => {
			const globalRow = makePartialRow({ id: 1, orgId: null, name: 'header' });
			const orgRow = makePartialRow({ id: 2, orgId: 'org-1', name: 'custom' });

			// listPartials with orgId uses .then() internally: first where() call resolves globals,
			// then second where() call resolves org rows
			mockDb.chain.where
				.mockResolvedValueOnce([globalRow]) // globals (via .then())
				.mockResolvedValueOnce([orgRow]); // org rows

			const result = await listPartials('org-1');

			expect(result).toHaveLength(2);
			expect(result.some((r) => r.name === 'header')).toBe(true);
			expect(result.some((r) => r.name === 'custom')).toBe(true);
		});

		it('returns [] when table is missing (no orgId)', async () => {
			mockDb.chain.where.mockRejectedValueOnce(
				new Error('relation "prompt_partials" does not exist'),
			);

			const result = await listPartials();

			expect(result).toEqual([]);
		});

		it('returns [] when table is missing (with orgId)', async () => {
			mockDb.chain.where.mockRejectedValueOnce(
				new Error('relation "prompt_partials" does not exist'),
			);

			const result = await listPartials('org-1');

			expect(result).toEqual([]);
		});

		it('rethrows non-table-missing errors', async () => {
			mockDb.chain.where.mockRejectedValueOnce(new Error('unexpected DB failure'));

			await expect(listPartials()).rejects.toThrow('unexpected DB failure');
		});
	});

	// ==========================================================================
	// getPartial
	// ==========================================================================

	describe('getPartial', () => {
		it('returns null when no partial found and no orgId', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await getPartial('missing-partial');

			expect(result).toBeNull();
		});

		it('returns global partial when found and no orgId', async () => {
			const globalRow = makePartialRow({ name: 'header', content: '# Header' });
			mockDb.chain.where.mockResolvedValueOnce([globalRow]);

			const result = await getPartial('header');

			expect(result).toEqual(globalRow);
		});

		it('tries org-scoped first when orgId provided, returns org row if found', async () => {
			const orgRow = makePartialRow({
				id: 2,
				orgId: 'org-1',
				name: 'footer',
				content: 'org footer',
			});
			// First where() call returns the org-scoped row
			mockDb.chain.where.mockResolvedValueOnce([orgRow]);

			const result = await getPartial('footer', 'org-1');

			expect(result).toEqual(orgRow);
			// Should only query once (org found, no need for global fallback)
			expect(mockDb.db.select).toHaveBeenCalledTimes(1);
		});

		it('falls back to global when org-scoped not found', async () => {
			const globalRow = makePartialRow({ id: 1, orgId: null, name: 'header' });
			// First where(): org lookup returns empty; second where(): global lookup returns row
			mockDb.chain.where
				.mockResolvedValueOnce([]) // org-scoped: not found
				.mockResolvedValueOnce([globalRow]); // global fallback: found

			const result = await getPartial('header', 'org-1');

			expect(result).toEqual(globalRow);
			expect(mockDb.db.select).toHaveBeenCalledTimes(2);
		});

		it('returns null when neither org-scoped nor global found', async () => {
			mockDb.chain.where
				.mockResolvedValueOnce([]) // org-scoped: not found
				.mockResolvedValueOnce([]); // global: not found

			const result = await getPartial('nonexistent', 'org-1');

			expect(result).toBeNull();
		});

		it('returns null when table is missing', async () => {
			mockDb.chain.where.mockRejectedValueOnce(
				new Error('relation "prompt_partials" does not exist'),
			);

			const result = await getPartial('header', 'org-1');

			expect(result).toBeNull();
		});

		it('rethrows non-table-missing errors', async () => {
			mockDb.chain.where.mockRejectedValueOnce(new Error('network error'));

			await expect(getPartial('header')).rejects.toThrow('network error');
		});
	});

	// ==========================================================================
	// upsertPartial
	// ==========================================================================

	describe('upsertPartial', () => {
		it('inserts a new partial when none exists', async () => {
			const inserted = makePartialRow({ id: 10, name: 'header', content: '# New Header' });

			// select() returns no existing row → falls through to insert
			mockDb.chain.where.mockResolvedValueOnce([]);
			mockDb.chain.returning.mockResolvedValueOnce([inserted]);

			const result = await upsertPartial({ name: 'header', content: '# New Header' });

			expect(result).toEqual(inserted);
			expect(mockDb.db.insert).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.values).toHaveBeenCalledWith(
				expect.objectContaining({
					name: 'header',
					content: '# New Header',
					orgId: null,
				}),
			);
		});

		it('updates existing partial when one is found', async () => {
			const existing = makePartialRow({ id: 5, name: 'footer', content: 'old content' });
			const updated = makePartialRow({ id: 5, name: 'footer', content: 'new content' });

			// select() finds existing row → falls through to update
			mockDb.chain.where.mockResolvedValueOnce([existing]);
			// update chain: set().where().returning()
			const updateWhere = vi
				.fn()
				.mockReturnValue({ returning: vi.fn().mockResolvedValueOnce([updated]) });
			mockDb.chain.set.mockReturnValueOnce({ where: updateWhere });

			const result = await upsertPartial({ name: 'footer', content: 'new content' });

			expect(result).toEqual(updated);
			expect(mockDb.db.update).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.set).toHaveBeenCalledWith(
				expect.objectContaining({
					content: 'new content',
					updatedAt: expect.any(Date),
				}),
			);
		});

		it('inserts with orgId when provided', async () => {
			const inserted = makePartialRow({
				id: 11,
				orgId: 'org-1',
				name: 'custom',
				content: 'org content',
			});

			mockDb.chain.where.mockResolvedValueOnce([]);
			mockDb.chain.returning.mockResolvedValueOnce([inserted]);

			const result = await upsertPartial({
				orgId: 'org-1',
				name: 'custom',
				content: 'org content',
			});

			expect(result).toEqual(inserted);
			expect(mockDb.chain.values).toHaveBeenCalledWith(
				expect.objectContaining({
					orgId: 'org-1',
					name: 'custom',
				}),
			);
		});

		it('inserts with null orgId when orgId is explicitly null', async () => {
			const inserted = makePartialRow({ id: 12, orgId: null, name: 'shared' });

			mockDb.chain.where.mockResolvedValueOnce([]);
			mockDb.chain.returning.mockResolvedValueOnce([inserted]);

			const result = await upsertPartial({
				orgId: null,
				name: 'shared',
				content: 'shared content',
			});

			expect(result).toEqual(inserted);
			expect(mockDb.chain.values).toHaveBeenCalledWith(expect.objectContaining({ orgId: null }));
		});
	});

	// ==========================================================================
	// deletePartial
	// ==========================================================================

	describe('deletePartial', () => {
		it('deletes partial by id', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await deletePartial(42);

			expect(mockDb.db.delete).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.where).toHaveBeenCalledTimes(1);
		});

		it('calls delete with the correct table', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await deletePartial(99);

			expect(mockDb.db.delete).toHaveBeenCalledTimes(1);
		});
	});
});
