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

import { FileMultiEdit } from '../../../src/gadgets/FileMultiEdit.js';

let tmpDir: string;
let gadget: FileMultiEdit;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'cascade-test-fme-'));
	gadget = new FileMultiEdit();
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function createFile(name: string, content: string): string {
	const filePath = join(tmpDir, name);
	writeFileSync(filePath, content, 'utf-8');
	return filePath;
}

describe('FileMultiEdit', () => {
	describe('single edit success', () => {
		it('applies a single search/replace edit correctly', () => {
			const filePath = createFile('test.ts', 'function foo() {\n  return 1;\n}\n');

			const result = gadget.execute({
				comment: 'test single edit',
				filePath,
				edits: [{ search: 'return 1;', replace: 'return 2;' }],
			});

			const written = readFileSync(filePath, 'utf-8');
			expect(written).toBe('function foo() {\n  return 2;\n}\n');
			expect(result).toContain('status=success');
			expect(result).toContain('edits=1/1');
		});

		it('includes the file path in output', () => {
			const filePath = createFile('test.ts', 'const x = 1;\n');

			const result = gadget.execute({
				comment: 'test',
				filePath,
				edits: [{ search: 'const x = 1;', replace: 'const x = 2;' }],
			});

			expect(result).toContain(`path=${filePath}`);
		});

		it('shows before and after context for the edit', () => {
			const filePath = createFile('test.ts', 'line one\nline two\nline three\n');

			const result = gadget.execute({
				comment: 'test',
				filePath,
				edits: [{ search: 'line two', replace: 'line replaced' }],
			});

			expect(result).toContain('=== Edit 1');
			expect(result).toContain('line two');
			expect(result).toContain('line replaced');
		});
	});

	describe('multiple sequential edits', () => {
		it('applies multiple edits in order, each seeing the result of the previous', () => {
			const filePath = createFile(
				'test.ts',
				'function process(data: string) {\n  return data.trim();\n}\n',
			);

			const result = gadget.execute({
				comment: 'rename parameter',
				filePath,
				edits: [
					{
						search: 'function process(data: string)',
						replace: 'function process(input: string)',
					},
					{
						search: 'return data.trim();',
						replace: 'return input.trim();',
					},
				],
			});

			const written = readFileSync(filePath, 'utf-8');
			expect(written).toBe('function process(input: string) {\n  return input.trim();\n}\n');
			expect(result).toContain('status=success');
			expect(result).toContain('edits=2/2');
		});

		it('output contains a section for each edit', () => {
			const filePath = createFile('test.ts', 'alpha\nbeta\ngamma\n');

			const result = gadget.execute({
				comment: 'three edits',
				filePath,
				edits: [
					{ search: 'alpha', replace: 'one' },
					{ search: 'beta', replace: 'two' },
					{ search: 'gamma', replace: 'three' },
				],
			});

			expect(result).toContain('=== Edit 1');
			expect(result).toContain('=== Edit 2');
			expect(result).toContain('=== Edit 3');
			expect(result).toContain('edits=3/3');
		});

		it('second edit sees content modified by first edit', () => {
			// The second search pattern only exists AFTER the first edit transforms the content
			const filePath = createFile('test.ts', 'foo\n');

			const result = gadget.execute({
				comment: 'chained edits',
				filePath,
				edits: [
					{ search: 'foo', replace: 'foo bar' },
					{ search: 'foo bar', replace: 'baz' },
				],
			});

			const written = readFileSync(filePath, 'utf-8');
			expect(written).toBe('baz\n');
			expect(result).toContain('status=success');
		});
	});

	describe('atomicity: all-or-nothing', () => {
		it('leaves file unchanged when a later edit fails to match', () => {
			const originalContent = 'hello world\ngoodbye world\n';
			const filePath = createFile('test.ts', originalContent);

			expect(() =>
				gadget.execute({
					comment: 'atomicity test',
					filePath,
					edits: [
						{ search: 'hello world', replace: 'hi world' },
						{ search: 'nonexistent content xyz', replace: 'replacement' },
					],
				}),
			).toThrow();

			// File must remain unchanged
			const written = readFileSync(filePath, 'utf-8');
			expect(written).toBe(originalContent);
		});

		it('leaves file unchanged when the first edit fails to match', () => {
			const originalContent = 'line one\nline two\n';
			const filePath = createFile('test.ts', originalContent);

			expect(() =>
				gadget.execute({
					comment: 'first edit fails',
					filePath,
					edits: [
						{ search: 'nonexistent pattern', replace: 'replacement' },
						{ search: 'line two', replace: 'line replaced' },
					],
				}),
			).toThrow(/ABORTED/);

			const written = readFileSync(filePath, 'utf-8');
			expect(written).toBe(originalContent);
		});

		it('error message indicates which edit failed', () => {
			const filePath = createFile('test.ts', 'a\nb\nc\n');

			let errorMessage = '';
			try {
				gadget.execute({
					comment: 'test',
					filePath,
					edits: [
						{ search: 'a', replace: 'x' },
						{ search: 'MISSING', replace: 'y' },
						{ search: 'c', replace: 'z' },
					],
				});
			} catch (e) {
				errorMessage = (e as Error).message;
			}

			// Should indicate edit 2 failed out of 3
			expect(errorMessage).toContain('2/3');
		});

		it('error message says no changes were made', () => {
			const filePath = createFile('test.ts', 'existing content\n');

			let errorMessage = '';
			try {
				gadget.execute({
					comment: 'test',
					filePath,
					edits: [{ search: 'not present', replace: 'something' }],
				});
			} catch (e) {
				errorMessage = (e as Error).message;
			}

			expect(errorMessage).toMatch(/no changes were made/i);
		});

		it('throws when an edit finds multiple matches', () => {
			const filePath = createFile('test.ts', 'dup\nother\ndup\n');

			expect(() =>
				gadget.execute({
					comment: 'ambiguous match',
					filePath,
					edits: [{ search: 'dup', replace: 'unique' }],
				}),
			).toThrow(/ABORTED/);

			// File stays unchanged
			const written = readFileSync(filePath, 'utf-8');
			expect(written).toBe('dup\nother\ndup\n');
		});
	});

	describe('indentation adjustment', () => {
		it('adjusts indentation of replacement when file uses different indentation', () => {
			// File uses tabs; replacement uses spaces — should match via indentation strategy
			const filePath = createFile('test.ts', 'function foo() {\n\tconst x = 1;\n\treturn x;\n}\n');

			const result = gadget.execute({
				comment: 'indentation test',
				filePath,
				edits: [
					{
						search: 'function foo() {\n    const x = 1;\n    return x;\n}',
						replace: 'function foo() {\n    const x = 2;\n    return x;\n}',
					},
				],
			});

			const written = readFileSync(filePath, 'utf-8');
			// The value should be updated regardless of indentation style
			expect(written).toContain('2');
			expect(result).toContain('status=success');
		});
	});

	describe('file not found', () => {
		it('throws when the file does not exist', () => {
			const nonExistentPath = join(tmpDir, 'does-not-exist.ts');

			expect(() =>
				gadget.execute({
					comment: 'test',
					filePath: nonExistentPath,
					edits: [{ search: 'anything', replace: 'something' }],
				}),
			).toThrow(/File not found/i);
		});

		it('error message includes the file path', () => {
			const nonExistentPath = join(tmpDir, 'missing.ts');

			let errorMessage = '';
			try {
				gadget.execute({
					comment: 'test',
					filePath: nonExistentPath,
					edits: [{ search: 'anything', replace: 'something' }],
				});
			} catch (e) {
				errorMessage = (e as Error).message;
			}

			expect(errorMessage).toContain('missing.ts');
		});
	});

	describe('read tracking assertion', () => {
		it('calls assertFileRead to enforce read-before-edit contract', async () => {
			const { assertFileRead } = await import('../../../src/gadgets/readTracking.js');
			const filePath = createFile('test.ts', 'content\n');

			gadget.execute({
				comment: 'test',
				filePath,
				edits: [{ search: 'content', replace: 'new content' }],
			});

			expect(assertFileRead).toHaveBeenCalledWith(filePath, 'FileMultiEdit');
		});
	});

	describe('empty replace (deletion)', () => {
		it('deletes matched content when replace is empty string', () => {
			const filePath = createFile('test.ts', 'keep\ndelete me\nkeep\n');

			const result = gadget.execute({
				comment: 'delete line',
				filePath,
				edits: [{ search: 'delete me\n', replace: '' }],
			});

			const written = readFileSync(filePath, 'utf-8');
			expect(written).toBe('keep\nkeep\n');
			expect(result).toContain('status=success');
		});
	});
});
