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

import { FileRemoveContent } from '../../../src/gadgets/FileRemoveContent.js';

let tmpDir: string;
let gadget: FileRemoveContent;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'cascade-test-remove-'));
	gadget = new FileRemoveContent();
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function createFile(name: string, content: string): string {
	const filePath = join(tmpDir, name);
	writeFileSync(filePath, content, 'utf-8');
	return filePath;
}

describe('FileRemoveContent', () => {
	describe('remove single line', () => {
		it('removes a single line from the file', () => {
			const filePath = createFile('test.txt', 'line1\nline2\nline3\n');

			const result = gadget.execute({
				comment: 'test',
				filePath,
				startLine: 2,
				endLine: 2,
			});

			const written = readFileSync(filePath, 'utf-8');
			expect(written).toBe('line1\nline3\n');
			expect(result).toContain('Removed 1 line (line 2)');
		});

		it('removes the first line', () => {
			const filePath = createFile('test.txt', 'line1\nline2\nline3\n');

			gadget.execute({
				comment: 'test',
				filePath,
				startLine: 1,
				endLine: 1,
			});

			const written = readFileSync(filePath, 'utf-8');
			expect(written).toBe('line2\nline3\n');
		});

		it('removes the last line', () => {
			const filePath = createFile('test.txt', 'line1\nline2\nline3');

			gadget.execute({
				comment: 'test',
				filePath,
				startLine: 3,
				endLine: 3,
			});

			const written = readFileSync(filePath, 'utf-8');
			expect(written).toBe('line1\nline2');
		});
	});

	describe('remove range of lines', () => {
		it('removes a range of lines', () => {
			const filePath = createFile('test.txt', 'line1\nline2\nline3\nline4\nline5\n');

			const result = gadget.execute({
				comment: 'test',
				filePath,
				startLine: 2,
				endLine: 4,
			});

			const written = readFileSync(filePath, 'utf-8');
			expect(written).toBe('line1\nline5\n');
			expect(result).toContain('Removed 3 lines (lines 2-4)');
		});

		it('removes all lines when range covers entire file', () => {
			const filePath = createFile('test.txt', 'line1\nline2\n');

			gadget.execute({
				comment: 'test',
				filePath,
				startLine: 1,
				endLine: 2,
			});

			const written = readFileSync(filePath, 'utf-8');
			expect(written).toBe('');
		});

		it('clamps endLine to file length when exceeding', () => {
			const filePath = createFile('test.txt', 'line1\nline2\nline3\n');

			const result = gadget.execute({
				comment: 'test',
				filePath,
				startLine: 2,
				endLine: 100,
			});

			const written = readFileSync(filePath, 'utf-8');
			// After removing lines 2+ from 'line1\nline2\nline3\n', only line1 remains
			expect(written).toContain('line1');
			expect(written).not.toContain('line2');
			expect(result).toContain('Removed');
		});
	});

	describe('output format', () => {
		it('output includes BEFORE section', () => {
			const filePath = createFile('test.txt', 'line1\nline2\nline3\n');

			const result = gadget.execute({
				comment: 'test',
				filePath,
				startLine: 2,
				endLine: 2,
			});

			expect(result).toContain('--- BEFORE ---');
		});

		it('output includes AFTER section', () => {
			const filePath = createFile('test.txt', 'line1\nline2\nline3\n');

			const result = gadget.execute({
				comment: 'test',
				filePath,
				startLine: 2,
				endLine: 2,
			});

			expect(result).toContain('--- AFTER ---');
		});

		it('output includes file path and status', () => {
			const filePath = createFile('test.txt', 'line1\nline2\nline3\n');

			const result = gadget.execute({
				comment: 'test',
				filePath,
				startLine: 1,
				endLine: 1,
			});

			expect(result).toContain(`path=${filePath}`);
			expect(result).toContain('status=success');
		});
	});

	describe('error cases', () => {
		it('throws when startLine > endLine', () => {
			const filePath = createFile('test.txt', 'line1\nline2\n');

			expect(() =>
				gadget.execute({
					comment: 'test',
					filePath,
					startLine: 5,
					endLine: 2,
				}),
			).toThrow('Invalid line range');
		});

		it('throws when startLine is beyond end of file', () => {
			const filePath = createFile('test.txt', 'line1\nline2\n');

			expect(() =>
				gadget.execute({
					comment: 'test',
					filePath,
					startLine: 10,
					endLine: 12,
				}),
			).toThrow('beyond end of file');
		});

		it('throws when file does not exist', () => {
			const filePath = join(tmpDir, 'nonexistent.txt');

			expect(() =>
				gadget.execute({
					comment: 'test',
					filePath,
					startLine: 1,
					endLine: 1,
				}),
			).toThrow('File not found');
		});
	});
});
