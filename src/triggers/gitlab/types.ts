/**
 * GitLab webhook payload interfaces and type guards.
 *
 * GitLab uses `object_kind` to identify the event type in webhook payloads.
 * MR IIDs are project-scoped (equivalent to GitHub PR numbers).
 */

// ---------------------------------------------------------------------------
// Merge Request Hook
// ---------------------------------------------------------------------------

export interface GitLabMergeRequestPayload {
	object_kind: 'merge_request';
	event_type: 'merge_request';
	user: { username: string };
	project: { path_with_namespace: string; id: number };
	object_attributes: {
		iid: number;
		title: string;
		description: string | null;
		source_branch: string;
		target_branch: string;
		state: string; // 'opened', 'closed', 'merged'
		action: string; // 'open', 'close', 'reopen', 'update', 'merge', 'approved', 'unapproved'
		work_in_progress: boolean;
		url: string;
		last_commit: { id: string };
		author_id: number;
		has_conflicts?: boolean;
	};
	repository: { name: string; url: string };
	labels?: Array<{ title: string }>;
	changes?: Record<string, { previous?: unknown; current?: unknown }>;
	reviewers?: Array<{ username: string }>;
}

// ---------------------------------------------------------------------------
// Pipeline Hook
// ---------------------------------------------------------------------------

export interface GitLabPipelinePayload {
	object_kind: 'pipeline';
	object_attributes: {
		id: number;
		ref: string;
		sha: string;
		status: string; // 'success', 'failed', 'running', 'pending', 'canceled'
		stages: string[];
	};
	user: { username: string };
	project: { path_with_namespace: string; id: number };
	merge_request?: {
		iid: number;
		title: string;
		url: string;
		source_branch: string;
		target_branch: string;
		state: string;
	};
	builds?: Array<{
		id: number;
		name: string;
		stage: string;
		status: string;
		failure_reason?: string;
	}>;
}

// ---------------------------------------------------------------------------
// Note Hook (comments on MRs, Issues, Commits, Snippets)
// ---------------------------------------------------------------------------

export interface GitLabNotePayload {
	object_kind: 'note';
	event_type: 'note';
	user: { username: string };
	project: { path_with_namespace: string; id: number };
	object_attributes: {
		id: number;
		note: string;
		noteable_type: string; // 'MergeRequest', 'Issue', 'Commit', 'Snippet'
		author_id: number;
		url: string;
	};
	merge_request?: {
		iid: number;
		title: string;
		url: string;
		source_branch: string;
		target_branch: string;
		state: string;
		last_commit: { id: string };
	};
	repository: { name: string; url: string };
}

// ---------------------------------------------------------------------------
// Type Guards
// ---------------------------------------------------------------------------

export function isGitLabMergeRequestPayload(
	payload: unknown,
): payload is GitLabMergeRequestPayload {
	if (typeof payload !== 'object' || payload === null) return false;
	const p = payload as Record<string, unknown>;
	return (
		p.object_kind === 'merge_request' &&
		typeof p.object_attributes === 'object' &&
		p.object_attributes !== null &&
		typeof p.project === 'object' &&
		p.project !== null
	);
}

export function isGitLabPipelinePayload(payload: unknown): payload is GitLabPipelinePayload {
	if (typeof payload !== 'object' || payload === null) return false;
	const p = payload as Record<string, unknown>;
	return (
		p.object_kind === 'pipeline' &&
		typeof p.object_attributes === 'object' &&
		p.object_attributes !== null &&
		typeof p.project === 'object' &&
		p.project !== null
	);
}

export function isGitLabNotePayload(payload: unknown): payload is GitLabNotePayload {
	if (typeof payload !== 'object' || payload === null) return false;
	const p = payload as Record<string, unknown>;
	return (
		p.object_kind === 'note' &&
		typeof p.object_attributes === 'object' &&
		p.object_attributes !== null &&
		typeof p.project === 'object' &&
		p.project !== null
	);
}
