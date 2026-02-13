import type { githubClient } from '../../github/client.js';

type PRDetails = Awaited<ReturnType<typeof githubClient.getPR>>;
type PRDiff = Awaited<ReturnType<typeof githubClient.getPRDiff>>;
type PRComments = Awaited<ReturnType<typeof githubClient.getPRReviewComments>>;
type PRReviews = Awaited<ReturnType<typeof githubClient.getPRReviews>>;
type PRIssueComments = Awaited<ReturnType<typeof githubClient.getPRIssueComments>>;

export type { PRDetails, PRDiff, PRComments, PRReviews, PRIssueComments };

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
