import { writeFileSync } from 'node:fs';

import { githubClient } from '../../../github/client.js';

type PRDiffFile = Awaited<ReturnType<typeof githubClient.getPRDiff>>[number];

/**
 * Filter the changed-file list by an optional path. Matches either the file's
 * current filename or its `previousFilename` (so renames are picked up).
 */
export function filterByPath(files: PRDiffFile[], path: string | undefined): PRDiffFile[] {
	if (!path) return files;
	return files.filter((f) => f.filename === path || f.previousFilename === path);
}

/**
 * Render a single changed file as a Markdown section: header + status + patch
 * fenced as a `diff` block (or the binary/too-large marker when no patch).
 *
 * Exported for unit tests; the formatter is a pure function of the file shape.
 */
export function formatPRDiffFile(file: PRDiffFile): string {
	const lines = [
		`## ${file.filename}`,
		`Status: ${file.status} | +${file.additions} -${file.deletions}`,
	];
	if (file.previousFilename) {
		lines.push(`Previous filename: ${file.previousFilename}`);
	}
	if (file.patch) {
		lines.push('```diff', file.patch, '```');
	} else {
		lines.push('[Binary file or too large to display]');
	}
	return lines.join('\n');
}

/**
 * Compose the full Markdown diff response from a (possibly path-filtered) file
 * list. Returns the "empty matches" sentinel when the list is empty so callers
 * can pass it straight through.
 */
export function formatPRDiffPayload(files: PRDiffFile[], path: string | undefined): string {
	if (files.length === 0) {
		return path ? `No changed file matched path: ${path}` : 'No files changed in this PR.';
	}
	const formatted = files.map((f) => formatPRDiffFile(f));
	return `${files.length} file(s) changed:\n\n${formatted.join('\n\n')}`;
}

/**
 * MNG-1059: the compact JSON summary returned when `--outputFile` is set.
 * Keeps the raw multi-megabyte diff text off stdout (terminal truncation,
 * agent context bloat) while preserving the cascade-tools JSON contract.
 */
export interface PRDiffFileOutputSummary {
	outputFile: string;
	fileCount: number;
	bytes: number;
	pathFilter?: string;
}

/**
 * Default mode (`outputFile` unset): returns the formatted Markdown diff string,
 * or an `Error fetching PR diff: <reason>` sentinel when the GitHub call throws —
 * preserved for backwards compatibility with existing callers and tests.
 *
 * File-output mode (`outputFile` set, MNG-1059): writes the formatted Markdown
 * to the requested path and returns a compact summary instead of the full
 * payload. In this mode, runtime errors are thrown so the CLI factory's
 * `runtime` envelope path surfaces them with structure agents can act on.
 *
 * Overloaded so callers that omit `outputFile` (the SDK gadget path) see a
 * `Promise<string>` return type, while callers that pass `outputFile` get
 * `Promise<PRDiffFileOutputSummary>`.
 */
export function getPRDiff(
	owner: string,
	repo: string,
	prNumber: number,
	path?: string,
): Promise<string>;
export function getPRDiff(
	owner: string,
	repo: string,
	prNumber: number,
	path: string | undefined,
	outputFile: string,
): Promise<PRDiffFileOutputSummary>;
export function getPRDiff(
	owner: string,
	repo: string,
	prNumber: number,
	path?: string,
	outputFile?: string,
): Promise<string | PRDiffFileOutputSummary>;
export async function getPRDiff(
	owner: string,
	repo: string,
	prNumber: number,
	path?: string,
	outputFile?: string,
): Promise<string | PRDiffFileOutputSummary> {
	if (outputFile) {
		// MNG-1059: file-output mode follows the README convention — fatal
		// failures throw so the CLI factory wraps them in the structured
		// `runtime` error envelope. Returning a sentinel here would conflict
		// with the summary-object return shape.
		const files = await githubClient.getPRDiff(owner, repo, prNumber);
		const filteredFiles = filterByPath(files, path);
		const payload = formatPRDiffPayload(filteredFiles, path);
		writeFileSync(outputFile, payload, 'utf-8');
		const summary: PRDiffFileOutputSummary = {
			outputFile,
			fileCount: filteredFiles.length,
			bytes: Buffer.byteLength(payload, 'utf-8'),
		};
		if (path !== undefined) summary.pathFilter = path;
		return summary;
	}

	try {
		const files = await githubClient.getPRDiff(owner, repo, prNumber);
		const filteredFiles = filterByPath(files, path);
		return formatPRDiffPayload(filteredFiles, path);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error fetching PR diff: ${message}`;
	}
}
