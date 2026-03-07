import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock pathValidation to allow temp directory paths in tests
vi.mock('../../../src/gadgets/shared/pathValidation.js', () => ({
	validatePath: vi.fn((path: string) => path),
}));

// Mock readTracking so we don't have to pre-mark files
vi.mock('../../../src/gadgets/readTracking.js', () => ({
	assertFileRead: vi.fn(), // No-op — skip read guard
	markFileRead: vi.fn(),
	hasReadFile: vi.fn().mockReturnValue(true),
	clearReadTracking: vi.fn(),
	invalidateFileRead: vi.fn(),
	hasListedDirectory: vi.fn().mockReturnValue(false),
	markDirectoryListed: vi.fn(),
}));

// Mock post-edit checks to avoid running tsc/biome
vi.mock('../../../src/gadgets/shared/postEditChecks.js', () => ({
	runPostEditChecks: vi.fn().mockReturnValue(null),
}));

// Mock diagnosticState to avoid side effects
vi.mock('../../../src/gadgets/shared/diagnosticState.js', () => ({
	updateDiagnosticState: vi.fn(),
	formatDiagnosticStatus: vi
		.fn()
		.mockReturnValue('## Diagnostic Status\n\n✅ All edited files pass type checking'),
	runDiagnosticsWithTracking: vi.fn().mockReturnValue(null),
	clearDiagnosticState: vi.fn(),
	trackModifiedFile: vi.fn(),
	getModifiedFiles: vi.fn().mockReturnValue([]),
	clearModifiedFiles: vi.fn(),
	recordEditFailure: vi.fn().mockReturnValue(1),
	clearEditFailure: vi.fn(),
	clearEditFailures: vi.fn(),
	recordDiagnosticLoop: vi.fn().mockReturnValue(1),
	clearDiagnosticLoop: vi.fn(),
	getDiagnosticLoopFiles: vi.fn().mockReturnValue(new Map()),
	hasAnyDiagnosticErrors: vi.fn().mockReturnValue(false),
	getFilesWithErrors: vi.fn().mockReturnValue([]),
}));

import { FileSearchAndReplace } from '../../../src/gadgets/FileSearchAndReplace.js';

let tmpDir: string;
let gadget: FileSearchAndReplace;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'cascade-test-fsar-'));
	gadget = new FileSearchAndReplace();
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function createFile(name: string, content: string): string {
	const filePath = join(tmpDir, name);
	writeFileSync(filePath, content, 'utf-8');
	return filePath;
}

describe('FileSearchAndReplace', () => {
	describe('exact match', () => {
		it('replaces a single exact match', () => {
			const filePath = createFile('test.txt', 'hello world\ngoodbye world\n');

			const result = gadget.execute({
				comment: 'test',
				filePath,
				search: 'hello world',
				replace: 'hi world',
			});

			const written = readFileSync(filePath, 'utf-8');
			expect(written).toBe('hi world\ngoodbye world\n');
			expect(result).toContain('status=success');
			expect(result).toContain('strategy=exact');
		});

		it('includes the file path in output', () => {
			const filePath = createFile('test.txt', 'foo\nbar\nbaz\n');

			const result = gadget.execute({
				comment: 'test',
				filePath,
				search: 'foo',
				replace: 'qux',
			});

			expect(result).toContain(`path=${filePath}`);
		});

		it('shows before and after context in output', () => {
			const filePath = createFile('test.txt', 'alpha line\nbeta line\ngamma line\n');

			const result = gadget.execute({
				comment: 'test',
				filePath,
				search: 'beta line',
				replace: 'replaced line',
			});

			expect(result).toContain('--- BEFORE ---');
			expect(result).toContain('--- AFTER ---');
			expect(result).toContain('beta line');
			expect(result).toContain('replaced line');
		});
	});

	describe('whitespace-tolerant match', () => {
		it('matches when tabs in file but spaces in search', () => {
			// File uses tabs, search uses spaces
			const filePath = createFile('test.txt', 'function foo() {\n\tconst x = 1;\n\treturn x;\n}\n');

			const result = gadget.execute({
				comment: 'test',
				filePath,
				search: 'function foo() {\n    const x = 1;\n    return x;\n}',
				replace: 'function foo() {\n    const x = 2;\n    return x;\n}',
			});

			const written = readFileSync(filePath, 'utf-8');
			expect(written).toContain('2');
			expect(result).toContain('status=success');
		});
	});

	describe('replaceAll', () => {
		it('replaces all occurrences when replaceAll=true', () => {
			const filePath = createFile('test.txt', 'foo\nbar\nfoo\nbaz\nfoo\n');

			const result = gadget.execute({
				comment: 'test',
				filePath,
				search: 'foo',
				replace: 'qux',
				replaceAll: true,
			});

			const written = readFileSync(filePath, 'utf-8');
			expect(written).toBe('qux\nbar\nqux\nbaz\nqux\n');
			expect(result).toContain('status=success');
			expect(result).toContain('matches=3');
			expect(result).toContain('replaceAll=true');
		});

		it('replaceAll output shows line ranges', () => {
			const filePath = createFile('test.txt', 'dup\nother\ndup\n');

			const result = gadget.execute({
				comment: 'test',
				filePath,
				search: 'dup',
				replace: 'unique',
				replaceAll: true,
			});

			expect(result).toContain('Lines affected:');
		});
	});

	describe('expectedCount', () => {
		it('aborts when actual count differs from expectedCount', () => {
			const filePath = createFile('test.txt', 'foo\nfoo\nbar\n');

			expect(() =>
				gadget.execute({
					comment: 'test',
					filePath,
					search: 'foo',
					replace: 'baz',
					expectedCount: 1,
				}),
			).toThrow(/Expected 1 match.*found 2/i);
		});

		it('succeeds when count matches expectedCount', () => {
			const filePath = createFile('test.txt', 'foo\nfoo\nbar\n');

			const result = gadget.execute({
				comment: 'test',
				filePath,
				search: 'foo',
				replace: 'baz',
				replaceAll: true,
				expectedCount: 2,
			});

			const written = readFileSync(filePath, 'utf-8');
			expect(written).toBe('baz\nbaz\nbar\n');
			expect(result).toContain('status=success');
		});

		it('error message includes found match locations', () => {
			const filePath = createFile('test.txt', 'target\nother\ntarget\n');

			expect(() =>
				gadget.execute({
					comment: 'test',
					filePath,
					search: 'target',
					replace: 'replacement',
					expectedCount: 5,
				}),
			).toThrow(/lines/i);
		});
	});

	describe('no match found', () => {
		it('throws when search string is not found', () => {
			const filePath = createFile('test.txt', 'hello world\n');

			expect(() =>
				gadget.execute({
					comment: 'test',
					filePath,
					search: 'nonexistent content xyz',
					replace: 'replacement',
				}),
			).toThrow(/NOT FOUND/i);
		});

		it('error includes the search content', () => {
			const filePath = createFile('test.txt', 'hello world\n');

			expect(() =>
				gadget.execute({
					comment: 'test',
					filePath,
					search: 'missing text',
					replace: 'something',
				}),
			).toThrow(/missing text/);
		});

		it('provides suggestions when similar content exists', () => {
			const filePath = createFile(
				'test.txt',
				'function processOrder(orderId: string) {\n  return db.find(orderId);\n}\n',
			);

			// Search for something that differs enough to fail matching (< 0.8 similarity)
			// but is similar enough to trigger suggestion engine (>= 0.6 similarity)
			let errorMessage = '';
			try {
				gadget.execute({
					comment: 'test',
					filePath,
					search: 'function handleRequest(requestId: string) {\n  return db.find(requestId);\n}',
					replace: 'function handleRequest(requestId: string) {\n  return cache.get(requestId);\n}',
				});
			} catch (e) {
				errorMessage = (e as Error).message;
			}

			// Must throw a NOT FOUND error (not silently succeed or return empty)
			expect(errorMessage).toMatch(/NOT FOUND/i);
			// Error must include a suggestion pointing to the similar content in the file
			expect(errorMessage).toMatch(/SIMILAR CONTENT FOUND/i);
			expect(errorMessage).toContain('processOrder');
		});
	});

	describe('multiple matches without replaceAll', () => {
		it('throws when multiple matches found and replaceAll is false', () => {
			const filePath = createFile('test.txt', 'dup\nother\ndup\n');

			expect(() =>
				gadget.execute({
					comment: 'test',
					filePath,
					search: 'dup',
					replace: 'unique',
				}),
			).toThrow(/Ambiguous/i);
		});

		it('error includes match count', () => {
			const filePath = createFile('test.txt', 'repeat\nfoo\nrepeat\nbar\nrepeat\n');

			let errorMessage = '';
			try {
				gadget.execute({
					comment: 'test',
					filePath,
					search: 'repeat',
					replace: 'once',
				});
			} catch (e) {
				errorMessage = (e as Error).message;
			}

			expect(errorMessage).toMatch(/3 matches/i);
		});

		it('error includes options to resolve ambiguity', () => {
			const filePath = createFile('test.txt', 'same\nother\nsame\n');

			expect(() =>
				gadget.execute({
					comment: 'test',
					filePath,
					search: 'same',
					replace: 'different',
				}),
			).toThrow(/replaceAll/i);
		});
	});

	describe('file not found', () => {
		it('throws when file does not exist', () => {
			const nonExistentPath = join(tmpDir, 'does-not-exist.txt');

			expect(() =>
				gadget.execute({
					comment: 'test',
					filePath: nonExistentPath,
					search: 'anything',
					replace: 'something',
				}),
			).toThrow(/File not found/i);
		});
	});

	describe('empty replace (deletion)', () => {
		it('deletes content when replace is empty string', () => {
			const filePath = createFile('test.txt', 'keep\ndelete me\nkeep\n');

			const result = gadget.execute({
				comment: 'test',
				filePath,
				search: 'delete me\n',
				replace: '',
			});

			const written = readFileSync(filePath, 'utf-8');
			expect(written).toBe('keep\nkeep\n');
			expect(result).toContain('status=success');
		});

		it('replaceAll with empty replace deletes all occurrences', () => {
			const filePath = createFile('test.txt', 'line1\nremove\nline2\nremove\nline3\n');

			const result = gadget.execute({
				comment: 'test',
				filePath,
				search: 'remove\n',
				replace: '',
				replaceAll: true,
			});

			const written = readFileSync(filePath, 'utf-8');
			expect(written).toBe('line1\nline2\nline3\n');
			expect(result).toContain('All matches deleted.');
		});
	});
});
