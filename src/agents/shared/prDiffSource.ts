import type { PRDiffFile } from '../../github/client.js';
import { runCommand } from '../../utils/repo.js';
import type { LogWriter } from '../contracts/index.js';

export type PatchSourceStatus = 'local-git' | 'local-diff-empty' | 'local-diff-failed' | 'no-patch';

export interface EnrichedPRDiffFile extends PRDiffFile {
	patchSource: PatchSourceStatus;
	localPatchChars: number;
	githubPatchChars: number;
	localHunkCount: number;
	githubHunkCount: number;
	localDiffError?: string;
}

export interface DiffSourceMismatch {
	filename: string;
	localPatchChars: number;
	githubPatchChars: number;
	localHunkCount: number;
	githubHunkCount: number;
}

export interface PRDiffSourceResult {
	files: EnrichedPRDiffFile[];
	mismatches: DiffSourceMismatch[];
}

function countDiffHunks(patch: string | undefined): number {
	if (!patch) return 0;
	return patch.match(/^@@ /gm)?.length ?? 0;
}

function hasMismatch(file: EnrichedPRDiffFile): boolean {
	return (
		file.patchSource === 'local-git' &&
		(file.localPatchChars !== file.githubPatchChars || file.localHunkCount !== file.githubHunkCount)
	);
}

function summarizeFailure(stderr: string, stdout: string): string {
	const text = (stderr || stdout || 'git diff failed').trim();
	return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

/**
 * Build the fail-closed result when `git fetch origin <base>` fails.
 * With a stale origin/<base>, per-file diffs can succeed against the old ref
 * and include base-branch-only commits — producing a misleading 'local-git'
 * patch. Deleted files get 'no-patch'; all others get 'local-diff-failed' so
 * the review agent can fetch verified patches on demand.
 */
function buildFetchFailedFiles(files: PRDiffFile[], fetchError: string): EnrichedPRDiffFile[] {
	return files.map((file) => {
		const githubPatchChars = file.patch?.length ?? 0;
		const githubHunkCount = countDiffHunks(file.patch);
		if (file.status === 'removed') {
			return {
				...file,
				patchSource: 'no-patch' as const,
				localPatchChars: 0,
				githubPatchChars,
				localHunkCount: 0,
				githubHunkCount,
				patch: undefined,
			};
		}
		return {
			...file,
			patch: undefined,
			patchSource: 'local-diff-failed' as const,
			localPatchChars: 0,
			githubPatchChars,
			localHunkCount: 0,
			githubHunkCount,
			localDiffError: `base-ref fetch failed: ${fetchError}`,
		};
	});
}

export async function sourceLocalPRDiffs(params: {
	files: PRDiffFile[];
	repoDir: string;
	baseBranch: string;
	logWriter: LogWriter;
}): Promise<PRDiffSourceResult> {
	const enriched: EnrichedPRDiffFile[] = [];
	const mismatches: DiffSourceMismatch[] = [];

	// Refresh origin/<baseBranch> so stale snapshot refs don't produce patches
	// that include base-branch commits that aren't part of this PR.
	// Snapshot-reuse PR setup only fetches refs/pull/N/head; origin/<base> can
	// lag. If the fetch fails (no network, no remote) we fail closed — see the
	// handler below.
	const fetchResult = await runCommand(
		'git',
		['fetch', 'origin', params.baseBranch],
		params.repoDir,
		undefined,
		{ silent: true, label: `fetch-base-branch:${params.baseBranch}` },
	);
	if (fetchResult.exitCode !== 0) {
		const fetchError = summarizeFailure(fetchResult.stderr, fetchResult.stdout);
		params.logWriter('WARN', 'Failed to refresh base branch ref before local diff', {
			baseBranch: params.baseBranch,
			exitCode: fetchResult.exitCode,
			reason: fetchResult.reason,
			error: fetchError,
		});
		return { files: buildFetchFailedFiles(params.files, fetchError), mismatches };
	}

	for (const file of params.files) {
		const githubPatchChars = file.patch?.length ?? 0;
		const githubHunkCount = countDiffHunks(file.patch);
		if (file.status === 'removed') {
			enriched.push({
				...file,
				patchSource: 'no-patch',
				localPatchChars: 0,
				githubPatchChars,
				localHunkCount: 0,
				githubHunkCount,
				patch: undefined,
			});
			continue;
		}

		// For renamed files, supply both the old and new literal paths so git
		// can emit proper 'rename from / rename to' metadata. With only the
		// destination path, git emits 'new file mode' and marks every line as
		// added — a misleading patch for a pure or near-pure rename. The old
		// path is always listed first (before the new path) so git's rename
		// detection algorithm pairs them correctly.
		const pathspecs: string[] = [`:(literal)${file.filename}`];
		if (file.previousFilename) {
			pathspecs.unshift(`:(literal)${file.previousFilename}`);
		}

		const result = await runCommand(
			'git',
			[
				'diff',
				'--no-color',
				'--no-ext-diff',
				'--find-renames',
				'--find-copies',
				`origin/${params.baseBranch}...HEAD`,
				'--',
				...pathspecs,
			],
			params.repoDir,
			undefined,
			{ silent: true, label: `local-pr-diff:${file.filename}` },
		);

		if (result.exitCode !== 0) {
			const localDiffError = summarizeFailure(result.stderr, result.stdout);
			params.logWriter('WARN', 'Local PR diff failed for changed file', {
				filename: file.filename,
				previousFilename: file.previousFilename,
				baseBranch: params.baseBranch,
				exitCode: result.exitCode,
				reason: result.reason,
				error: localDiffError,
			});
			enriched.push({
				...file,
				patch: undefined,
				patchSource: 'local-diff-failed',
				localPatchChars: 0,
				githubPatchChars,
				localHunkCount: 0,
				githubHunkCount,
				localDiffError,
			});
			continue;
		}

		const patch = result.stdout.trimEnd();
		const localPatchChars = patch.length;
		const localHunkCount = countDiffHunks(patch);
		const patchSource: PatchSourceStatus =
			patch.length > 0 ? 'local-git' : file.patch ? 'local-diff-empty' : 'no-patch';
		const enrichedFile: EnrichedPRDiffFile = {
			...file,
			patch,
			patchSource,
			localPatchChars,
			githubPatchChars,
			localHunkCount,
			githubHunkCount,
		};
		enriched.push(enrichedFile);
		if (hasMismatch(enrichedFile)) {
			mismatches.push({
				filename: file.filename,
				localPatchChars,
				githubPatchChars,
				localHunkCount,
				githubHunkCount,
			});
		}
	}

	return { files: enriched, mismatches };
}
