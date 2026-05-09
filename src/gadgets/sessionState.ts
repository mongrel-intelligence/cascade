import type { FinishHookFlags } from '../agents/definitions/schema.js';

/** Env var holding the temp file path for the review sidecar (written by CLI subprocess, read by adapter). */
export const REVIEW_SIDECAR_ENV_VAR = 'CASCADE_REVIEW_SIDECAR_PATH';
/** Env var holding the temp file path for the PR sidecar (written by CLI subprocess, read by adapter). */
export const PR_SIDECAR_ENV_VAR = 'CASCADE_PR_SIDECAR_PATH';
/** Env var holding the temp file path for authoritative pushed-changes evidence. */
export const PUSHED_CHANGES_SIDECAR_ENV_VAR = 'CASCADE_PUSHED_CHANGES_SIDECAR_PATH';
/** Env var holding the temp file path for PM write evidence (written by cascade-tools pm add-checklist). */
export const PM_WRITE_SIDECAR_ENV_VAR = 'CASCADE_PM_WRITE_SIDECAR_PATH';
/** Env var holding the JSONL outbox for incidental friction reports. */
export const FRICTION_SIDECAR_ENV_VAR = 'CASCADE_FRICTION_SIDECAR_PATH';

export type SessionHooks = FinishHookFlags;

export interface InitSessionStateOptions {
	agentType: string;
	baseBranch?: string;
	projectId?: string;
	workItemId?: string;
	hooks?: SessionHooks;
	workItemUrl?: string;
	workItemTitle?: string;
	frictionSidecarPath?: string;
	initialHeadSha?: string;
	/**
	 * The PR HEAD branch name. Threaded into Finish validation so that
	 * `hasUnpushedCommits` can use ls-remote SHA comparison instead of the
	 * `@{upstream}` / `rev-parse --abbrev-ref` chain that breaks in detached HEAD
	 * (the shape every PR-checkout worker is in via `refs/pull/N/head`).
	 */
	prBranch?: string;
}

interface SessionStateData {
	agentType: string | null;
	baseBranch: string;
	prBranch: string | null;
	projectId: string | null;
	workItemId: string | null;
	workItemUrl: string | null;
	workItemTitle: string | null;
	frictionSidecarPath: string | null;
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
	/**
	 * Set to `true` after a gadget mid-run delete (or sidecar-driven clear) has
	 * disposed of the initial ack comment. The post-agent cleanup hook reads
	 * this and skips its DELETE entirely, including the legacy fallback to
	 * `agentInput.ackCommentId`. Distinguishes "we never had a comment" (false)
	 * from "we had one but it's already gone" (true).
	 */
	initialCommentIdConsumed: boolean;
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
		prBranch: null,
		projectId: null,
		workItemId: null,
		workItemUrl: null,
		workItemTitle: null,
		frictionSidecarPath: null,
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
		initialCommentIdConsumed: false,
	};

	init(options: InitSessionStateOptions): void {
		const {
			agentType,
			baseBranch,
			prBranch,
			projectId,
			workItemId,
			hooks,
			workItemUrl,
			workItemTitle,
			frictionSidecarPath,
			initialHeadSha,
		} = options;
		this.state = {
			agentType,
			baseBranch: baseBranch ?? 'main',
			prBranch: prBranch ?? null,
			projectId: projectId ?? null,
			workItemId: workItemId ?? null,
			workItemUrl: workItemUrl ?? null,
			workItemTitle: workItemTitle ?? null,
			frictionSidecarPath: frictionSidecarPath ?? null,
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
			initialCommentIdConsumed: false,
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

	getFrictionSidecarPath(): string | null {
		return this.state.frictionSidecarPath;
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
		// Mark consumed so the post-agent callback skips even if agentInput
		// still carries the original ackCommentId as a legacy fallback.
		this.state.initialCommentIdConsumed = true;
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

		// Clear the id eagerly so concurrent reads can't observe a stale value.
		// The post-agent callback's actual gate is the `initialCommentIdConsumed`
		// flag set below — once that's true, the callback's legacy fallback to
		// `agentInput.ackCommentId` is also short-circuited.
		this.state.initialCommentId = null;

		try {
			const { githubClient } = await import('../github/client.js');
			await githubClient.deletePRComment(owner, repo, commentId);
			// `deletePRComment` swallows 404 internally, so reaching here without
			// throwing covers both 200/204 (we deleted) and 404 (someone else
			// already did) outcomes — both mean the comment is gone.
			this.state.initialCommentIdConsumed = true;
		} catch {
			// Best-effort: restore the id so post-agent callback can retry.
			// Consumed flag stays false — the comment may still be live.
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

export function getFrictionSidecarPath(): string | null {
	return _defaultInstance.getFrictionSidecarPath();
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
