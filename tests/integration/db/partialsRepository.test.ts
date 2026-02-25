import { beforeEach, describe, expect, it } from 'vitest';
import {
	deletePartial,
	getPartial,
	listPartials,
	loadPartials,
	upsertPartial,
} from '../../../src/db/repositories/partialsRepository.js';
import { truncateAll } from '../helpers/db.js';
import { seedOrg, seedProject, seedPromptPartial } from '../helpers/seed.js';

describe('partialsRepository (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
		await seedProject();
	});

	// =========================================================================
	// loadPartials
	// =========================================================================

	describe('loadPartials', () => {
		it('returns empty map when no partials exist', async () => {
			const partials = await loadPartials();
			expect(partials.size).toBe(0);
		});

		it('returns global partials only when no orgId given', async () => {
			await seedPromptPartial({ orgId: null, name: 'global-partial', content: 'Global content' });
			await seedPromptPartial({ orgId: 'test-org', name: 'org-partial', content: 'Org content' });

			const partials = await loadPartials();
			expect(partials.has('global-partial')).toBe(true);
			expect(partials.has('org-partial')).toBe(false);
		});

		it('returns global partials when orgId given', async () => {
			await seedPromptPartial({ orgId: null, name: 'global-partial', content: 'Global content' });

			const partials = await loadPartials('test-org');
			expect(partials.has('global-partial')).toBe(true);
		});

		it('org partials overlay global partials with the same name', async () => {
			await seedPromptPartial({ orgId: null, name: 'shared-partial', content: 'Global version' });
			await seedPromptPartial({
				orgId: 'test-org',
				name: 'shared-partial',
				content: 'Org version',
			});

			const partials = await loadPartials('test-org');
			expect(partials.get('shared-partial')).toBe('Org version');
		});

		it('includes org-specific partials not in global', async () => {
			await seedPromptPartial({ orgId: null, name: 'global-only', content: 'Global only' });
			await seedPromptPartial({ orgId: 'test-org', name: 'org-only', content: 'Org only' });

			const partials = await loadPartials('test-org');
			expect(partials.has('global-only')).toBe(true);
			expect(partials.has('org-only')).toBe(true);
			expect(partials.size).toBe(2);
		});
	});

	// =========================================================================
	// listPartials
	// =========================================================================

	describe('listPartials', () => {
		it('returns only global partials when no orgId given', async () => {
			await seedPromptPartial({ orgId: null, name: 'global-p', content: 'global' });
			await seedPromptPartial({ orgId: 'test-org', name: 'org-p', content: 'org' });

			const partials = await listPartials();
			expect(partials.every((p) => p.orgId === null)).toBe(true);
			expect(partials.some((p) => p.name === 'global-p')).toBe(true);
		});

		it('returns both global and org-scoped partials when orgId given', async () => {
			await seedPromptPartial({ orgId: null, name: 'global-p', content: 'global' });
			await seedPromptPartial({ orgId: 'test-org', name: 'org-p', content: 'org' });

			const partials = await listPartials('test-org');
			expect(partials.some((p) => p.name === 'global-p')).toBe(true);
			expect(partials.some((p) => p.name === 'org-p')).toBe(true);
		});
	});

	// =========================================================================
	// getPartial
	// =========================================================================

	describe('getPartial', () => {
		it('returns global partial when found', async () => {
			await seedPromptPartial({ orgId: null, name: 'my-partial', content: 'my content' });

			const partial = await getPartial('my-partial');
			expect(partial).toBeDefined();
			expect(partial?.content).toBe('my content');
		});

		it('returns null when partial not found', async () => {
			const partial = await getPartial('nonexistent');
			expect(partial).toBeNull();
		});

		it('returns org-scoped partial with priority over global', async () => {
			await seedPromptPartial({ orgId: null, name: 'shared', content: 'global content' });
			await seedPromptPartial({ orgId: 'test-org', name: 'shared', content: 'org content' });

			const partial = await getPartial('shared', 'test-org');
			expect(partial?.content).toBe('org content');
		});

		it('falls back to global partial when org-scoped one not found', async () => {
			await seedPromptPartial({ orgId: null, name: 'global-only', content: 'global content' });

			const partial = await getPartial('global-only', 'test-org');
			expect(partial?.content).toBe('global content');
		});
	});

	// =========================================================================
	// upsertPartial
	// =========================================================================

	describe('upsertPartial', () => {
		it('inserts a new global partial', async () => {
			const partial = await upsertPartial({
				orgId: null,
				name: 'new-partial',
				content: 'new content',
			});
			expect(partial.name).toBe('new-partial');
			expect(partial.content).toBe('new content');
			expect(partial.orgId).toBeNull();
		});

		it('inserts a new org-scoped partial', async () => {
			const partial = await upsertPartial({
				orgId: 'test-org',
				name: 'org-partial',
				content: 'org content',
			});
			expect(partial.orgId).toBe('test-org');
		});

		it('updates an existing partial without creating a duplicate', async () => {
			await upsertPartial({ orgId: null, name: 'dup-test', content: 'original' });
			await upsertPartial({ orgId: null, name: 'dup-test', content: 'updated' });

			const allPartials = await listPartials();
			const matches = allPartials.filter((p) => p.name === 'dup-test');
			expect(matches).toHaveLength(1);
			expect(matches[0].content).toBe('updated');
		});

		it('updates an org-scoped partial', async () => {
			await upsertPartial({ orgId: 'test-org', name: 'org-dup', content: 'v1' });
			const updated = await upsertPartial({ orgId: 'test-org', name: 'org-dup', content: 'v2' });
			expect(updated.content).toBe('v2');
		});
	});

	// =========================================================================
	// deletePartial
	// =========================================================================

	describe('deletePartial', () => {
		it('deletes a partial by ID', async () => {
			const partial = await upsertPartial({ orgId: null, name: 'to-delete', content: 'delete me' });
			await deletePartial(partial.id);

			const found = await getPartial('to-delete');
			expect(found).toBeNull();
		});

		it('deletes org-scoped partial without affecting global with same name', async () => {
			await seedPromptPartial({ orgId: null, name: 'keep-global', content: 'global' });
			const orgPartial = await upsertPartial({
				orgId: 'test-org',
				name: 'keep-global',
				content: 'org',
			});

			await deletePartial(orgPartial.id);

			// Global still exists
			const remaining = await getPartial('keep-global');
			expect(remaining?.content).toBe('global');
		});
	});
});
