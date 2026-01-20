import { Octokit } from '@octokit/rest';
import { logger } from '../utils/logging.js';

let client: Octokit | null = null;

function getClient(): Octokit {
	if (!client) {
		const token = process.env.GITHUB_TOKEN;

		if (!token) {
			throw new Error('GITHUB_TOKEN must be set');
		}

		client = new Octokit({ auth: token });
	}
	return client;
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
	inReplyToId?: number;
}

export interface PRReview {
	id: number;
	state: 'approved' | 'changes_requested' | 'commented' | 'dismissed';
	body: string | null;
	user: {
		login: string;
	};
	submittedAt: string;
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

export interface PRDiffFile {
	filename: string;
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
		};
	},

	async getPRReviewComments(
		owner: string,
		repo: string,
		prNumber: number,
	): Promise<PRReviewComment[]> {
		logger.debug('Fetching PR review comments', { owner, repo, prNumber });
		const { data } = await getClient().pulls.listReviewComments({
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
			inReplyToId: data.in_reply_to_id,
		};
	},

	async createPRComment(
		owner: string,
		repo: string,
		prNumber: number,
		body: string,
	): Promise<{ id: number; htmlUrl: string }> {
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
		};
	},

	async updatePRComment(
		owner: string,
		repo: string,
		commentId: number,
		body: string,
	): Promise<{ id: number; htmlUrl: string }> {
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
		};
	},

	async getPRReviews(owner: string, repo: string, prNumber: number): Promise<PRReview[]> {
		logger.debug('Fetching PR reviews', { owner, repo, prNumber });
		const { data } = await getClient().pulls.listReviews({
			owner,
			repo,
			pull_number: prNumber,
		});
		return data.map((r) => ({
			id: r.id,
			state: r.state.toLowerCase() as PRReview['state'],
			body: r.body || null,
			user: {
				login: r.user?.login || 'unknown',
			},
			submittedAt: r.submitted_at || '',
		}));
	},

	async getPRIssueComments(
		owner: string,
		repo: string,
		prNumber: number,
	): Promise<PRIssueComment[]> {
		logger.debug('Fetching PR issue comments', { owner, repo, prNumber });
		const { data } = await getClient().issues.listComments({
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
		logger.debug('Fetching check runs for ref', { owner, repo, ref });
		const { data } = await getClient().checks.listForRef({
			owner,
			repo,
			ref,
			per_page: 100,
		});

		const checkRuns = data.check_runs.map((cr) => ({
			name: cr.name,
			status: cr.status,
			conclusion: cr.conclusion,
		}));

		// All checks pass if every completed check has success/skipped/neutral conclusion
		const allPassing = checkRuns.every(
			(cr) =>
				cr.status === 'completed' &&
				(cr.conclusion === 'success' || cr.conclusion === 'skipped' || cr.conclusion === 'neutral'),
		);

		return {
			totalCount: data.total_count,
			checkRuns,
			allPassing,
		};
	},

	async getPRDiff(owner: string, repo: string, prNumber: number): Promise<PRDiffFile[]> {
		logger.debug('Fetching PR diff', { owner, repo, prNumber });
		const { data } = await getClient().pulls.listFiles({
			owner,
			repo,
			pull_number: prNumber,
			per_page: 100,
		});
		return data.map((f) => ({
			filename: f.filename,
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
	): Promise<{ id: number; htmlUrl: string }> {
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

	async branchExists(owner: string, repo: string, branch: string): Promise<boolean> {
		logger.debug('Checking if branch exists', { owner, repo, branch });
		try {
			await getClient().repos.getBranch({
				owner,
				repo,
				branch,
			});
			return true;
		} catch (error) {
			if (error instanceof Error && 'status' in error && error.status === 404) {
				return false;
			}
			throw error;
		}
	},
};

export function resetGitHubClient(): void {
	client = null;
}
