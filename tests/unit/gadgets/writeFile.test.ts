import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Use vi.hoisted so mock variables are initialized before vi.mock is called
const { mockValidatePath, mockMarkFileRead, mockRunPostEditChecks } = vi.hoisted(() => ({
	mockValidatePath: vi.fn((path: string) => path),
	mockMarkFileRead: vi.fn(),
	mockRunPostEditChecks: vi.fn().mockReturnValue(null),
}));

// Mock pathValidation to allow temp directory paths in tests
vi.mock('../../../src/gadgets/shared/pathValidation.js', () => ({
	validatePath: mockValidatePath,
}));

// Mock readTracking
vi.mock('../../../src/gadgets/readTracking.js', () => ({
	markFileRead: mockMarkFileRead,
	hasReadFile: vi.fn().mockReturnValue(false),
	assertFileRead: vi.fn(),
	clearReadTracking: vi.fn(),
	invalidateFileRead: vi.fn(),
	hasListedDirectory: vi.fn().mockReturnValue(false),
	markDirectoryListed: vi.fn(),
}));

// Mock post-edit checks to avoid running tsc/biome
vi.mock('../../../src/gadgets/shared/index.js', () => ({
	runPostEditChecks: mockRunPostEditChecks,
}));

import { WriteFile } from '../../../src/gadgets/WriteFile.js';

let tmpDir: string;
let gadget: WriteFile;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'cascade-test-writefile-'));
	gadget = new WriteFile();
	mockMarkFileRead.mockClear();
	mockRunPostEditChecks.mockReturnValue(null);
	mockValidatePath.mockImplementation((path: string) => path);
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	vi.clearAllMocks();
});

describe('WriteFile', () => {
	describe('writing content', () => {
		it('writes content to a new file', () => {
			const filePath = join(tmpDir, 'new.txt');
			const content = 'Hello, World!';

			gadget.execute({ comment: 'test', filePath, content });

			expect(readFileSync(filePath, 'utf-8')).toBe(content);
		});

		it('returns byte count in output', () => {
			const filePath = join(tmpDir, 'bytes.txt');
			const content = 'Hello, World!'; // 13 bytes

			const result = gadget.execute({ comment: 'test', filePath, content });

			expect(result).toContain('Wrote 13 bytes');
		});

		it('includes the file path in output', () => {
			const filePath = join(tmpDir, 'path-check.txt');

			const result = gadget.execute({ comment: 'test', filePath, content: 'data' });

			expect(result).toContain(`path=${filePath}`);
		});

		it('overwrites existing file content', () => {
			const filePath = join(tmpDir, 'overwrite.txt');
			gadget.execute({ comment: 'initial', filePath, content: 'original content' });

			gadget.execute({ comment: 'overwrite', filePath, content: 'new content' });

			expect(readFileSync(filePath, 'utf-8')).toBe('new content');
		});

		it('correctly counts bytes for multi-byte unicode content', () => {
			const filePath = join(tmpDir, 'unicode.txt');
			const content = '€'; // 3 bytes in UTF-8

			const result = gadget.execute({ comment: 'test', filePath, content });

			expect(result).toContain('Wrote 3 bytes');
		});
	});

	describe('parent directory creation', () => {
		it('creates parent directories when they do not exist', () => {
			const filePath = join(tmpDir, 'nested', 'deep', 'file.txt');

			gadget.execute({ comment: 'test', filePath, content: 'nested content' });

			expect(existsSync(filePath)).toBe(true);
			expect(readFileSync(filePath, 'utf-8')).toBe('nested content');
		});

		it('includes directory creation note in output', () => {
			const filePath = join(tmpDir, 'subdir', 'file.txt');

			const result = gadget.execute({ comment: 'test', filePath, content: 'data' });

			expect(result).toContain('created directory');
		});

		it('does not mention directory creation when parent already exists', () => {
			const filePath = join(tmpDir, 'existing.txt');

			const result = gadget.execute({ comment: 'test', filePath, content: 'data' });

			expect(result).not.toContain('created directory');
		});
	});

	describe('read tracking', () => {
		it('calls markFileRead after writing a file', () => {
			const filePath = join(tmpDir, 'tracked.txt');

			gadget.execute({ comment: 'test', filePath, content: 'content' });

			expect(mockMarkFileRead).toHaveBeenCalledWith(filePath);
		});
	});

	describe('post-edit checks', () => {
		it('invokes runPostEditChecks for TypeScript files', () => {
			const filePath = join(tmpDir, 'module.ts');

			gadget.execute({ comment: 'test', filePath, content: 'export const x = 1;' });

			expect(mockRunPostEditChecks).toHaveBeenCalledWith(filePath, filePath);
		});

		it('invokes runPostEditChecks for non-TS files too', () => {
			const filePath = join(tmpDir, 'data.json');

			gadget.execute({ comment: 'test', filePath, content: '{}' });

			expect(mockRunPostEditChecks).toHaveBeenCalledWith(filePath, filePath);
		});

		it('returns status=error in output when diagnostics have errors', () => {
			const filePath = join(tmpDir, 'bad.ts');
			mockRunPostEditChecks.mockReturnValue({
				hasErrors: true,
				statusMessage: '⚠️ 1 type error',
			});

			const result = gadget.execute({ comment: 'test', filePath, content: 'const x: string = 1;' });

			expect(result).toContain('status=error');
		});

		it('returns status=success in output when diagnostics pass', () => {
			const filePath = join(tmpDir, 'good.ts');
			mockRunPostEditChecks.mockReturnValue({
				hasErrors: false,
				statusMessage: '✓ No issues',
			});

			const result = gadget.execute({ comment: 'test', filePath, content: 'const x = 1;' });

			expect(result).toContain('status=success');
		});

		it('includes diagnostic status message in output', () => {
			const filePath = join(tmpDir, 'check.ts');
			mockRunPostEditChecks.mockReturnValue({
				hasErrors: false,
				statusMessage: '✓ No issues',
			});

			const result = gadget.execute({ comment: 'test', filePath, content: 'export {};' });

			expect(result).toContain('✓ No issues');
		});
	});

	describe('path validation error handling', () => {
		it('returns error output when validatePath throws', () => {
			mockValidatePath.mockImplementationOnce(() => {
				throw new Error('Path not allowed: /etc/passwd');
			});

			const result = gadget.execute({
				comment: 'test',
				filePath: '/etc/passwd',
				content: 'bad',
			});

			expect(result).toContain('status=error');
			expect(result).toContain('Path not allowed');
		});
	});
});
