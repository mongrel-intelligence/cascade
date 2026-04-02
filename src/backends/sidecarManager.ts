import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { getAgentProfile } from '../agents/definitions/profiles.js';
import {
	clearInitialComment,
	PM_WRITE_SIDECAR_ENV_VAR,
	PR_SIDECAR_ENV_VAR,
	PUSHED_CHANGES_SIDECAR_ENV_VAR,
	REVIEW_SIDECAR_ENV_VAR,
	recordPRCreation,
	recordReviewSubmission,
} from '../gadgets/sessionState.js';
import type { AgentInput } from '../types/index.js';
import { logger } from '../utils/logging.js';
import { readCompletionEvidence } from './completion.js';
import type { AgentEngineResult } from './types.js';

/**
 * Create temp-file paths for all completion sidecars and inject them into
 * projectSecrets so the subprocess can write to them at runtime.
 */
export function createCompletionArtifacts(
	profile: Awaited<ReturnType<typeof getAgentProfile>>,
	agentType: string,
	needsNativeToolRuntime: boolean,
	input: AgentInput,
	projectSecrets: Record<string, string>,
): {
	prSidecarPath: string | undefined;
	pushedChangesSidecarPath: string | undefined;
	reviewSidecarPath: string | undefined;
	pmWriteSidecarPath: string | undefined;
} {
	const reviewSidecarPath =
		agentType === 'review'
			? join(tmpdir(), `cascade-review-sidecar-${process.pid}-${Date.now()}.json`)
			: undefined;
	if (reviewSidecarPath) {
		projectSecrets[REVIEW_SIDECAR_ENV_VAR] = reviewSidecarPath;
	}

	const prSidecarPath =
		needsNativeToolRuntime && profile.finishHooks.requiresPR
			? join(tmpdir(), `cascade-pr-sidecar-${process.pid}-${Date.now()}.json`)
			: undefined;
	if (prSidecarPath) {
		projectSecrets[PR_SIDECAR_ENV_VAR] = prSidecarPath;
	}

	const pushedChangesSidecarPath =
		needsNativeToolRuntime && profile.finishHooks.requiresPushedChanges
			? join(tmpdir(), `cascade-pushed-changes-sidecar-${process.pid}-${Date.now()}.json`)
			: undefined;
	if (pushedChangesSidecarPath) {
		projectSecrets[PUSHED_CHANGES_SIDECAR_ENV_VAR] = pushedChangesSidecarPath;
	}

	const pmWriteSidecarPath =
		needsNativeToolRuntime && profile.finishHooks.requiresPMWrite
			? join(tmpdir(), `cascade-pm-write-sidecar-${process.pid}-${Date.now()}.json`)
			: undefined;
	if (pmWriteSidecarPath) {
		projectSecrets[PM_WRITE_SIDECAR_ENV_VAR] = pmWriteSidecarPath;
	}

	if (Object.keys(profile.finishHooks).length > 0) {
		projectSecrets.CASCADE_FINISH_HOOKS = JSON.stringify(profile.finishHooks);
	}
	if (input.headSha) {
		projectSecrets.CASCADE_INITIAL_HEAD_SHA = input.headSha as string;
	}

	return {
		prSidecarPath,
		pushedChangesSidecarPath,
		reviewSidecarPath,
		pmWriteSidecarPath,
	};
}

/**
 * Read the review sidecar file written by `cascade-tools scm create-pr-review`
 * and hydrate session state so `postReviewSummaryToPM()` can post to the PM.
 *
 * Only needed for the claude-code backend where tools run as child processes
 * and cannot update the parent process's module-level session state directly.
 */
export async function hydrateReviewSidecar(sidecarPath: string): Promise<void> {
	try {
		const sidecar = readCompletionEvidence({ reviewSidecarPath: sidecarPath });
		if (sidecar.reviewBody && sidecar.reviewUrl) {
			recordReviewSubmission(sidecar.reviewUrl, sidecar.reviewBody, sidecar.reviewEvent);
			logger.info('Hydrated review sidecar from subprocess', {
				event: sidecar.reviewEvent,
				bodyLength: sidecar.reviewBody.length,
			});
		} else {
			logger.warn('Review sidecar missing required fields', {
				hasBody: !!sidecar.reviewBody,
				hasReviewUrl: !!sidecar.reviewUrl,
			});
		}
		// If the subprocess already deleted the ack comment, clear it from session state
		// so the GitHubProgressPoster post-agent callback does not attempt a redundant delete.
		if (sidecar.ackCommentDeleted) {
			clearInitialComment();
		}
	} catch (err) {
		// Sidecar not written by subprocess (agent may have failed before review) or malformed.
		logger.warn('Failed to read review sidecar', { path: sidecarPath, error: String(err) });
	}
}

export async function hydratePrSidecar(sidecarPath: string): Promise<{
	prUrl?: string;
	prEvidence?: { source: 'native-tool-sidecar'; authoritative: true; command: string };
}> {
	try {
		const sidecar = readCompletionEvidence({ prSidecarPath: sidecarPath });
		if (sidecar.prUrl) {
			recordPRCreation(sidecar.prUrl);
			logger.info('Hydrated PR sidecar from subprocess', {
				command: sidecar.prCommand ?? 'cascade-tools scm create-pr',
				prUrl: sidecar.prUrl,
			});
			return {
				prUrl: sidecar.prUrl,
				prEvidence: {
					source: 'native-tool-sidecar',
					authoritative: true,
					command: sidecar.prCommand ?? 'cascade-tools scm create-pr',
				},
			};
		}
		logger.warn('PR sidecar missing required fields', {
			hasPrUrl: !!sidecar.prUrl,
		});
	} catch (err) {
		logger.warn('Failed to read PR sidecar', { path: sidecarPath, error: String(err) });
	}

	return {};
}

/**
 * Hydrate native tool sidecars (PR and review) after engine execution.
 * Updates the result in-place with any authoritative PR evidence.
 */
export async function hydrateNativeToolSidecars(
	result: AgentEngineResult,
	prSidecarPath?: string,
	reviewSidecarPath?: string,
): Promise<void> {
	if (prSidecarPath) {
		const hydratedPr = await hydratePrSidecar(prSidecarPath);
		if (hydratedPr.prUrl) {
			result.prUrl = hydratedPr.prUrl;
			result.prEvidence = hydratedPr.prEvidence;
		}
	}

	if (reviewSidecarPath) {
		await hydrateReviewSidecar(reviewSidecarPath);
	}
}

/**
 * Best-effort cleanup of a temp file. Ignores errors silently.
 */
export function cleanupTempFile(path: string | undefined): void {
	if (!path) return;
	try {
		unlinkSync(path);
	} catch {
		// Best-effort cleanup
	}
}
