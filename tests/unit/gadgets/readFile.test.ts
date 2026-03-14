import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock pathValidation to allow temp directory paths in tests
vi.mock('../../../src/gadgets/shared/pathValidation.js', () => ({
	validatePath: vi.fn((path: string) => path),
}));

// Use vi.hoisted so mock variables are initialized before vi.mock is called
const { mockHasReadFile, mockMarkFileRead } = vi.hoisted(() => ({
	mockHasReadFile: vi.fn().mockReturnValue(false),
	mockMarkFileRead: vi.fn(),
}));

// Mock readTracking so we can control read state
vi.mock('../../../src/gadgets/readTracking.js', () => ({
	hasReadFile: mockHasReadFile,
	markFileRead: mockMarkFileRead,
	assertFileRead: vi.fn(),
	clearReadTracking: vi.fn(),
	invalidateFileRead: vi.fn(),
	hasListedDirectory: vi.fn().mockReturnValue(false),
	markDirectoryListed: vi.fn(),
}));

import { ReadFile } from '../../../src/gadgets/ReadFile.js';

let tmpDir: string;
let gadget: ReadFile;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'cascade-test-readfile-'));
	gadget = new ReadFile();
	mockHasReadFile.mockReturnValue(false);
	mockMarkFileRead.mockClear();
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	vi.clearAllMocks();
});

function createFile(name: string, content: string): string {
	const filePath = join(tmpDir, name);
	writeFileSync(filePath, content, 'utf-8');
	return filePath;
}

describe('ReadFile', () => {
	describe('successful read', () => {
		it('returns file content with path header', async () => {
			const filePath = createFile('test.txt', 'hello world\n');

			const result = await gadget.execute({ comment: 'test', filePath });

			expect(result).toBe(`path=${filePath}\n\nhello world\n`);
		});

		it('includes the path header in output', async () => {
			const filePath = createFile('example.ts', 'export const x = 1;\n');

			const result = await gadget.execute({ comment: 'test', filePath });

			expect(result).toContain(`path=${filePath}`);
		});

		it('returns multi-line file content correctly', async () => {
			const content = 'line1\nline2\nline3\n';
			const filePath = createFile('multiline.txt', content);

			const result = await gadget.execute({ comment: 'test', filePath });

			expect(result).toContain('line1');
			expect(result).toContain('line2');
			expect(result).toContain('line3');
		});
	});

	describe('read tracking', () => {
		it('calls markFileRead after reading a file', async () => {
			const filePath = createFile('track.txt', 'content\n');

			await gadget.execute({ comment: 'test', filePath });

			expect(mockMarkFileRead).toHaveBeenCalledWith(filePath);
		});

		it('returns already-read message when file was previously read', async () => {
			const filePath = createFile('already.txt', 'original content\n');
			mockHasReadFile.mockReturnValue(true);

			const result = await gadget.execute({ comment: 'test', filePath });

			expect(result).toContain('[Already read - refer to previous content in context]');
			expect(result).toContain(`path=${filePath}`);
		});

		it('does not call markFileRead when file was already read', async () => {
			const filePath = createFile('already2.txt', 'content\n');
			mockHasReadFile.mockReturnValue(true);

			await gadget.execute({ comment: 'test', filePath });

			expect(mockMarkFileRead).not.toHaveBeenCalled();
		});
	});

	describe('path validation', () => {
		it('uses validatePath to resolve the file path', async () => {
			const { validatePath } = await import('../../../src/gadgets/shared/pathValidation.js');
			const filePath = createFile('validated.txt', 'data\n');

			await gadget.execute({ comment: 'test', filePath });

			expect(validatePath).toHaveBeenCalledWith(filePath);
		});
	});

	describe('error on non-existent file', () => {
		it('throws when file does not exist', async () => {
			const nonExistentPath = join(tmpDir, 'does-not-exist.txt');

			await expect(
				gadget.execute({ comment: 'test', filePath: nonExistentPath }),
			).rejects.toThrow();
		});
	});
});
