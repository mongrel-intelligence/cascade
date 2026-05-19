import { mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/github/client.js', () => ({
	githubClient: {
		getPRDiff: vi.fn(),
	},
}));

import {
	filterByPath,
	formatPRDiffFile,
	formatPRDiffPayload,
	getPRDiff,
} from '../../../../../src/gadgets/github/core/getPRDiff.js';
import { githubClient } from '../../../../../src/github/client.js';

const mockGithub = vi.mocked(githubClient);

describe('getPRDiff', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns formatted diff output with file count and patches on success', async () => {
		mockGithub.getPRDiff.mockResolvedValue([
			{
				filename: 'src/foo.ts',
				status: 'modified',
				additions: 5,
				deletions: 2,
				patch: '@@ -1,2 +1,5 @@\n-old line\n+new line\n+another line',
			},
		] as Awaited<ReturnType<typeof mockGithub.getPRDiff>>);

		const result = await getPRDiff('owner', 'repo', 42);

		expect(result).toContain('1 file(s) changed:');
		expect(result).toContain('## src/foo.ts');
		expect(result).toContain('Status: modified | +5 -2');
		expect(result).toContain('```diff');
		expect(result).toContain('@@ -1,2 +1,5 @@');
		expect(result).toContain('```');
	});

	it('uses "[Binary file or too large to display]" for files without patch', async () => {
		mockGithub.getPRDiff.mockResolvedValue([
			{
				filename: 'assets/image.png',
				status: 'added',
				additions: 0,
				deletions: 0,
				patch: undefined,
			},
		] as Awaited<ReturnType<typeof mockGithub.getPRDiff>>);

		const result = await getPRDiff('owner', 'repo', 42);

		expect(result).toContain('1 file(s) changed:');
		expect(result).toContain('## assets/image.png');
		expect(result).toContain('[Binary file or too large to display]');
		expect(result).not.toContain('```diff');
	});

	it('returns "No files changed" when file list is empty', async () => {
		mockGithub.getPRDiff.mockResolvedValue([] as Awaited<ReturnType<typeof mockGithub.getPRDiff>>);

		const result = await getPRDiff('owner', 'repo', 42);

		expect(result).toBe('No files changed in this PR.');
	});

	it('filters by current or previous filename when path is supplied', async () => {
		mockGithub.getPRDiff.mockResolvedValue([
			{
				filename: 'src/new.ts',
				previousFilename: 'src/old.ts',
				status: 'renamed',
				additions: 1,
				deletions: 1,
				changes: 2,
				patch: '@@ -1 +1 @@',
			},
			{
				filename: 'src/other.ts',
				status: 'modified',
				additions: 1,
				deletions: 0,
				changes: 1,
				patch: '@@ -2 +2 @@',
			},
		] as Awaited<ReturnType<typeof mockGithub.getPRDiff>>);

		const result = await getPRDiff('owner', 'repo', 42, 'src/old.ts');

		expect(result).toContain('1 file(s) changed:');
		expect(result).toContain('## src/new.ts');
		expect(result).toContain('Previous filename: src/old.ts');
		expect(result).not.toContain('src/other.ts');
	});

	it('returns a clear message when path filter matches no changed file', async () => {
		mockGithub.getPRDiff.mockResolvedValue([
			{
				filename: 'src/other.ts',
				status: 'modified',
				additions: 1,
				deletions: 0,
				changes: 1,
				patch: '@@ -2 +2 @@',
			},
		] as Awaited<ReturnType<typeof mockGithub.getPRDiff>>);

		const result = await getPRDiff('owner', 'repo', 42, 'src/missing.ts');

		expect(result).toBe('No changed file matched path: src/missing.ts');
	});

	it('returns error message string when githubClient throws', async () => {
		mockGithub.getPRDiff.mockRejectedValue(new Error('API rate limit exceeded'));

		const result = await getPRDiff('owner', 'repo', 42);

		expect(result).toBe('Error fetching PR diff: API rate limit exceeded');
	});
});

// ---------------------------------------------------------------------------
// MNG-1059: formatting helpers are pure and testable in isolation.
// ---------------------------------------------------------------------------

describe('filterByPath', () => {
	const files = [
		{
			filename: 'src/new.ts',
			previousFilename: 'src/old.ts',
			status: 'renamed' as const,
			additions: 1,
			deletions: 1,
			changes: 2,
		},
		{
			filename: 'src/other.ts',
			status: 'modified' as const,
			additions: 1,
			deletions: 0,
			changes: 1,
		},
	] as Awaited<ReturnType<typeof mockGithub.getPRDiff>>;

	it('returns the full list when path is undefined', () => {
		expect(filterByPath(files, undefined)).toHaveLength(2);
	});

	it('matches on current filename', () => {
		const result = filterByPath(files, 'src/other.ts');
		expect(result).toHaveLength(1);
		expect(result[0].filename).toBe('src/other.ts');
	});

	it('matches on previousFilename for renames', () => {
		const result = filterByPath(files, 'src/old.ts');
		expect(result).toHaveLength(1);
		expect(result[0].filename).toBe('src/new.ts');
	});

	it('returns empty when path does not match', () => {
		expect(filterByPath(files, 'src/missing.ts')).toEqual([]);
	});
});

describe('formatPRDiffFile', () => {
	it('renders header + status + diff fence when patch present', () => {
		const file = {
			filename: 'src/x.ts',
			status: 'modified',
			additions: 3,
			deletions: 1,
			patch: '@@ -1 +1 @@\n-old\n+new',
		} as Awaited<ReturnType<typeof mockGithub.getPRDiff>>[number];

		const result = formatPRDiffFile(file);
		expect(result).toContain('## src/x.ts');
		expect(result).toContain('Status: modified | +3 -1');
		expect(result).toContain('```diff');
		expect(result).toContain('@@ -1 +1 @@');
	});

	it('renders previousFilename when present (rename)', () => {
		const file = {
			filename: 'src/new.ts',
			previousFilename: 'src/old.ts',
			status: 'renamed',
			additions: 0,
			deletions: 0,
			patch: '@@ -1 +1 @@',
		} as Awaited<ReturnType<typeof mockGithub.getPRDiff>>[number];

		const result = formatPRDiffFile(file);
		expect(result).toContain('Previous filename: src/old.ts');
	});

	it('renders binary/too-large marker when patch is missing', () => {
		const file = {
			filename: 'images/logo.png',
			status: 'added',
			additions: 0,
			deletions: 0,
			patch: undefined,
		} as Awaited<ReturnType<typeof mockGithub.getPRDiff>>[number];

		const result = formatPRDiffFile(file);
		expect(result).toContain('[Binary file or too large to display]');
		expect(result).not.toContain('```diff');
	});
});

describe('formatPRDiffPayload', () => {
	it('returns "No files changed" for empty list with no path', () => {
		expect(formatPRDiffPayload([], undefined)).toBe('No files changed in this PR.');
	});

	it('returns path-specific message for empty list with path filter', () => {
		expect(formatPRDiffPayload([], 'src/missing.ts')).toBe(
			'No changed file matched path: src/missing.ts',
		);
	});

	it('prefixes with file count and joins sections with double newline', () => {
		const files = [
			{
				filename: 'a.ts',
				status: 'modified',
				additions: 1,
				deletions: 0,
				patch: '@@ -1 +1 @@\n+x',
			},
			{
				filename: 'b.ts',
				status: 'added',
				additions: 2,
				deletions: 0,
				patch: '@@ -0,0 +1,2 @@\n+a\n+b',
			},
		] as Awaited<ReturnType<typeof mockGithub.getPRDiff>>;

		const result = formatPRDiffPayload(files, undefined);
		expect(result.startsWith('2 file(s) changed:')).toBe(true);
		expect(result).toContain('## a.ts');
		expect(result).toContain('## b.ts');
	});
});

// ---------------------------------------------------------------------------
// MNG-1059: --outputFile mode
// ---------------------------------------------------------------------------

describe('getPRDiff with --outputFile', () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), 'cascade-prdiff-output-test-'));
		vi.clearAllMocks();
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it('writes the full formatted diff to disk and returns compact summary', async () => {
		mockGithub.getPRDiff.mockResolvedValue([
			{
				filename: 'src/foo.ts',
				status: 'modified',
				additions: 5,
				deletions: 2,
				patch: '@@ -1,2 +1,5 @@\n-old\n+new\n+another',
			},
		] as Awaited<ReturnType<typeof mockGithub.getPRDiff>>);

		const outputPath = join(tmpDir, 'diff.md');
		const result = await getPRDiff('owner', 'repo', 42, undefined, outputPath);

		// Returned value is the compact JSON summary, not the raw diff text.
		expect(typeof result).toBe('object');
		const summary = result as {
			outputFile: string;
			fileCount: number;
			bytes: number;
			pathFilter?: string;
		};
		expect(summary.outputFile).toBe(outputPath);
		expect(summary.fileCount).toBe(1);
		expect(summary.bytes).toBeGreaterThan(0);
		expect(summary.pathFilter).toBeUndefined();

		// The full multi-line diff is on disk.
		const written = readFileSync(outputPath, 'utf-8');
		expect(written).toContain('## src/foo.ts');
		expect(written).toContain('@@ -1,2 +1,5 @@');
		expect(Buffer.byteLength(written, 'utf-8')).toBe(summary.bytes);
	});

	it('keeps stdout small even with a giant one-line JSON patch', async () => {
		// Synthesize an absurdly large single-line JSON diff (the MNG-1045 case).
		const bigPatch = `@@ -1,1 +1,1 @@\n-${'x'.repeat(50_000)}\n+${'y'.repeat(50_000)}`;
		mockGithub.getPRDiff.mockResolvedValue([
			{
				filename: 'huge.json',
				status: 'modified',
				additions: 1,
				deletions: 1,
				patch: bigPatch,
			},
		] as Awaited<ReturnType<typeof mockGithub.getPRDiff>>);

		const outputPath = join(tmpDir, 'huge.md');
		const result = await getPRDiff('owner', 'repo', 42, undefined, outputPath);

		const summary = result as { outputFile: string; fileCount: number; bytes: number };
		// Summary stays tiny — only a handful of fields, well under 1KB
		// regardless of how big the patch grows.
		const summaryJsonSize = JSON.stringify(summary).length;
		expect(summaryJsonSize).toBeLessThan(500);

		// But the actual file on disk holds the full payload (>100KB).
		const written = readFileSync(outputPath, 'utf-8');
		expect(written.length).toBeGreaterThan(100_000);
		expect(summary.bytes).toBeGreaterThan(100_000);
	});

	it('records pathFilter on the summary when --path is supplied', async () => {
		mockGithub.getPRDiff.mockResolvedValue([
			{
				filename: 'src/foo.ts',
				status: 'modified',
				additions: 1,
				deletions: 1,
				patch: '@@ -1 +1 @@',
			},
		] as Awaited<ReturnType<typeof mockGithub.getPRDiff>>);

		const outputPath = join(tmpDir, 'diff.md');
		const result = await getPRDiff('owner', 'repo', 42, 'src/foo.ts', outputPath);
		const summary = result as { pathFilter?: string };
		expect(summary.pathFilter).toBe('src/foo.ts');
	});

	it('writes the no-match sentinel to disk when path filter produces 0 matches', async () => {
		mockGithub.getPRDiff.mockResolvedValue([
			{
				filename: 'src/other.ts',
				status: 'modified',
				additions: 1,
				deletions: 0,
				patch: '@@ -1 +1 @@',
			},
		] as Awaited<ReturnType<typeof mockGithub.getPRDiff>>);

		const outputPath = join(tmpDir, 'diff.md');
		const result = await getPRDiff('owner', 'repo', 42, 'src/missing.ts', outputPath);
		const summary = result as { fileCount: number; pathFilter?: string };
		expect(summary.fileCount).toBe(0);
		expect(summary.pathFilter).toBe('src/missing.ts');
		const written = readFileSync(outputPath, 'utf-8');
		expect(written).toBe('No changed file matched path: src/missing.ts');
	});

	it('throws on githubClient failure (outputFile mode follows the throw convention)', async () => {
		mockGithub.getPRDiff.mockRejectedValue(new Error('API rate limit'));
		const outputPath = join(tmpDir, 'diff.md');

		await expect(getPRDiff('owner', 'repo', 42, undefined, outputPath)).rejects.toThrow(
			'API rate limit',
		);
	});
});
