import { estimateTokens, REVIEW_DIFF_CONTEXT_TOKEN_LIMIT } from '../../config/reviewConfig.js';
import type { githubClient } from '../../github/client.js';
import type { EnrichedPRDiffFile, PatchSourceStatus } from './prDiffSource.js';

type PRDetails = Awaited<ReturnType<typeof githubClient.getPR>>;
type PRDiff = Awaited<ReturnType<typeof githubClient.getPRDiff>>;
type PRComments = Awaited<ReturnType<typeof githubClient.getPRReviewComments>>;
type PRReviews = Awaited<ReturnType<typeof githubClient.getPRReviews>>;
type PRIssueComments = Awaited<ReturnType<typeof githubClient.getPRIssueComments>>;

export type { PRComments, PRDetails, PRDiff, PRIssueComments, PRReviews };

export function formatPRDetails(prDetails: PRDetails): string {
	return [
		`PR #${prDetails.number}: ${prDetails.title}`,
		`State: ${prDetails.state}`,
		`Branch: ${prDetails.headRef} -> ${prDetails.baseRef}`,
		`URL: ${prDetails.htmlUrl}`,
		'',
		'Description:',
		prDetails.body || '(no description)',
	].join('\n');
}

export function formatPRDiff(prDiff: PRDiff): string {
	if (prDiff.length === 0) {
		return 'No files changed in this PR.';
	}

	const formatted = prDiff.map((f) => {
		const lines = [`## ${f.filename}`, `Status: ${f.status} | +${f.additions} -${f.deletions}`];
		if (f.patch) {
			lines.push('```diff', f.patch, '```');
		} else {
			lines.push('[Binary file or too large to display]');
		}
		return lines.join('\n');
	});

	return `${prDiff.length} file(s) changed:\n\n${formatted.join('\n\n')}`;
}

export function formatPRComments(prComments: PRComments): string {
	if (prComments.length === 0) {
		return 'No review comments found.';
	}

	return prComments
		.map((c) =>
			[
				`Comment #${c.id} by @${c.user.login}`,
				`File: ${c.path}${c.line ? `:${c.line}` : ''}`,
				`URL: ${c.htmlUrl}`,
				c.inReplyToId ? `In reply to: #${c.inReplyToId}` : null,
				'',
				c.body,
				'---',
			]
				.filter(Boolean)
				.join('\n'),
		)
		.join('\n\n');
}

export function formatPRReviews(prReviews: PRReviews): string {
	// Filter to reviews that have body text (the main review comment)
	const reviewsWithBody = prReviews.filter((r) => r.body && r.body.trim().length > 0);

	if (reviewsWithBody.length === 0) {
		return 'No review submissions with body text.';
	}

	return reviewsWithBody
		.map((r) =>
			[
				`Review by @${r.user.login} (${r.state})`,
				`Submitted: ${r.submittedAt}`,
				'',
				r.body,
				'---',
			].join('\n'),
		)
		.join('\n\n');
}

export function formatPRIssueComments(prIssueComments: PRIssueComments): string {
	if (prIssueComments.length === 0) {
		return 'No general PR comments found.';
	}

	return prIssueComments
		.map((c) =>
			[
				`Comment #${c.id} by @${c.user.login}`,
				`URL: ${c.htmlUrl}`,
				`Created: ${c.createdAt}`,
				'',
				c.body,
				'---',
			].join('\n'),
		)
		.join('\n\n');
}

// ============================================================================
// PR Diff Context (compact per-file diffs for review agent)
// ============================================================================

/**
 * Reason a PR file's diff was omitted from the compact context.
 *
 * - `deleted`: file was removed in the PR (no meaningful diff to read).
 * - `no-patch`: neither GitHub nor local git returned a text patch.
 * - `local-diff-empty`: GitHub reported a patch, but local git produced none.
 * - `local-diff-failed`: local git could not produce a verified patch.
 * - `patch-too-large`: the individual file's patch would exceed the per-file cap.
 * - `over-budget`: the cumulative context budget was reached before this file.
 */
export type SkipReason =
	| 'deleted'
	| 'no-patch'
	| 'local-diff-empty'
	| 'local-diff-failed'
	| 'patch-too-large'
	| 'over-budget';

export interface SkippedFile {
	filename: string;
	reason: SkipReason;
}

export interface PRDiffContext {
	included: Array<{
		path: string;
		status: PRDiff[number]['status'];
		diff: string;
		patchSource?: PatchSourceStatus;
		tokens: number;
	}>;
	skipped: SkippedFile[];
	totalDiffTokens: number;
	perFileTokenCap: number;
}

/** Per-file cap: any single file's patch over this is skipped as "patch-too-large". */
const PER_FILE_TOKEN_CAP = Math.floor(REVIEW_DIFF_CONTEXT_TOKEN_LIMIT / 10);

/**
 * Format a single file's compact diff section with a consistent header.
 * Kept internal — callers consume `PRDiffContext.included[].diff` directly.
 */
function formatCompactDiff(file: PRDiff[number] | EnrichedPRDiffFile): string {
	const header = `### ${file.filename} (${file.status}, +${file.additions} -${file.deletions})`;
	return `${header}\n\n\`\`\`diff\n${file.patch ?? ''}\n\`\`\``;
}

function skipReasonForUnverified(file: PRDiff[number] | EnrichedPRDiffFile): SkipReason | null {
	const patchSource = (file as EnrichedPRDiffFile).patchSource;
	if (patchSource === 'local-diff-failed') return 'local-diff-failed';
	if (patchSource === 'local-diff-empty') return 'local-diff-empty';
	return null;
}

/**
 * Produce a compact-diff context for the review agent from the PR's changed-files
 * list. Scales with PR size (not repo size). Files that can't be included are
 * surfaced explicitly so the agent can decide whether to fetch them on demand
 * via `Read` or `gh pr diff`.
 *
 * Skip rules, evaluated in order per file:
 *   1. `status === 'removed'` → `skipped` with reason `deleted`
 *   2. `patch` missing/empty → `skipped` with reason `no-patch`
 *   3. patch token estimate > per-file cap → `skipped` with reason `patch-too-large`
 *   4. cumulative budget would exceed `REVIEW_DIFF_CONTEXT_TOKEN_LIMIT` → `skipped` with reason `over-budget`
 *   5. otherwise → `included`
 *
 * Input order is preserved — output ordering mirrors GitHub's response, which
 * is stable for a given PR head SHA.
 */
export function extractPRDiffs(prDiff: PRDiff): PRDiffContext {
	const included: PRDiffContext['included'] = [];
	const skipped: SkippedFile[] = [];
	let totalTokens = 0;

	for (const file of prDiff) {
		if (file.status === 'removed') {
			skipped.push({ filename: file.filename, reason: 'deleted' });
			continue;
		}
		const unverifiedReason = skipReasonForUnverified(file);
		if (unverifiedReason) {
			skipped.push({ filename: file.filename, reason: unverifiedReason });
			continue;
		}
		if (!file.patch) {
			skipped.push({ filename: file.filename, reason: 'no-patch' });
			continue;
		}
		const diff = formatCompactDiff(file);
		const tokens = estimateTokens(diff);
		if (tokens > PER_FILE_TOKEN_CAP) {
			skipped.push({ filename: file.filename, reason: 'patch-too-large' });
			continue;
		}
		if (totalTokens + tokens > REVIEW_DIFF_CONTEXT_TOKEN_LIMIT) {
			skipped.push({ filename: file.filename, reason: 'over-budget' });
			continue;
		}
		included.push({
			path: file.filename,
			status: file.status,
			diff,
			patchSource: (file as EnrichedPRDiffFile).patchSource,
			tokens,
		});
		totalTokens += tokens;
	}

	return { included, skipped, totalDiffTokens: totalTokens, perFileTokenCap: PER_FILE_TOKEN_CAP };
}

/**
 * Render a `PRDiffContext` as a single string block suitable for a pre-fetch
 * injection. Includes all per-file diffs back-to-back; skipped files are the
 * responsibility of a separate, structured `SKIPPED FILES` injection.
 */
export function formatPRDiffContext(ctx: PRDiffContext): string {
	if (ctx.included.length === 0) {
		return 'No file diffs available for this PR.';
	}
	return ctx.included.map((f) => f.diff).join('\n\n');
}

/**
 * Render the skipped-file list as a self-documenting block — includes both the
 * filenames/reasons AND the fetch guidance, so agents that receive this
 * injection know what to do regardless of their per-agent prompt.
 */
export function formatSkippedFilesInjection(
	skipped: SkippedFile[],
	prNumber: number | undefined,
): string {
	if (skipped.length === 0) return '';

	const header = [
		`The following ${skipped.length} file(s) from the PR were omitted from the compact-diff context to keep the review focused:`,
		'',
	];

	const lines = skipped.map((s) => `- \`${s.filename}\` (${s.reason})`);

	const guidance = [
		'',
		'If any of these files are relevant to your review, fetch them on demand:',
		prNumber !== undefined
			? `  • \`cascade-tools scm get-pr-diff --prNumber ${prNumber} --path <path>\` to read the patch`
			: '  • `cascade-tools scm get-pr-diff --prNumber <PR_NUMBER> --path <path>` to read the patch',
		'  • `Read <path>` to read the post-PR file content',
		'  • `Grep <pattern> <path>` to search inside the file',
		'',
		'You are not expected to review every skipped file — only fetch when the PR description or another file points you at it.',
	];

	return [...header, ...lines, ...guidance].join('\n');
}

/** Group skipped files by reason into a `{ reason: count }` map for logging. */
export function countSkipsByReason(skipped: SkippedFile[]): Record<SkipReason, number> {
	const counts: Record<SkipReason, number> = {
		deleted: 0,
		'no-patch': 0,
		'local-diff-empty': 0,
		'local-diff-failed': 0,
		'patch-too-large': 0,
		'over-budget': 0,
	};
	for (const s of skipped) counts[s.reason]++;
	return counts;
}
