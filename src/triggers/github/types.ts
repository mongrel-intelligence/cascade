export interface GitHubPullRequestReviewCommentPayload {
	action: 'created' | 'edited' | 'deleted';
	comment: {
		id: number;
		body: string;
		path: string;
		line: number | null;
		user: {
			login: string;
		};
		html_url: string;
	};
	pull_request: {
		number: number;
		title: string;
		html_url: string;
		head: {
			ref: string; // branch name
			sha: string;
		};
		base: {
			ref: string;
		};
	};
	repository: {
		full_name: string; // owner/repo
		html_url: string;
	};
	sender: {
		login: string;
	};
}

export function isGitHubPRReviewCommentPayload(
	payload: unknown,
): payload is GitHubPullRequestReviewCommentPayload {
	if (typeof payload !== 'object' || payload === null) return false;
	const p = payload as Record<string, unknown>;
	return (
		typeof p.action === 'string' &&
		typeof p.comment === 'object' &&
		p.comment !== null &&
		typeof p.pull_request === 'object' &&
		p.pull_request !== null &&
		typeof p.repository === 'object' &&
		p.repository !== null
	);
}

// check_suite event payload
export interface GitHubCheckSuitePayload {
	action: 'completed' | 'requested' | 'rerequested';
	check_suite: {
		id: number;
		status: string;
		conclusion:
			| 'success'
			| 'failure'
			| 'neutral'
			| 'cancelled'
			| 'timed_out'
			| 'action_required'
			| 'stale'
			| 'skipped'
			| null;
		head_sha: string;
		pull_requests: Array<{
			number: number;
			head: {
				ref: string;
				sha: string;
			};
		}>;
	};
	repository: {
		full_name: string;
		html_url: string;
	};
	sender: {
		login: string;
	};
}

export function isGitHubCheckSuitePayload(payload: unknown): payload is GitHubCheckSuitePayload {
	if (typeof payload !== 'object' || payload === null) return false;
	const p = payload as Record<string, unknown>;
	return (
		typeof p.action === 'string' &&
		typeof p.check_suite === 'object' &&
		p.check_suite !== null &&
		typeof p.repository === 'object' &&
		p.repository !== null
	);
}

// pull_request_review event payload
export interface GitHubPullRequestReviewPayload {
	action: 'submitted' | 'edited' | 'dismissed';
	review: {
		id: number;
		state: 'approved' | 'changes_requested' | 'commented' | 'dismissed';
		body: string | null;
		html_url: string;
		user: {
			login: string;
		};
	};
	pull_request: {
		number: number;
		title: string;
		body: string | null;
		html_url: string;
		head: {
			ref: string;
			sha: string;
		};
		base: {
			ref: string;
		};
	};
	repository: {
		full_name: string;
		html_url: string;
	};
	sender: {
		login: string;
	};
}

export function isGitHubPullRequestReviewPayload(
	payload: unknown,
): payload is GitHubPullRequestReviewPayload {
	if (typeof payload !== 'object' || payload === null) return false;
	const p = payload as Record<string, unknown>;
	return (
		typeof p.action === 'string' &&
		typeof p.review === 'object' &&
		p.review !== null &&
		typeof p.pull_request === 'object' &&
		p.pull_request !== null &&
		typeof p.repository === 'object' &&
		p.repository !== null
	);
}

// pull_request event payload (for opened, closed, reopened, etc.)
export interface GitHubPullRequestPayload {
	action:
		| 'opened'
		| 'closed'
		| 'reopened'
		| 'synchronize'
		| 'edited'
		| 'ready_for_review'
		| 'converted_to_draft'
		| 'review_requested';
	number: number;
	pull_request: {
		number: number;
		title: string;
		body: string | null;
		html_url: string;
		state: 'open' | 'closed';
		draft: boolean;
		head: {
			ref: string; // branch name
			sha: string;
		};
		base: {
			ref: string;
		};
		user: {
			login: string;
		};
		requested_reviewers?: Array<{
			login: string;
		}>;
	};
	/** Present on review_requested events — the reviewer just added */
	requested_reviewer?: {
		login: string;
	};
	repository: {
		full_name: string; // owner/repo
		html_url: string;
	};
	sender: {
		login: string;
	};
}

export function isGitHubPullRequestPayload(payload: unknown): payload is GitHubPullRequestPayload {
	if (typeof payload !== 'object' || payload === null) return false;
	const p = payload as Record<string, unknown>;
	return (
		typeof p.action === 'string' &&
		typeof p.number === 'number' &&
		typeof p.pull_request === 'object' &&
		p.pull_request !== null &&
		typeof p.repository === 'object' &&
		p.repository !== null
	);
}

// issue_comment event payload (for PR conversation comments)
export interface GitHubIssueCommentPayload {
	action: 'created' | 'edited' | 'deleted';
	issue: {
		number: number;
		title: string;
		html_url: string;
		pull_request?: {
			url: string;
		};
	};
	comment: {
		id: number;
		body: string;
		html_url: string;
		user: {
			login: string;
		};
	};
	repository: {
		full_name: string;
		html_url: string;
	};
	sender: {
		login: string;
	};
}

export function isGitHubIssueCommentPayload(
	payload: unknown,
): payload is GitHubIssueCommentPayload {
	if (typeof payload !== 'object' || payload === null) return false;
	const p = payload as Record<string, unknown>;
	return (
		typeof p.action === 'string' &&
		typeof p.issue === 'object' &&
		p.issue !== null &&
		typeof p.comment === 'object' &&
		p.comment !== null &&
		typeof p.repository === 'object' &&
		p.repository !== null
	);
}
