import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock pathValidation to allow temp directory paths in tests
vi.mock('../../../src/gadgets/shared/pathValidation.js', () => ({
	validatePath: vi.fn((path: string) => path),
}));

// Use vi.hoisted so mock variables are initialized before vi.mock is called
const { mockHasListedDirectory, mockMarkDirectoryListed } = vi.hoisted(() => ({
	mockHasListedDirectory: vi.fn().mockReturnValue(false),
	mockMarkDirectoryListed: vi.fn(),
}));

// Mock readTracking
vi.mock('../../../src/gadgets/readTracking.js', () => ({
	hasReadFile: vi.fn().mockReturnValue(false),
	markFileRead: vi.fn(),
	assertFileRead: vi.fn(),
	clearReadTracking: vi.fn(),
	invalidateFileRead: vi.fn(),
	hasListedDirectory: mockHasListedDirectory,
	markDirectoryListed: mockMarkDirectoryListed,
}));

// Mock execSync to avoid git calls in tests
vi.mock('node:child_process', () => ({
	execSync: vi.fn(() => {
		throw new Error('not a git repo');
	}),
}));

import { ListDirectory } from '../../../src/gadgets/ListDirectory.js';

let tmpDir: string;
let gadget: ListDirectory;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'cascade-test-listdir-'));
	gadget = new ListDirectory();
	mockHasListedDirectory.mockReturnValue(false);
	mockMarkDirectoryListed.mockClear();
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	vi.clearAllMocks();
});

function createFile(name: string, content = 'content'): string {
	const filePath = join(tmpDir, name);
	writeFileSync(filePath, content, 'utf-8');
	return filePath;
}

function createDir(name: string): string {
	const dirPath = join(tmpDir, name);
	mkdirSync(dirPath, { recursive: true });
	return dirPath;
}

describe('ListDirectory', () => {
	describe('listing files and directories', () => {
		it('lists files in a directory', () => {
			createFile('file1.txt', 'a');
			createFile('file2.txt', 'b');

			const result = gadget.execute({
				comment: 'test',
				directoryPath: tmpDir,
				maxDepth: 1,
				includeGitIgnored: true,
			});

			expect(result).toContain('file1.txt');
			expect(result).toContain('file2.txt');
		});

		it('lists directories in a directory', () => {
			createDir('subdir');

			const result = gadget.execute({
				comment: 'test',
				directoryPath: tmpDir,
				maxDepth: 1,
				includeGitIgnored: true,
			});

			expect(result).toContain('subdir');
		});

		it('includes path and options header in output', () => {
			const result = gadget.execute({
				comment: 'test',
				directoryPath: tmpDir,
				maxDepth: 1,
				includeGitIgnored: true,
			});

			expect(result).toContain(`path=${tmpDir}`);
			expect(result).toContain('maxDepth=1');
			expect(result).toContain('includeGitIgnored=true');
		});

		it('uses pipe-delimited format with column header', () => {
			createFile('sample.txt', 'hello');

			const result = gadget.execute({
				comment: 'test',
				directoryPath: tmpDir,
				maxDepth: 1,
				includeGitIgnored: true,
			});

			// Should have header
			expect(result).toContain('#T|N|S|A');
			// Files use 'F' type code
			expect(result).toContain('F|');
		});

		it('uses D type code for directories', () => {
			createDir('mydir');

			const result = gadget.execute({
				comment: 'test',
				directoryPath: tmpDir,
				maxDepth: 1,
				includeGitIgnored: true,
			});

			expect(result).toContain('D|');
		});

		it('skips hidden files (starting with dot)', () => {
			createFile('.hidden', 'secret');
			createFile('visible.txt', 'shown');

			const result = gadget.execute({
				comment: 'test',
				directoryPath: tmpDir,
				maxDepth: 1,
				includeGitIgnored: true,
			});

			expect(result).not.toContain('.hidden');
			expect(result).toContain('visible.txt');
		});
	});

	describe('already-listed cache', () => {
		it('returns already-listed message when directory was previously listed', () => {
			mockHasListedDirectory.mockReturnValue(true);

			const result = gadget.execute({
				comment: 'test',
				directoryPath: tmpDir,
				maxDepth: 1,
				includeGitIgnored: true,
			});

			expect(result).toContain('[Already listed - refer to previous content in context]');
		});

		it('calls markDirectoryListed after listing', () => {
			gadget.execute({
				comment: 'test',
				directoryPath: tmpDir,
				maxDepth: 1,
				includeGitIgnored: true,
			});

			expect(mockMarkDirectoryListed).toHaveBeenCalled();
		});

		it('does not call markDirectoryListed when already listed', () => {
			mockHasListedDirectory.mockReturnValue(true);

			gadget.execute({
				comment: 'test',
				directoryPath: tmpDir,
				maxDepth: 1,
				includeGitIgnored: true,
			});

			expect(mockMarkDirectoryListed).not.toHaveBeenCalled();
		});
	});

	describe('formatAge helper behavior', () => {
		it('shows age in seconds for very recent files', () => {
			createFile('recent.txt', 'new');

			const result = gadget.execute({
				comment: 'test',
				directoryPath: tmpDir,
				maxDepth: 1,
				includeGitIgnored: true,
			});

			// Recently created file should show seconds
			expect(result).toMatch(/\d+s/);
		});
	});

	describe('encodeName helper behavior', () => {
		it('escapes pipe characters in file names', () => {
			// Create a file with a pipe in its name
			const filePath = join(tmpDir, 'file|name.txt');
			writeFileSync(filePath, 'content', 'utf-8');

			const result = gadget.execute({
				comment: 'test',
				directoryPath: tmpDir,
				maxDepth: 1,
				includeGitIgnored: true,
			});

			// Pipe should be escaped as \|
			expect(result).toContain('file\\|name.txt');
		});
	});

	describe('maxDepth recursion', () => {
		it('lists nested files within maxDepth', () => {
			createDir('level1');
			writeFileSync(join(tmpDir, 'level1', 'nested.txt'), 'deep', 'utf-8');

			const result = gadget.execute({
				comment: 'test',
				directoryPath: tmpDir,
				maxDepth: 2,
				includeGitIgnored: true,
			});

			expect(result).toContain('nested.txt');
		});

		it('does not list files beyond maxDepth', () => {
			mkdirSync(join(tmpDir, 'a', 'b', 'c'), { recursive: true });
			writeFileSync(join(tmpDir, 'a', 'b', 'c', 'deep.txt'), 'deep', 'utf-8');

			const result = gadget.execute({
				comment: 'test',
				directoryPath: tmpDir,
				maxDepth: 1,
				includeGitIgnored: true,
			});

			expect(result).not.toContain('deep.txt');
		});
	});

	describe('error handling', () => {
		it('throws when path is not a directory', () => {
			const filePath = createFile('notadir.txt', 'content');

			expect(() =>
				gadget.execute({
					comment: 'test',
					directoryPath: filePath,
					maxDepth: 1,
					includeGitIgnored: true,
				}),
			).toThrow(/not a directory/i);
		});
	});
});
