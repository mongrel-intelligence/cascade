import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logging.js', () => ({
	logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock config to control thresholds in tests
vi.mock('../../../src/config/claudeCodeConfig.js', () => ({
	CONTEXT_OFFLOAD_CONFIG: {
		inlineThreshold: 8_000,
		contextDir: '.cascade/context',
		enabled: true,
	},
}));

import {
	buildInlineContextSection,
	cleanupContextFiles,
	offloadLargeContext,
} from '../../../src/backends/claude-code/contextFiles.js';
import type { ContextInjection } from '../../../src/backends/types.js';
import { CONTEXT_OFFLOAD_CONFIG } from '../../../src/config/claudeCodeConfig.js';

describe('offloadLargeContext', () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), 'cascade-test-context-'));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it('keeps small context inline', async () => {
		const smallInjection: ContextInjection = {
			toolName: 'ReadPR',
			params: { prNumber: 42 },
			result: 'Small PR description',
			description: 'PR Details',
		};

		const result = await offloadLargeContext(tempDir, [smallInjection]);

		expect(result.inlineInjections).toHaveLength(1);
		expect(result.inlineInjections[0]).toBe(smallInjection);
		expect(result.offloadedFiles).toHaveLength(0);
		expect(result.instructions).toBe('');
	});

	it('offloads large context to files', async () => {
		// Create content larger than threshold (~8000 tokens = ~32000 chars)
		const largeContent = 'A'.repeat(40_000);
		const largeInjection: ContextInjection = {
			toolName: 'GetPRDiff',
			params: { prNumber: 42 },
			result: largeContent,
			description: 'PR Diff',
		};

		const result = await offloadLargeContext(tempDir, [largeInjection]);

		expect(result.inlineInjections).toHaveLength(0);
		expect(result.offloadedFiles).toHaveLength(1);
		expect(result.offloadedFiles[0].description).toBe('PR Diff');
		expect(result.offloadedFiles[0].tokens).toBe(10_000);
		expect(result.offloadedFiles[0].relativePath).toContain('.cascade/context/');

		// Verify file was written
		const filePath = join(tempDir, result.offloadedFiles[0].relativePath);
		expect(existsSync(filePath)).toBe(true);
		expect(readFileSync(filePath, 'utf-8')).toBe(largeContent);

		// Verify instructions are generated
		expect(result.instructions).toContain('Context Files');
		expect(result.instructions).toContain('pr-diff-0.txt');
		expect(result.instructions).toContain('Read tool');
	});

	it('handles mixed sizes correctly', async () => {
		const smallInjection: ContextInjection = {
			toolName: 'ReadPR',
			params: { prNumber: 42 },
			result: 'Small content',
			description: 'PR Details',
		};

		const largeInjection: ContextInjection = {
			toolName: 'GetPRDiff',
			params: { prNumber: 42 },
			result: 'B'.repeat(50_000),
			description: 'PR Diff',
		};

		const mediumInjection: ContextInjection = {
			toolName: 'GetFileContents',
			params: { files: ['a.ts'] },
			result: 'Medium content that is still small',
			description: 'File Contents',
		};

		const result = await offloadLargeContext(tempDir, [
			smallInjection,
			largeInjection,
			mediumInjection,
		]);

		expect(result.inlineInjections).toHaveLength(2);
		expect(result.inlineInjections).toContain(smallInjection);
		expect(result.inlineInjections).toContain(mediumInjection);
		expect(result.offloadedFiles).toHaveLength(1);
		expect(result.offloadedFiles[0].description).toBe('PR Diff');
	});

	it('handles empty injections', async () => {
		const result = await offloadLargeContext(tempDir, []);

		expect(result.inlineInjections).toHaveLength(0);
		expect(result.offloadedFiles).toHaveLength(0);
		expect(result.instructions).toBe('');
	});

	it('generates unique filenames from descriptions with index suffix', async () => {
		const injection1: ContextInjection = {
			toolName: 'GetPRDiff',
			params: {},
			result: 'C'.repeat(40_000),
			description: 'PR Diff for Feature Branch',
		};

		const injection2: ContextInjection = {
			toolName: 'GetFileContents',
			params: {},
			result: 'D'.repeat(40_000),
			description: 'File Contents: src/index.ts',
		};

		const result = await offloadLargeContext(tempDir, [injection1, injection2]);

		expect(result.offloadedFiles).toHaveLength(2);
		// Filenames include index for uniqueness
		expect(result.offloadedFiles[0].relativePath).toBe(
			'.cascade/context/pr-diff-for-feature-branch-0.txt',
		);
		expect(result.offloadedFiles[1].relativePath).toBe(
			'.cascade/context/file-contents-src-index-ts-1.txt',
		);
	});

	it('handles duplicate descriptions without collision', async () => {
		const injection1: ContextInjection = {
			toolName: 'GetDiff',
			params: {},
			result: 'A'.repeat(40_000),
			description: 'PR Diff', // Same description
		};
		const injection2: ContextInjection = {
			toolName: 'GetDiff',
			params: {},
			result: 'B'.repeat(40_000),
			description: 'PR Diff', // Same description
		};

		const result = await offloadLargeContext(tempDir, [injection1, injection2]);

		expect(result.offloadedFiles).toHaveLength(2);
		// Filenames should be different due to index
		expect(result.offloadedFiles[0].relativePath).toBe('.cascade/context/pr-diff-0.txt');
		expect(result.offloadedFiles[1].relativePath).toBe('.cascade/context/pr-diff-1.txt');

		// Verify both files exist with different content
		const file1 = readFileSync(join(tempDir, result.offloadedFiles[0].relativePath), 'utf-8');
		const file2 = readFileSync(join(tempDir, result.offloadedFiles[1].relativePath), 'utf-8');
		expect(file1).toBe('A'.repeat(40_000));
		expect(file2).toBe('B'.repeat(40_000));
	});

	it('handles empty description', async () => {
		const injection: ContextInjection = {
			toolName: 'GetDiff',
			params: {},
			result: 'A'.repeat(40_000),
			description: '',
		};

		const result = await offloadLargeContext(tempDir, [injection]);

		expect(result.offloadedFiles).toHaveLength(1);
		// Empty description falls back to 'context' prefix
		expect(result.offloadedFiles[0].relativePath).toBe('.cascade/context/context-0.txt');
	});

	it('handles description with only special characters', async () => {
		const injection: ContextInjection = {
			toolName: 'GetDiff',
			params: {},
			result: 'A'.repeat(40_000),
			description: '!@#$%^&*()',
		};

		const result = await offloadLargeContext(tempDir, [injection]);

		expect(result.offloadedFiles).toHaveLength(1);
		// Special chars stripped, falls back to 'context' prefix
		expect(result.offloadedFiles[0].relativePath).toBe('.cascade/context/context-0.txt');
	});

	it('truncates very long descriptions', async () => {
		const longDescription = 'a'.repeat(100); // 100 chars
		const injection: ContextInjection = {
			toolName: 'GetDiff',
			params: {},
			result: 'A'.repeat(40_000),
			description: longDescription,
		};

		const result = await offloadLargeContext(tempDir, [injection]);

		expect(result.offloadedFiles).toHaveLength(1);
		// Description truncated to 40 chars + index
		const filename = result.offloadedFiles[0].relativePath.split('/').pop() ?? '';
		expect(filename).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-0.txt');
		expect(filename.length).toBeLessThan(50); // Reasonable filename length
	});
});

describe('cleanupContextFiles', () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), 'cascade-test-cleanup-'));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it('removes context directory and files', async () => {
		const contextDir = join(tempDir, CONTEXT_OFFLOAD_CONFIG.contextDir);
		await mkdir(contextDir, { recursive: true });
		await writeFile(join(contextDir, 'test.txt'), 'content');

		expect(existsSync(contextDir)).toBe(true);

		await cleanupContextFiles(tempDir);

		expect(existsSync(contextDir)).toBe(false);
	});

	it('does not throw when directory does not exist', async () => {
		await expect(cleanupContextFiles(tempDir)).resolves.not.toThrow();
	});
});

describe('buildInlineContextSection', () => {
	it('returns empty string for empty injections', () => {
		expect(buildInlineContextSection([])).toBe('');
	});

	it('formats injections correctly', () => {
		const injections: ContextInjection[] = [
			{
				toolName: 'ReadPR',
				params: { prNumber: 42 },
				result: 'PR content here',
				description: 'PR Details',
			},
		];

		const section = buildInlineContextSection(injections);

		expect(section).toContain('## Pre-loaded Context');
		expect(section).toContain('### PR Details (ReadPR)');
		expect(section).toContain('"prNumber":42');
		expect(section).toContain('PR content here');
	});

	it('formats multiple injections', () => {
		const injections: ContextInjection[] = [
			{
				toolName: 'ReadPR',
				params: { prNumber: 1 },
				result: 'First content',
				description: 'First Section',
			},
			{
				toolName: 'GetDiff',
				params: { prNumber: 1 },
				result: 'Second content',
				description: 'Second Section',
			},
		];

		const section = buildInlineContextSection(injections);

		expect(section).toContain('### First Section (ReadPR)');
		expect(section).toContain('### Second Section (GetDiff)');
		expect(section).toContain('First content');
		expect(section).toContain('Second content');
	});
});

describe('offloadLargeContext with disabled config', () => {
	it('keeps all context inline when disabled', async () => {
		// Override the mock for this specific test
		const configModule = await import('../../../src/config/claudeCodeConfig.js');
		const originalEnabled = configModule.CONTEXT_OFFLOAD_CONFIG.enabled;
		configModule.CONTEXT_OFFLOAD_CONFIG.enabled = false;

		const tempDir = mkdtempSync(join(tmpdir(), 'cascade-test-disabled-'));

		try {
			const largeInjection: ContextInjection = {
				toolName: 'GetPRDiff',
				params: {},
				result: 'E'.repeat(50_000),
				description: 'Large Content',
			};

			const result = await offloadLargeContext(tempDir, [largeInjection]);

			expect(result.inlineInjections).toHaveLength(1);
			expect(result.offloadedFiles).toHaveLength(0);
			expect(result.instructions).toBe('');
		} finally {
			configModule.CONTEXT_OFFLOAD_CONFIG.enabled = originalEnabled;
			await rm(tempDir, { recursive: true, force: true });
		}
	});
});
