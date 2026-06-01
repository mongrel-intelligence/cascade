import { AsyncLocalStorage } from 'node:async_hooks';
import { Octokit } from '@octokit/rest';
import { logger } from '../utils/logging.js';

const clientStorage = new AsyncLocalStorage<Octokit>();

function getClient(): Octokit {
	const scopedClient = clientStorage.getStore();
	if (!scopedClient) {
		throw new Error(
			'No GitHub client in scope. Wrap the call with withGitHubToken() or ensure per-project GITHUB_TOKEN is set in the database.',
		);
	}
	return scopedClient;
}

export function withGitHubToken<T>(token: string, fn: () => Promise<T>): Promise<T> {
	const scopedClient = new Octokit({ auth: token });
	return clientStorage.run(scopedClient, fn);
}

export interface PRDetails {
	number: number;
	title: string;
	body: string | null;
	state: string;
	htmlUrl: string;
	headRef: string;
	headSha: string;
	baseRef: string;
	merged: boolean;
	mergeable: boolean | null;
	user: { login: string };
}

export interface PRReviewComment {
	id: number;
	body: string;
	path: string;
	line: number | null;
	htmlUrl: string;
	user: {
		login: string;
	};
	createdAt: string;
	/**
	 * GitHub-supplied timestamp for the last update of the comment. Optional —
	 * only present on writes (createReplyForReviewComment) where GitHub returns
	 * `updated_at` alongside the new comment. Read paths
	 * (`listReviewComments`) don't surface it because the consumer doesn't need
	 * it for context shaping.
	 */
	updatedAt?: string;
	inReplyToId?: number;
}

/**
 * Result shape for issue-comment write mutations (`createPRComment`,
 * `updatePRComment`). Includes the GitHub-supplied `updated_at` so downstream
 * structured-mutation helpers can surface a real provider timestamp rather
 * than a synthetic `new Date().toISOString()` (MNG-1425 / spec MNG-1422).
 */
export interface CreatedIssueComment {
	id: number;
	htmlUrl: string;
	body: string;
	createdAt: string;
	updatedAt: string;
}

export interface PRReview {
	id: number;
	state: 'approved' | 'changes_requested' | 'commented' | 'dismissed';
	body: string | null;
	user: {
		login: string;
	};
	submittedAt: string;
	commitId: string;
}

export interface PRIssueComment {
	id: number;
	body: string;
	user: {
		login: string;
	};
	htmlUrl: string;
	createdAt: string;
}

export interface CheckRunStatus {
	name: string;
	status: string;
	conclusion: string | null;
}

export interface CheckSuiteStatus {
	totalCount: number;
	checkRuns: CheckRunStatus[];
	allPassing: boolean;
}

export interface FailedJob {
	runName: string;
	runId: number;
	jobName: string;
	conclusion: string | null;
	steps: Array<{ name: string; conclusion: string | null }>;
}

export interface FailedWorkflowRuns {
	runs: Array<{ id: number; name: string }>;
	failedJobs: FailedJob[];
}

export interface PRDiffFile {
	filename: string;
	previousFilename?: string;
	status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
	additions: number;
	deletions: number;
	changes: number;
	patch?: string;
}

export interface CreatePRParams {
	title: string;
	body: string;
	head: string;
	base: string;
	draft?: boolean;
}

export interface CreatedPR {
	number: number;
	htmlUrl: string;
	title: string;
}

/**
 * Result shape for `createPRReview`. Surfaces the GitHub-supplied `state`
 * (e.g. `APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`) and `submitted_at` so
 * downstream structured-mutation helpers can record the real provider
 * timestamp (MNG-1425 / spec MNG-1422). `submittedAt` is nullable because
 * `pulls.createReview` returns `null` for `PENDING` reviews even though
 * gadget callers always submit (event != null).
 */
export interface CreatedPRReview {
	id: number;
	htmlUrl: string;
	body: string;
	state: string;
	submittedAt: string | null;
}

export const githubClient = {
	async getPR(owner: string, repo: string, prNumber: number): Promise<PRDetails> {
		logger.debug('Fetching PR', { owner, repo, prNumber });
		const { data } = await getClient().pulls.get({
			owner,
			repo,
			pull_number: prNumber,
		});
		return {
			number: data.number,
			title: data.title,
			body: data.body,
			state: data.state,
			htmlUrl: data.html_url,
			headRef: data.head.ref,
			headSha: data.head.sha,
			baseRef: data.base.ref,
			merged: data.merged ?? false,
			mergeable: data.mergeable ?? null,
			user: { login: data.user?.login || 'unknown' },
		};
	},

	async getPRReviewComments(
		owner: string,
		repo: string,
		prNumber: number,
	): Promise<PRReviewComment[]> {
		logger.debug('Fetching PR review comments', { owner, repo, prNumber });
		const client = getClient();
		const data = await client.paginate(client.pulls.listReviewComments, {
			owner,
			repo,
			pull_number: prNumber,
			per_page: 100,
		});
		return data.map((c) => ({
			id: c.id,
			body: c.body,
			path: c.path,
			line: c.line ?? null,
			htmlUrl: c.html_url,
			user: {
				login: c.user?.login || 'unknown',
			},
			createdAt: c.created_at,
			inReplyToId: c.in_reply_to_id,
		}));
	},

	async replyToReviewComment(
		owner: string,
		repo: string,
		prNumber: number,
		commentId: number,
		body: string,
	): Promise<PRReviewComment> {
		logger.debug('Replying to review comment', { owner, repo, prNumber, commentId });
		const { data } = await getClient().pulls.createReplyForReviewComment({
			owner,
			repo,
			pull_number: prNumber,
			comment_id: commentId,
			body,
		});
		return {
			id: data.id,
			body: data.body,
			path: data.path,
			line: data.line ?? null,
			htmlUrl: data.html_url,
			user: {
				login: data.user?.login || 'unknown',
			},
			createdAt: data.created_at,
			updatedAt: data.updated_at,
			inReplyToId: data.in_reply_to_id,
		};
	},

	async createPRComment(
		owner: string,
		repo: string,
		prNumber: number,
		body: string,
	): Promise<CreatedIssueComment> {
		logger.debug('Creating PR comment', { owner, repo, prNumber });
		const { data } = await getClient().issues.createComment({
			owner,
			repo,
			issue_number: prNumber,
			body,
		});
		return {
			id: data.id,
			htmlUrl: data.html_url,
			body: data.body ?? '',
			createdAt: data.created_at,
			updatedAt: data.updated_at,
		};
	},

	async updatePRComment(
		owner: string,
		repo: string,
		commentId: number,
		body: string,
	): Promise<CreatedIssueComment> {
		logger.debug('Updating PR comment', { owner, repo, commentId });
		const { data } = await getClient().issues.updateComment({
			owner,
			repo,
			comment_id: commentId,
			body,
		});
		return {
			id: data.id,
			htmlUrl: data.html_url,
			body: data.body ?? '',
			createdAt: data.created_at,
			updatedAt: data.updated_at,
		};
	},

	async deletePRComment(owner: string, repo: string, commentId: number): Promise<void> {
		logger.debug('Deleting PR comment', { owner, repo, commentId });
		try {
			await getClient().issues.deleteComment({
				owner,
				repo,
				comment_id: commentId,
			});
		} catch (err) {
			// 404 is success-equivalent under RFC-7231 idempotency (the comment is gone).
			// Any path — gadget mid-run delete, sidecar-driven clear, user manual delete —
			// can have already removed the comment. The post-agent cleanup hook used to
			// log this as a WARN 72 times/day in prod; downgrade to DEBUG so the noise
			// doesn't drown out real failures while preserving an audit breadcrumb.
			if ((err as { status?: number })?.status === 404) {
				logger.debug('PR comment already deleted (404 on DELETE)', {
					owner,
					repo,
					commentId,
				});
				return;
			}
			throw err;
		}
	},

	async getPRReviews(owner: string, repo: string, prNumber: number): Promise<PRReview[]> {
		logger.debug('Fetching PR reviews', { owner, repo, prNumber });
		const client = getClient();
		const data = await client.paginate(client.pulls.listReviews, {
			owner,
			repo,
			pull_number: prNumber,
			per_page: 100,
		});
		return data.map((r) => ({
			id: r.id,
			state: r.state.toLowerCase() as PRReview['state'],
			body: r.body || null,
			user: {
				login: r.user?.login || 'unknown',
			},
			submittedAt: r.submitted_at || '',
			commitId: r.commit_id || '',
		}));
	},

	async getPRIssueComments(
		owner: string,
		repo: string,
		prNumber: number,
	): Promise<PRIssueComment[]> {
		logger.debug('Fetching PR issue comments', { owner, repo, prNumber });
		const client = getClient();
		const data = await client.paginate(client.issues.listComments, {
			owner,
			repo,
			issue_number: prNumber,
			per_page: 100,
		});
		return data.map((c) => ({
			id: c.id,
			body: c.body || '',
			user: {
				login: c.user?.login || 'unknown',
			},
			htmlUrl: c.html_url,
			createdAt: c.created_at,
		}));
	},

	async getCheckSuiteStatus(owner: string, repo: string, ref: string): Promise<CheckSuiteStatus> {
		logger.debug('Fetching workflow runs for ref', { owner, repo, ref });
		const client = getClient();

		// Use Actions API (workflow runs + jobs) instead of Checks API,
		// because fine-grained PATs cannot access the Checks API.
		const workflowRuns = await client.paginate(client.actions.listWorkflowRunsForRepo, {
			owner,
			repo,
			head_sha: ref,
			per_page: 100,
		});

		// Dedupe by workflow_id — keep only the most recent run per workflow.
		// `listWorkflowRunsForRepo` returns runs sorted by `created_at` desc,
		// so the first occurrence we see for a given workflow_id is the
		// latest. Closes the bug where a failed-then-rerun workflow's stale
		// FAILURE job (e.g. `Rebuild ucho-cli template` on ucho/PR #231)
		// leaked into the aggregate-status query, made `anyFailed=true`, and
		// caused the success handler to mistakenly fork to respond-to-ci on
		// a PR whose CI was actually green at the LATEST attempt. The default
		// `filter=latest` on `listJobsForWorkflowRun` only dedupes job
		// attempts WITHIN a single workflow_run; it does not dedupe across
		// multiple workflow_runs of the same workflow on the same SHA.
		const latestRunByWorkflow = new Map<number, (typeof workflowRuns)[number]>();
		for (const run of workflowRuns) {
			if (!latestRunByWorkflow.has(run.workflow_id)) {
				latestRunByWorkflow.set(run.workflow_id, run);
			}
		}
		const dedupedRuns = [...latestRunByWorkflow.values()];

		// Fetch jobs for each workflow run to get per-job granularity
		const jobResults = await Promise.all(
			dedupedRuns.map((run) =>
				client.paginate(client.actions.listJobsForWorkflowRun, {
					owner,
					repo,
					run_id: run.id,
					per_page: 100,
				}),
			),
		);

		const checkRuns = jobResults.flatMap((jobs) =>
			jobs.map((job) => ({
				name: job.name,
				status: job.status,
				conclusion: job.conclusion,
			})),
		);

		// All checks pass if every completed check has success/skipped/neutral conclusion
		const allPassing =
			checkRuns.length > 0 &&
			checkRuns.every(
				(cr) =>
					cr.status === 'completed' &&
					(cr.conclusion === 'success' ||
						cr.conclusion === 'skipped' ||
						cr.conclusion === 'neutral'),
			);

		return {
			totalCount: checkRuns.length,
			checkRuns,
			allPassing,
		};
	},

	async getPRDiff(owner: string, repo: string, prNumber: number): Promise<PRDiffFile[]> {
		logger.debug('Fetching PR diff', { owner, repo, prNumber });
		const client = getClient();
		const data = await client.paginate(client.pulls.listFiles, {
			owner,
			repo,
			pull_number: prNumber,
			per_page: 100,
		});
		return data.map((f) => ({
			filename: f.filename,
			previousFilename: f.previous_filename,
			status: f.status as PRDiffFile['status'],
			additions: f.additions,
			deletions: f.deletions,
			changes: f.changes,
			patch: f.patch,
		}));
	},

	async createPRReview(
		owner: string,
		repo: string,
		prNumber: number,
		event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
		body: string,
		comments?: Array<{ path: string; line?: number; body: string }>,
	): Promise<CreatedPRReview> {
		logger.debug('Creating PR review', { owner, repo, prNumber, event });
		const { data } = await getClient().pulls.createReview({
			owner,
			repo,
			pull_number: prNumber,
			event,
			body,
			comments: comments?.map((c) => ({
				path: c.path,
				line: c.line,
				body: c.body,
			})),
		});
		return {
			id: data.id,
			htmlUrl: data.html_url,
			body: data.body ?? '',
			state: data.state,
			submittedAt: data.submitted_at ?? null,
		};
	},

	async getOpenPRByBranch(owner: string, repo: string, head: string): Promise<CreatedPR | null> {
		logger.debug('Looking up open PR by branch', { owner, repo, head });
		const { data } = await getClient().pulls.list({
			owner,
			repo,
			head: `${owner}:${head}`,
			state: 'open',
			per_page: 1,
		});
		if (data.length === 0) return null;
		return {
			number: data[0].number,
			htmlUrl: data[0].html_url,
			title: data[0].title,
		};
	},

	async createPR(owner: string, repo: string, params: CreatePRParams): Promise<CreatedPR> {
		logger.debug('Creating PR', { owner, repo, head: params.head, base: params.base });
		const { data } = await getClient().pulls.create({
			owner,
			repo,
			title: params.title,
			body: params.body,
			head: params.head,
			base: params.base,
			draft: params.draft ?? false,
		});
		return {
			number: data.number,
			htmlUrl: data.html_url,
			title: data.title,
		};
	},

	async getFailedWorkflowRunJobs(
		owner: string,
		repo: string,
		ref: string,
	): Promise<FailedWorkflowRuns> {
		logger.debug('Fetching failed workflow run jobs', { owner, repo, ref });
		const client = getClient();

		const workflowRuns = await client.paginate(client.actions.listWorkflowRunsForRepo, {
			owner,
			repo,
			head_sha: ref,
			per_page: 100,
		});

		const failedRuns = workflowRuns.filter(
			(run) => run.conclusion === 'failure' || run.conclusion === 'timed_out',
		);

		if (failedRuns.length === 0) {
			return { runs: [], failedJobs: [] };
		}

		const jobResults = await Promise.all(
			failedRuns.map((run) =>
				client
					.paginate(client.actions.listJobsForWorkflowRun, {
						owner,
						repo,
						run_id: run.id,
						per_page: 100,
					})
					.then((jobs) => ({ run, jobs })),
			),
		);

		const failedJobs: FailedJob[] = [];
		for (const { run, jobs } of jobResults) {
			for (const job of jobs) {
				if (job.conclusion === 'failure' || job.conclusion === 'timed_out') {
					failedJobs.push({
						runName: run.name ?? `Run #${run.id}`,
						runId: run.id,
						jobName: job.name,
						conclusion: job.conclusion,
						steps: (job.steps ?? []).map((s) => ({
							name: s.name,
							conclusion: s.conclusion,
						})),
					});
				}
			}
		}

		return {
			runs: failedRuns.map((r) => ({ id: r.id, name: r.name ?? `Run #${r.id}` })),
			failedJobs,
		};
	},

	async mergePR(
		owner: string,
		repo: string,
		prNumber: number,
		mergeMethod: 'merge' | 'squash' | 'rebase' = 'squash',
	): Promise<void> {
		logger.debug('Merging PR', { owner, repo, prNumber, mergeMethod });
		await getClient().pulls.merge({
			owner,
			repo,
			pull_number: prNumber,
			merge_method: mergeMethod,
		});
	},
};

export async function getGitHubUserForToken(token: string | null): Promise<string | null> {
	if (!token) return null;

	try {
		const reviewerClient = new Octokit({ auth: token });
		const { data } = await reviewerClient.users.getAuthenticated();
		return data.login;
	} catch (err) {
		logger.warn('Failed to resolve reviewer GitHub identity', { error: String(err) });
		return null;
	}
}
