import { writeFileSync } from 'node:fs';
import { logger } from '../../../utils/logging.js';
import { getCurrentBranch, getCurrentHeadSha } from './finish.js';

export function writePMWriteSidecar(sidecarPath: string | undefined, workItemId: string): boolean {
	if (!sidecarPath || sidecarPath === 'undefined') {
		logger.warn('CASCADE_PM_WRITE_SIDECAR_PATH not set — PM write sidecar will not be written');
		return false;
	}
	try {
		writeFileSync(
			sidecarPath,
			JSON.stringify({
				written: true,
				command: 'add-checklist',
				workItemId,
				timestamp: new Date().toISOString(),
			}),
		);
		return true;
	} catch (err) {
		logger.warn({ err, sidecarPath }, 'Failed to write PM write sidecar');
		return false;
	}
}

export function writePushedChangesSidecar(sidecarPath: string | undefined): boolean {
	if (!sidecarPath || sidecarPath === 'undefined') {
		logger.warn(
			'CASCADE_PUSHED_CHANGES_SIDECAR_PATH not set — pushed-changes sidecar will not be written',
		);
		return false;
	}

	const branch = getCurrentBranch();
	const headSha = getCurrentHeadSha();
	if (!branch || !headSha) return false;

	try {
		writeFileSync(
			sidecarPath,
			JSON.stringify({
				source: 'cascade-tools session finish',
				branch,
				headSha,
			}),
		);
		return true;
	} catch (err) {
		logger.warn({ err, sidecarPath }, 'Failed to write pushed-changes sidecar');
		return false;
	}
}

export function writeReviewSidecar(
	sidecarPath: string | undefined,
	reviewUrl: string,
	event: string,
	body: string,
	ackCommentDeleted?: boolean,
): boolean {
	if (!sidecarPath || sidecarPath === 'undefined') {
		logger.warn('CASCADE_REVIEW_SIDECAR_PATH not set — review sidecar will not be written');
		return false;
	}

	// Spec 014/019 contract — same shape as writePRSidecar. Refuse to persist a
	// half-baked sidecar so downstream gets either a complete record or a clear
	// "no sidecar at all" signal, never a "missing required fields" mystery.
	if (!reviewUrl || typeof reviewUrl !== 'string') {
		logger.error('writeReviewSidecar: refusing to write — reviewUrl is missing or non-string', {
			sidecarPath,
			reviewUrl,
			event,
		});
		return false;
	}

	try {
		writeFileSync(
			sidecarPath,
			JSON.stringify({
				source: 'cascade-tools scm create-pr-review',
				reviewUrl,
				event,
				body,
				...(ackCommentDeleted && { ackCommentDeleted: true }),
			}),
		);
		return true;
	} catch (err) {
		logger.warn({ err, sidecarPath }, 'Failed to write review sidecar');
		return false;
	}
}

export function writePRSidecar(
	sidecarPath: string | undefined,
	prUrl: string,
	prNumber: number,
	alreadyExisted: boolean,
	repoFullName: string,
): boolean {
	if (!sidecarPath || sidecarPath === 'undefined') {
		logger.warn('CASCADE_PR_SIDECAR_PATH not set — PR sidecar will not be written');
		return false;
	}

	// Spec 014/019 contract — sidecar is authoritative evidence of PR creation.
	// Without prUrl + prNumber, the file is unusable downstream and the caller's
	// run will fail with "no authoritative PR creation was recorded" — but with
	// no signal of WHY the file was bad. Validate at the write boundary so the
	// failure mode produces a precise log entry. Prod regression 2026-05-09 (run
	// d8e31665) had `hasPrUrl: false` on the hydration side with no clue that
	// the writer was the source.
	if (!prUrl || typeof prUrl !== 'string') {
		logger.error('writePRSidecar: refusing to write — prUrl is missing or non-string', {
			sidecarPath,
			prUrl,
			prNumber,
			alreadyExisted,
			repoFullName,
		});
		return false;
	}
	if (typeof prNumber !== 'number' || !Number.isFinite(prNumber)) {
		logger.error('writePRSidecar: refusing to write — prNumber is missing or non-numeric', {
			sidecarPath,
			prUrl,
			prNumber,
		});
		return false;
	}

	try {
		writeFileSync(
			sidecarPath,
			JSON.stringify({
				source: 'cascade-tools scm create-pr',
				prUrl,
				prNumber,
				alreadyExisted,
				repoFullName,
			}),
		);
		return true;
	} catch (err) {
		logger.warn({ err, sidecarPath }, 'Failed to write PR sidecar');
		return false;
	}
}
