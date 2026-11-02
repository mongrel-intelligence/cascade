/**
 * Types for GitHub polling synthetic events.
 *
 * These types represent the API responses from GitHub and the synthetic
 * events we build to feed into the existing router adapter.
 */

/**
 * GitHub workflow run from the Actions API.
 * See: https://docs.github.com/en/rest/actions/workflow-runs
 */
export interface GitHubWorkflowRun {
	id: number;
	name: string;
	head_branch: string | null;
	head_sha: string;
	status: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested' | 'pending';
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
	workflow_id: number;
	check_suite_id: number;
	pull_requests: Array<{
		number: number;
		head: {
			ref: string;
			sha: string;
		};
	}>;
	created_at: string;
	updated_at: string;
	html_url: string;
}

/**
 * Response from GET /repos/{owner}/{repo}/actions/runs
 */
export interface GitHubWorkflowRunsResponse {
	total_count: number;
	workflow_runs: GitHubWorkflowRun[];
}

/**
 * GitHub PR from the Pulls API.
 */
export interface GitHubPullRequest {
	number: number;
	title: string;
	body: string | null;
	state: 'open' | 'closed';
	draft?: boolean;
	html_url: string;
	head: {
		ref: string;
		sha: string;
	};
	base: {
		ref: string;
	};
	user: {
		login: string;
	};
	merged: boolean;
	merged_at: string | null;
	updated_at: string;
}

/**
 * GitHub PR review from the Pulls API.
 */
export interface GitHubPRReview {
	id: number;
	state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
	body: string | null;
	html_url: string;
	user: {
		login: string;
	};
	submitted_at: string | null;
	commit_id: string;
}

/**
 * Conclusions that should be emitted as check_suite events.
 */
export const EMIT_AS_SUCCESS = new Set(['success']);
export const EMIT_AS_FAILURE = new Set(['failure', 'timed_out', 'action_required']);
export const SKIP_CONCLUSIONS = new Set(['cancelled', 'neutral', 'skipped', 'stale']);

/**
 * Determine if a workflow run should be emitted as a check_suite event.
 * Returns the conclusion to use, or null if the run should be skipped.
 */
export function shouldEmitWorkflowRun(
	run: GitHubWorkflowRun,
): { emit: true; conclusion: 'success' | 'failure' } | { emit: false; reason: string } {
	if (run.status !== 'completed') {
		return { emit: false, reason: 'not_completed' };
	}
	if (run.conclusion === null) {
		return { emit: false, reason: 'null_conclusion' };
	}
	if (EMIT_AS_SUCCESS.has(run.conclusion)) {
		return { emit: true, conclusion: 'success' };
	}
	if (EMIT_AS_FAILURE.has(run.conclusion)) {
		return { emit: true, conclusion: 'failure' };
	}
	// cancelled, neutral, skipped, stale -> skip
	return { emit: false, reason: `skipped_conclusion_${run.conclusion}` };
}

/**
 * Build a dedup key for a workflow run.
 * Format: github:{owner}/{repo}:check_suite:{sha}:{conclusion}:{run_id}
 */
export function buildCheckSuiteDedupKey(
	owner: string,
	repo: string,
	run: GitHubWorkflowRun,
	conclusion: 'success' | 'failure',
): string {
	return `github:${owner}/${repo}:check_suite:${run.head_sha}:${conclusion}:${run.id}`;
}

/**
 * Build a dedup key for a PR review.
 * Format: github:{owner}/{repo}:pr_review:{pr_number}:{review_id}
 */
export function buildPRReviewDedupKey(
	owner: string,
	repo: string,
	prNumber: number,
	reviewId: number,
): string {
	return `github:${owner}/${repo}:pr_review:${prNumber}:${reviewId}`;
}

/**
 * Build a dedup key for a merged PR.
 * Format: github:{owner}/{repo}:merged_pr:{pr_number}
 */
export function buildMergedPRDedupKey(owner: string, repo: string, prNumber: number): string {
	return `github:${owner}/${repo}:merged_pr:${prNumber}`;
}

/**
 * Synthetic check_suite payload that matches what the router adapter expects.
 * Uses check_suite_id from the workflow run for the check_suite.id field.
 */
export interface SyntheticCheckSuitePayload {
	_eventType: 'check_suite';
	_deliveryId: string;
	action: 'completed';
	check_suite: {
		id: number;
		status: 'completed';
		conclusion: 'success' | 'failure';
		head_sha: string;
		head_branch: string | null;
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

/**
 * Build a synthetic check_suite payload from a workflow run.
 */
export function buildSyntheticCheckSuitePayload(
	run: GitHubWorkflowRun,
	conclusion: 'success' | 'failure',
	repoFullName: string,
	prNumber?: number,
): SyntheticCheckSuitePayload {
	const pullRequests =
		prNumber !== undefined
			? [
					{
						number: prNumber,
						head: {
							ref: run.head_branch ?? '',
							sha: run.head_sha,
						},
					},
				]
			: run.pull_requests;

	return {
		_eventType: 'check_suite',
		_deliveryId: `poll:check_suite:${run.id}`,
		action: 'completed',
		check_suite: {
			id: run.check_suite_id,
			status: 'completed',
			conclusion,
			head_sha: run.head_sha,
			head_branch: run.head_branch,
			pull_requests: pullRequests,
		},
		repository: {
			full_name: repoFullName,
			html_url: `https://github.com/${repoFullName}`,
		},
		sender: {
			login: 'github-actions[bot]',
		},
	};
}

/**
 * Synthetic pull_request_review payload.
 */
export interface SyntheticPRReviewPayload {
	_eventType: 'pull_request_review';
	_deliveryId: string;
	action: 'submitted';
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

/**
 * Build a synthetic PR review payload.
 */
export function buildSyntheticPRReviewPayload(
	review: GitHubPRReview,
	pr: GitHubPullRequest,
	repoFullName: string,
): SyntheticPRReviewPayload {
	return {
		_eventType: 'pull_request_review',
		_deliveryId: `poll:pr_review:${review.id}`,
		action: 'submitted',
		review: {
			id: review.id,
			state: review.state.toLowerCase() as
				| 'approved'
				| 'changes_requested'
				| 'commented'
				| 'dismissed',
			body: review.body,
			html_url: review.html_url,
			user: {
				login: review.user.login,
			},
		},
		pull_request: {
			number: pr.number,
			title: pr.title,
			body: pr.body,
			html_url: pr.html_url,
			head: {
				ref: pr.head.ref,
				sha: pr.head.sha,
			},
			base: {
				ref: pr.base.ref,
			},
		},
		repository: {
			full_name: repoFullName,
			html_url: `https://github.com/${repoFullName}`,
		},
		sender: {
			login: review.user.login,
		},
	};
}

/**
 * Synthetic pull_request closed+merged payload.
 */
export interface SyntheticMergedPRPayload {
	_eventType: 'pull_request';
	_deliveryId: string;
	action: 'closed';
	number: number;
	pull_request: {
		number: number;
		title: string;
		body: string | null;
		html_url: string;
		state: 'closed';
		draft: false;
		merged: true;
		head: {
			ref: string;
			sha: string;
		};
		base: {
			ref: string;
		};
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

/**
 * Build a synthetic merged PR payload.
 */
export function buildSyntheticMergedPRPayload(
	pr: GitHubPullRequest,
	repoFullName: string,
): SyntheticMergedPRPayload {
	return {
		_eventType: 'pull_request',
		_deliveryId: `poll:merged_pr:${pr.number}`,
		action: 'closed',
		number: pr.number,
		pull_request: {
			number: pr.number,
			title: pr.title,
			body: pr.body,
			html_url: pr.html_url,
			state: 'closed',
			draft: false,
			merged: true,
			head: {
				ref: pr.head.ref,
				sha: pr.head.sha,
			},
			base: {
				ref: pr.base.ref,
			},
			user: {
				login: pr.user.login,
			},
		},
		repository: {
			full_name: repoFullName,
			html_url: `https://github.com/${repoFullName}`,
		},
		sender: {
			login: pr.user.login,
		},
	};
}

/**
 * Synthetic pull_request synchronize payload for conflict detection.
 * Uses 'synchronize' action to trigger PRConflictDetectedTrigger without
 * matching PROpenedTrigger (which only matches 'opened').
 */
export interface SyntheticPRConflictPayload {
	_eventType: 'pull_request';
	_deliveryId: string;
	action: 'synchronize';
	number: number;
	pull_request: {
		number: number;
		title: string;
		body: string | null;
		html_url: string;
		state: 'open';
		draft: boolean;
		head: {
			ref: string;
			sha: string;
		};
		base: {
			ref: string;
		};
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

/**
 * Build a synthetic PR conflict payload.
 */
export function buildSyntheticPRConflictPayload(
	pr: GitHubPullRequest,
	repoFullName: string,
	baseSha: string,
): SyntheticPRConflictPayload {
	return {
		_eventType: 'pull_request',
		_deliveryId: `poll:pr_conflict:${pr.number}:${pr.head.sha}:${baseSha}`,
		action: 'synchronize',
		number: pr.number,
		pull_request: {
			number: pr.number,
			title: pr.title,
			body: pr.body,
			html_url: pr.html_url,
			state: 'open',
			draft: pr.draft ?? false,
			head: {
				ref: pr.head.ref,
				sha: pr.head.sha,
			},
			base: {
				ref: pr.base.ref,
			},
			user: {
				login: pr.user.login,
			},
		},
		repository: {
			full_name: repoFullName,
			html_url: `https://github.com/${repoFullName}`,
		},
		sender: {
			login: pr.user.login,
		},
	};
}

/**
 * Build dedup key for PR conflict check.
 * Format: github:{repo}:pr_conflict_check:{pr}:{head_sha}:{base_sha}
 */
export function buildPRConflictCheckDedupKey(
	repoFullName: string,
	prNumber: number,
	headSha: string,
	baseSha: string,
): string {
	return `github:${repoFullName}:pr_conflict_check:${prNumber}:${headSha}:${baseSha}`;
}

/**
 * Union type for all synthetic GitHub payloads.
 */
export type SyntheticGitHubPayload =
	| SyntheticCheckSuitePayload
	| SyntheticPRReviewPayload
	| SyntheticMergedPRPayload
	| SyntheticPRConflictPayload;
