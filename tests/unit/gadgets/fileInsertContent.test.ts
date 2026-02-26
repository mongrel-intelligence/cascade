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

import { FileInsertContent } from '../../../src/gadgets/FileInsertContent.js';

let tmpDir: string;
let gadget: FileInsertContent;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'cascade-test-insert-'));
	gadget = new FileInsertContent();
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function createFile(name: string, content: string): string {
	const filePath = join(tmpDir, name);
	writeFileSync(filePath, content, 'utf-8');
	return filePath;
}

describe('FileInsertContent', () => {
	describe('insert before line', () => {
		it('inserts content before line 1 (prepend)', () => {
			const filePath = createFile('test.txt', 'line1\nline2\nline3\n');

			const result = gadget.execute({
				comment: 'test',
				filePath,
				line: 1,
				mode: 'before',
				content: 'newline',
			});

			const written = readFileSync(filePath, 'utf-8');
			expect(written).toBe('newline\nline1\nline2\nline3\n');
			expect(result).toContain('Inserted 1 line before line 1');
		});

		it('inserts content before a middle line', () => {
			const filePath = createFile('test.txt', 'line1\nline2\nline3\n');

			gadget.execute({
				comment: 'test',
				filePath,
				line: 2,
				mode: 'before',
				content: 'inserted',
			});

			const written = readFileSync(filePath, 'utf-8');
			expect(written).toBe('line1\ninserted\nline2\nline3\n');
		});

		it('appends at end when line exceeds file length with mode=before', () => {
			const filePath = createFile('test.txt', 'line1\nline2\n');

			const result = gadget.execute({
				comment: 'test',
				filePath,
				line: 999,
				mode: 'before',
				content: 'appended',
			});

			const written = readFileSync(filePath, 'utf-8');
			expect(written).toContain('appended');
			expect(result).toContain('Appended');
		});

		it('inserts multiline content before a line', () => {
			const filePath = createFile('test.txt', 'line1\nline2\n');

			gadget.execute({
				comment: 'test',
				filePath,
				line: 2,
				mode: 'before',
				content: 'newA\nnewB',
			});

			const written = readFileSync(filePath, 'utf-8');
			expect(written).toBe('line1\nnewA\nnewB\nline2\n');
		});
	});

	describe('insert after line', () => {
		it('inserts content after line 1', () => {
			const filePath = createFile('test.txt', 'line1\nline2\nline3\n');

			gadget.execute({
				comment: 'test',
				filePath,
				line: 1,
				mode: 'after',
				content: 'inserted',
			});

			const written = readFileSync(filePath, 'utf-8');
			expect(written).toBe('line1\ninserted\nline2\nline3\n');
		});

		it('appends at end when line >= line count', () => {
			const filePath = createFile('test.txt', 'line1\nline2\n');

			const result = gadget.execute({
				comment: 'test',
				filePath,
				line: 100,
				mode: 'after',
				content: 'appended',
			});

			const written = readFileSync(filePath, 'utf-8');
			expect(written).toContain('appended');
			expect(result).toContain('Appended');
		});

		it('inserts multiline content after a line', () => {
			const filePath = createFile('test.txt', 'line1\nline2\nline3\n');

			gadget.execute({
				comment: 'test',
				filePath,
				line: 1,
				mode: 'after',
				content: 'newA\nnewB',
			});

			const written = readFileSync(filePath, 'utf-8');
			expect(written).toBe('line1\nnewA\nnewB\nline2\nline3\n');
		});

		it('returns output with status=success for non-TS files', () => {
			const filePath = createFile('test.txt', 'line1\nline2\n');

			const result = gadget.execute({
				comment: 'test',
				filePath,
				line: 1,
				mode: 'after',
				content: 'new content',
			});

			expect(result).toContain('status=success');
		});
	});

	describe('output format', () => {
		it('output includes the file path', () => {
			const filePath = createFile('test.txt', 'line1\nline2\n');

			const result = gadget.execute({
				comment: 'test',
				filePath,
				line: 1,
				mode: 'after',
				content: 'new',
			});

			expect(result).toContain(`path=${filePath}`);
		});

		it('output contains context lines around the insertion point', () => {
			const filePath = createFile('test.txt', 'line1\nline2\nline3\n');

			const result = gadget.execute({
				comment: 'test',
				filePath,
				line: 2,
				mode: 'after',
				content: 'inserted',
			});

			expect(result).toContain('inserted');
		});
	});

	describe('new file creation', () => {
		it('creates a new file when it does not exist', () => {
			const filePath = join(tmpDir, 'newfile.txt');

			const result = gadget.execute({
				comment: 'test',
				filePath,
				line: 0,
				mode: 'before',
				content: 'first line',
			});

			const written = readFileSync(filePath, 'utf-8');
			expect(written).toContain('first line');
			expect(result).toContain('status=success');
		});
	});
});
