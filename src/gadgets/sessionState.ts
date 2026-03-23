import type { FinishHookFlags } from '../agents/definitions/schema.js';

/** Env var holding the temp file path for the review sidecar (written by CLI subprocess, read by adapter). */
export const REVIEW_SIDECAR_ENV_VAR = 'CASCADE_REVIEW_SIDECAR_PATH';
/** Env var holding the temp file path for the PR sidecar (written by CLI subprocess, read by adapter). */
export const PR_SIDECAR_ENV_VAR = 'CASCADE_PR_SIDECAR_PATH';
/** Env var holding the temp file path for authoritative pushed-changes evidence. */
export const PUSHED_CHANGES_SIDECAR_ENV_VAR = 'CASCADE_PUSHED_CHANGES_SIDECAR_PATH';
/** Env var holding the temp file path for PM write evidence (written by cascade-tools pm add-checklist). */
export const PM_WRITE_SIDECAR_ENV_VAR = 'CASCADE_PM_WRITE_SIDECAR_PATH';

export type SessionHooks = FinishHookFlags;

export interface InitSessionStateOptions {
	agentType: string;
	baseBranch?: string;
	projectId?: string;
	workItemId?: string;
	hooks?: SessionHooks;
	workItemUrl?: string;
	workItemTitle?: string;
	initialHeadSha?: string;
}

interface SessionStateData {
	agentType: string | null;
	baseBranch: string;
	projectId: string | null;
	workItemId: string | null;
	workItemUrl: string | null;
	workItemTitle: string | null;
	initialHeadSha: string | null;
	hooks: SessionHooks;
	readOnlyFs: boolean;
	prCreated: boolean;
	prUrl: string | null;
	reviewSubmitted: boolean;
	reviewUrl: string | null;
	reviewBody: string | null;
	reviewEvent: string | null;
	initialCommentId: number | null;
}

/**
 * Injectable SessionState class. Encapsulates all mutable session-level state
 * accessible to gadgets. Use `createSessionState()` to create isolated instances
 * in tests, or `setDefaultSessionState()` to inject a custom instance.
 */
export class SessionState {
	private state: SessionStateData = {
		agentType: null,
		baseBranch: 'main',
		projectId: null,
		workItemId: null,
		workItemUrl: null,
		workItemTitle: null,
		initialHeadSha: null,
		hooks: {},
		readOnlyFs: false,
		prCreated: false,
		prUrl: null,
		reviewSubmitted: false,
		reviewUrl: null,
		reviewBody: null,
		reviewEvent: null,
		initialCommentId: null,
	};

	init(options: InitSessionStateOptions): void {
		const {
			agentType,
			baseBranch,
			projectId,
			workItemId,
			hooks,
			workItemUrl,
			workItemTitle,
			initialHeadSha,
		} = options;
		this.state = {
			agentType,
			baseBranch: baseBranch ?? 'main',
			projectId: projectId ?? null,
			workItemId: workItemId ?? null,
			workItemUrl: workItemUrl ?? null,
			workItemTitle: workItemTitle ?? null,
			initialHeadSha: initialHeadSha ?? null,
			hooks: hooks ?? {},
			readOnlyFs: false,
			prCreated: false,
			prUrl: null,
			reviewSubmitted: false,
			reviewUrl: null,
			reviewBody: null,
			reviewEvent: null,
			initialCommentId: null,
		};
	}

	getBaseBranch(): string {
		return this.state.baseBranch;
	}

	getProjectId(): string | null {
		return this.state.projectId;
	}

	getWorkItemId(): string | null {
		return this.state.workItemId;
	}

	setReadOnlyFs(readOnly: boolean): void {
		this.state.readOnlyFs = readOnly;
	}

	getWorkItemUrl(): string | null {
		return this.state.workItemUrl;
	}

	getWorkItemTitle(): string | null {
		return this.state.workItemTitle;
	}

	recordPRCreation(prUrl: string): void {
		this.state.prCreated = true;
		this.state.prUrl = prUrl;
	}

	recordReviewSubmission(reviewUrl: string, body?: string | null, event?: string | null): void {
		this.state.reviewSubmitted = true;
		this.state.reviewUrl = reviewUrl;
		this.state.reviewBody = body ?? null;
		this.state.reviewEvent = event ?? null;
	}

	recordInitialComment(commentId: number): void {
		this.state.initialCommentId = commentId;
	}

	/**
	 * Clear the initial comment ID from session state without performing a deletion.
	 *
	 * Called by the backend adapter when the sidecar signals that the subprocess
	 * already deleted the comment (ackCommentDeleted: true), so that the
	 * GitHubProgressPoster post-agent callback does not attempt a redundant delete.
	 */
	clearInitialComment(): void {
		this.state.initialCommentId = null;
	}

	/**
	 * Delete the initial ack comment from the PR and clear it from session state.
	 *
	 * Called by gadgets (e.g. CreatePRReview) immediately after a significant event
	 * to clean up the stale ack/progress comment as soon as possible.
	 * Wrapped in a try-catch so failures don't propagate to the caller.
	 */
	async deleteInitialComment(owner: string, repo: string): Promise<void> {
		const commentId = this.state.initialCommentId;
		if (!commentId) return;

		// Clear state first so the post-agent callback sees null and short-circuits
		this.state.initialCommentId = null;

		try {
			const { githubClient } = await import('../github/client.js');
			await githubClient.deletePRComment(owner, repo, commentId);
		} catch {
			// Best-effort: restore the id so post-agent callback can retry
			this.state.initialCommentId = commentId;
		}
	}

	getSessionState(): SessionStateData {
		return { ...this.state };
	}
}

/**
 * Create an isolated SessionState instance. Use this in tests to avoid
 * state bleeding between parallel test cases.
 */
export function createSessionState(): SessionState {
	return new SessionState();
}

// Module-level default instance — shared by all module-level wrapper functions
let _defaultInstance: SessionState = new SessionState();

/**
 * Replace the module-level default instance. Useful in tests or DI scenarios
 * where a custom SessionState should be injected for all wrapper functions.
 */
export function setDefaultSessionState(instance: SessionState): void {
	_defaultInstance = instance;
}

// ---------------------------------------------------------------------------
// Backward-compatible module-level wrapper functions
// All 17 consumers continue to work without import changes.
// ---------------------------------------------------------------------------

export function initSessionState(options: InitSessionStateOptions): void {
	_defaultInstance.init(options);
}

export function getBaseBranch(): string {
	return _defaultInstance.getBaseBranch();
}

export function getProjectId(): string | null {
	return _defaultInstance.getProjectId();
}

export function getWorkItemId(): string | null {
	return _defaultInstance.getWorkItemId();
}

export function setReadOnlyFs(readOnly: boolean): void {
	_defaultInstance.setReadOnlyFs(readOnly);
}

export function getWorkItemUrl(): string | null {
	return _defaultInstance.getWorkItemUrl();
}

export function getWorkItemTitle(): string | null {
	return _defaultInstance.getWorkItemTitle();
}

export function recordPRCreation(prUrl: string): void {
	_defaultInstance.recordPRCreation(prUrl);
}

export function recordReviewSubmission(
	reviewUrl: string,
	body?: string | null,
	event?: string | null,
): void {
	_defaultInstance.recordReviewSubmission(reviewUrl, body, event);
}

export function recordInitialComment(commentId: number): void {
	_defaultInstance.recordInitialComment(commentId);
}

/**
 * Clear the initial comment ID from session state without performing a deletion.
 *
 * Called by the backend adapter when the sidecar signals that the subprocess
 * already deleted the comment (ackCommentDeleted: true), so that the
 * GitHubProgressPoster post-agent callback does not attempt a redundant delete.
 */
export function clearInitialComment(): void {
	_defaultInstance.clearInitialComment();
}

/**
 * Delete the initial ack comment from the PR and clear it from session state.
 *
 * Called by gadgets (e.g. CreatePRReview) immediately after a significant event
 * to clean up the stale ack/progress comment as soon as possible.
 * Wrapped in a try-catch so failures don't propagate to the caller.
 */
export async function deleteInitialComment(owner: string, repo: string): Promise<void> {
	return _defaultInstance.deleteInitialComment(owner, repo);
}

export function getSessionState() {
	return _defaultInstance.getSessionState();
}
