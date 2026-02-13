import { afterEach, describe, expect, it } from 'vitest';

import {
	assertFileRead,
	clearReadTracking,
	hasReadFile,
	invalidateFileRead,
	markFileRead,
} from '../../../src/gadgets/readTracking.js';

describe('readTracking', () => {
	// Clean up after each test
	afterEach(() => {
		clearReadTracking();
	});

	describe('markFileRead and hasReadFile', () => {
		it('tracks files that have been read', () => {
			expect(hasReadFile('/path/to/file.ts')).toBe(false);
			markFileRead('/path/to/file.ts');
			expect(hasReadFile('/path/to/file.ts')).toBe(true);
		});

		it('tracks multiple files independently', () => {
			markFileRead('/path/to/file1.ts');
			markFileRead('/path/to/file2.ts');
			expect(hasReadFile('/path/to/file1.ts')).toBe(true);
			expect(hasReadFile('/path/to/file2.ts')).toBe(true);
			expect(hasReadFile('/path/to/file3.ts')).toBe(false);
		});
	});

	describe('invalidateFileRead', () => {
		it('removes a file from tracking after edit/write', () => {
			// File is read initially
			markFileRead('/path/to/file.ts');
			expect(hasReadFile('/path/to/file.ts')).toBe(true);

			// File is edited/written - invalidate tracking
			invalidateFileRead('/path/to/file.ts');

			// File should no longer be tracked (next read returns fresh content)
			expect(hasReadFile('/path/to/file.ts')).toBe(false);
		});

		it('only invalidates the specified file', () => {
			markFileRead('/path/to/file1.ts');
			markFileRead('/path/to/file2.ts');

			// Only invalidate file1
			invalidateFileRead('/path/to/file1.ts');

			expect(hasReadFile('/path/to/file1.ts')).toBe(false);
			expect(hasReadFile('/path/to/file2.ts')).toBe(true);
		});

		it('handles invalidating files that were not tracked', () => {
			// Should not throw
			invalidateFileRead('/path/to/untracked.ts');
			expect(hasReadFile('/path/to/untracked.ts')).toBe(false);
		});

		it('allows re-tracking after invalidation', () => {
			markFileRead('/path/to/file.ts');
			invalidateFileRead('/path/to/file.ts');

			// Re-read the file (after seeing fresh content)
			markFileRead('/path/to/file.ts');
			expect(hasReadFile('/path/to/file.ts')).toBe(true);
		});
	});

	describe('markFileRead preserves read status after edits', () => {
		it('file remains readable after markFileRead (simulates post-edit)', () => {
			// Agent reads file
			markFileRead('/path/to/file.ts');
			expect(hasReadFile('/path/to/file.ts')).toBe(true);

			// Agent edits file — gadgets now call markFileRead instead of invalidateFileRead
			markFileRead('/path/to/file.ts');
			expect(hasReadFile('/path/to/file.ts')).toBe(true);

			// assertFileRead should not throw — agent has seen the content
			expect(() => assertFileRead('/path/to/file.ts', 'TestGadget')).not.toThrow();
		});

		it('chained edits keep file readable', () => {
			markFileRead('/path/to/file.ts');

			// Simulate multiple sequential edits
			markFileRead('/path/to/file.ts');
			markFileRead('/path/to/file.ts');
			markFileRead('/path/to/file.ts');

			expect(hasReadFile('/path/to/file.ts')).toBe(true);
			expect(() => assertFileRead('/path/to/file.ts', 'FileMultiEdit')).not.toThrow();
		});
	});

	describe('clearReadTracking', () => {
		it('clears all tracked files', () => {
			markFileRead('/path/to/file1.ts');
			markFileRead('/path/to/file2.ts');

			clearReadTracking();

			expect(hasReadFile('/path/to/file1.ts')).toBe(false);
			expect(hasReadFile('/path/to/file2.ts')).toBe(false);
		});
	});

	describe('assertFileRead', () => {
		it('throws when file has not been read', () => {
			expect(() => assertFileRead('/path/to/unread.ts', 'TestGadget')).toThrow(
				'TestGadget requires reading the file before editing',
			);
		});

		it('includes gadget name and path in error message', () => {
			expect(() => assertFileRead('/some/file.ts', 'FileSearchAndReplace')).toThrow(
				/FileSearchAndReplace.*\/some\/file\.ts/s,
			);
		});

		it('does not throw when file has been read', () => {
			markFileRead('/path/to/read.ts');
			expect(() => assertFileRead('/path/to/read.ts', 'TestGadget')).not.toThrow();
		});

		it('throws after invalidateFileRead', () => {
			markFileRead('/path/to/file.ts');
			invalidateFileRead('/path/to/file.ts');

			expect(() => assertFileRead('/path/to/file.ts', 'TestGadget')).toThrow(
				'TestGadget requires reading the file before editing',
			);
		});

		it('throws after clearReadTracking', () => {
			markFileRead('/path/to/file.ts');
			clearReadTracking();

			expect(() => assertFileRead('/path/to/file.ts', 'TestGadget')).toThrow(
				'TestGadget requires reading the file before editing',
			);
		});
	});
});
