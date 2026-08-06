import { AsyncLocalStorage } from 'node:async_hooks';
import { Gitlab } from '@gitbeaker/rest';
import { logger } from '../utils/logging.js';

type GitlabClient = InstanceType<typeof Gitlab>;

const clientStorage = new AsyncLocalStorage<GitlabClient>();

function getClient(): GitlabClient {
	const scopedClient = clientStorage.getStore();
	if (!scopedClient) {
		throw new Error(
			'No GitLab client in scope. Wrap the call with withGitLabToken() or ensure per-project GITLAB_TOKEN is set in the database.',
		);
	}
	return scopedClient;
}

export function withGitLabToken<T>(
	token: string,
	fn: () => Promise<T>,
	host: string = 'https://gitlab.com',
): Promise<T> {
	const scopedClient = new Gitlab({ token, host });
	return clientStorage.run(scopedClient, fn);
}

// ============================================================================
// Types
// ============================================================================

export interface MRDetails {
	iid: number;
	title: string;
	description: string | null;
	state: string;
	webUrl: string;
	sourceBranch: string;
	targetBranch: string;
	sha: string;
	merged: boolean;
	hasConflicts: boolean;
	author: { username: string };
}

export interface MRNote {
	id: number;
	body: string;
	author: { username: string };
	createdAt: string;
	system: boolean;
	resolvable: boolean;
	resolved: boolean;
}

export interface MRDiffFile {
	newPath: string;
	oldPath: string;
	newFile: boolean;
	renamedFile: boolean;
	deletedFile: boolean;
	diff: string;
}

export interface MRApprovalState {
	approved: boolean;
	approvedBy: Array<{ username: string }>;
}

export interface PipelineStatus {
	id: number;
	status: string;
	ref: string;
	sha: string;
	webUrl: string;
}

export interface FailedJob {
	id: number;
	name: string;
	stage: string;
	status: string;
	webUrl: string;
	failureReason: string | null;
}

export interface FailedPipelineJobs {
	pipeline: PipelineStatus;
	failedJobs: FailedJob[];
}

export interface CreateMRParams {
	title: string;
	description: string;
	sourceBranch: string;
	targetBranch: string;
	draft?: boolean;
}

export interface CreatedMR {
	iid: number;
	webUrl: string;
	title: string;
}

// ============================================================================
// Client
// ============================================================================

export const gitlabClient = {
	async getMR(projectId: string, mrIid: number): Promise<MRDetails> {
		logger.debug('Fetching MR', { projectId, mrIid });
		const data = await getClient().MergeRequests.show(projectId, mrIid);
		const d = data as Record<string, unknown>;
		return {
			iid: d.iid as number,
			title: d.title as string,
			description: (d.description as string) ?? null,
			state: d.state as string,
			webUrl: d.web_url as string,
			sourceBranch: d.source_branch as string,
			targetBranch: d.target_branch as string,
			sha: (d.sha as string) ?? '',
			merged: d.state === 'merged',
			hasConflicts: (d.has_conflicts as boolean) ?? false,
			author: {
				username: ((d.author as Record<string, unknown>)?.username as string) ?? 'unknown',
			},
		};
	},

	async getMRDiff(projectId: string, mrIid: number): Promise<MRDiffFile[]> {
		logger.debug('Fetching MR diff', { projectId, mrIid });
		const data = await getClient().MergeRequests.allDiffs(projectId, mrIid);
		return (data as Array<Record<string, unknown>>).map((f) => ({
			newPath: (f.new_path as string) ?? '',
			oldPath: (f.old_path as string) ?? '',
			newFile: (f.new_file as boolean) ?? false,
			renamedFile: (f.renamed_file as boolean) ?? false,
			deletedFile: (f.deleted_file as boolean) ?? false,
			diff: (f.diff as string) ?? '',
		}));
	},

	async getMRNotes(projectId: string, mrIid: number): Promise<MRNote[]> {
		logger.debug('Fetching MR notes', { projectId, mrIid });
		const data = await getClient().MergeRequestNotes.all(projectId, mrIid);
		return (data as Array<Record<string, unknown>>).map((n) => ({
			id: n.id as number,
			body: (n.body as string) ?? '',
			author: {
				username: ((n.author as Record<string, unknown>)?.username as string) ?? 'unknown',
			},
			createdAt: (n.created_at as string) ?? '',
			system: (n.system as boolean) ?? false,
			resolvable: (n.resolvable as boolean) ?? false,
			resolved: (n.resolved as boolean) ?? false,
		}));
	},

	async createMR(projectId: string, params: CreateMRParams): Promise<CreatedMR> {
		logger.debug('Creating MR', {
			projectId,
			sourceBranch: params.sourceBranch,
			targetBranch: params.targetBranch,
		});
		const data = await getClient().MergeRequests.create(
			projectId,
			params.sourceBranch,
			params.targetBranch,
			params.title,
			{ description: params.description },
		);
		const d = data as Record<string, unknown>;
		return {
			iid: d.iid as number,
			webUrl: d.web_url as string,
			title: d.title as string,
		};
	},

	async createMRNote(projectId: string, mrIid: number, body: string): Promise<{ id: number }> {
		logger.debug('Creating MR note', { projectId, mrIid });
		const data = await getClient().MergeRequestNotes.create(projectId, mrIid, body);
		return { id: (data as { id: number }).id };
	},

	async updateMRNote(
		projectId: string,
		mrIid: number,
		noteId: number,
		body: string,
	): Promise<{ id: number }> {
		logger.debug('Updating MR note', { projectId, mrIid, noteId });
		const data = await getClient().MergeRequestNotes.edit(projectId, mrIid, noteId, { body });
		return { id: (data as { id: number }).id };
	},

	async deleteMRNote(projectId: string, mrIid: number, noteId: number): Promise<void> {
		logger.debug('Deleting MR note', { projectId, mrIid, noteId });
		await getClient().MergeRequestNotes.remove(projectId, mrIid, noteId);
	},

	async getMRApprovals(projectId: string, mrIid: number): Promise<MRApprovalState> {
		logger.debug('Fetching MR approval state', { projectId, mrIid });
		const data = await getClient().MergeRequestApprovals.showApprovalState(projectId, mrIid);
		const rules = (data as { rules?: Array<Record<string, unknown>> }).rules ?? [];
		const approvedBy: Array<{ username: string }> = [];
		for (const rule of rules) {
			const users = (rule.approved_by as Array<Record<string, unknown>>) ?? [];
			for (const user of users) {
				approvedBy.push({ username: (user.username as string) ?? 'unknown' });
			}
		}
		return {
			approved: approvedBy.length > 0,
			approvedBy,
		};
	},

	async approveMR(projectId: string, mrIid: number): Promise<void> {
		logger.debug('Approving MR', { projectId, mrIid });
		await getClient().MergeRequestApprovals.approve(projectId, mrIid);
	},

	async unapproveMR(projectId: string, mrIid: number): Promise<void> {
		logger.debug('Unapproving MR', { projectId, mrIid });
		await getClient().MergeRequestApprovals.unapprove(projectId, mrIid);
	},

	async getPipelineStatus(projectId: string, pipelineId: number): Promise<PipelineStatus> {
		logger.debug('Fetching pipeline status', { projectId, pipelineId });
		const data = await getClient().Pipelines.show(projectId, pipelineId);
		const d = data as Record<string, unknown>;
		return {
			id: d.id as number,
			status: d.status as string,
			ref: d.ref as string,
			sha: d.sha as string,
			webUrl: d.web_url as string,
		};
	},

	async getFailedPipelineJobs(projectId: string, pipelineId: number): Promise<FailedPipelineJobs> {
		logger.debug('Fetching failed pipeline jobs', { projectId, pipelineId });
		const client = getClient();
		const pipeline = await this.getPipelineStatus(projectId, pipelineId);
		const allJobs = await client.Jobs.all(projectId, { pipelineId });
		const failedJobs = (allJobs as Array<Record<string, unknown>>)
			.filter((j) => j.status === 'failed')
			.map((j) => ({
				id: j.id as number,
				name: (j.name as string) ?? '',
				stage: (j.stage as string) ?? '',
				status: (j.status as string) ?? 'failed',
				webUrl: (j.web_url as string) ?? '',
				failureReason: (j.failure_reason as string) ?? null,
			}));
		return { pipeline, failedJobs };
	},

	async getJobLog(projectId: string, jobId: number): Promise<string> {
		logger.debug('Fetching job log', { projectId, jobId });
		const trace = await getClient().Jobs.showLog(projectId, jobId);
		// showLog returns the raw log as a string
		return typeof trace === 'string' ? trace : String(trace);
	},

	async mergeMR(projectId: string, mrIid: number, options?: { squash?: boolean }): Promise<void> {
		logger.debug('Merging MR', { projectId, mrIid, squash: options?.squash });
		await getClient().MergeRequests.accept(projectId, mrIid, {
			squash: options?.squash,
		});
	},

	async getOpenMRByBranch(projectId: string, sourceBranch: string): Promise<CreatedMR | null> {
		logger.debug('Looking up open MR by branch', { projectId, sourceBranch });
		const data = await getClient().MergeRequests.all({
			projectId,
			sourceBranch,
			state: 'opened',
			perPage: 1,
		});
		const mrs = data as Array<Record<string, unknown>>;
		if (mrs.length === 0) return null;
		return {
			iid: mrs[0].iid as number,
			webUrl: mrs[0].web_url as string,
			title: mrs[0].title as string,
		};
	},

	async createMRReview(
		projectId: string,
		mrIid: number,
		body: string,
		action: 'approve' | 'unapprove',
	): Promise<void> {
		logger.debug('Creating MR review', { projectId, mrIid, action });
		if (action === 'approve') {
			await this.approveMR(projectId, mrIid);
		} else {
			await this.unapproveMR(projectId, mrIid);
		}
		if (body) {
			await this.createMRNote(projectId, mrIid, body);
		}
	},

	async listPipelines(
		projectId: string,
		ref: string,
	): Promise<Array<{ id: number; status: string; ref: string; sha: string; webUrl: string }>> {
		logger.debug('Listing pipelines for ref', { projectId, ref });
		const client = getClient();

		// Try as branch name first
		let data = await client.Pipelines.all(projectId, {
			ref,
			perPage: 5,
			orderBy: 'id',
			sort: 'desc',
		});

		// If no results and ref looks like a SHA (hex, 7-40 chars), try sha filter
		if ((data as Array<unknown>).length === 0 && /^[0-9a-f]{7,40}$/i.test(ref)) {
			logger.debug('No pipelines for ref as branch, trying as SHA', { projectId, ref });
			data = await client.Pipelines.all(projectId, {
				sha: ref,
				perPage: 5,
				orderBy: 'id',
				sort: 'desc',
			});
		}

		const pipelines = data as Array<Record<string, unknown>>;
		return pipelines.map((p) => ({
			id: p.id as number,
			status: p.status as string,
			ref: p.ref as string,
			sha: p.sha as string,
			webUrl: p.web_url as string,
		}));
	},
};

// ============================================================================
// Token Identity Resolution
// ============================================================================

export async function getGitLabUserForToken(
	token: string | null,
	host: string = 'https://gitlab.com',
): Promise<string | null> {
	if (!token) return null;

	try {
		const tempClient = new Gitlab({ token, host });
		const user = await tempClient.Users.showCurrentUser();
		return (user as { username?: string }).username ?? null;
	} catch (err) {
		logger.warn('Failed to resolve GitLab identity for token', { error: String(err) });
		return null;
	}
}
