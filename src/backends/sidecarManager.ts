import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { getAgentProfile } from '../agents/definitions/profiles.js';
import { materializeFrictionReport } from '../friction/materialize.js';
import {
	appendFiledFrictionReport,
	rewriteFrictionSidecarWithPending,
} from '../friction/sidecar.js';
import {
	clearInitialComment,
	FRICTION_SIDECAR_ENV_VAR,
	PM_WRITE_SIDECAR_ENV_VAR,
	PR_SIDECAR_ENV_VAR,
	PUSHED_CHANGES_SIDECAR_ENV_VAR,
	REVIEW_SIDECAR_ENV_VAR,
	recordPRCreation,
	recordReviewSubmission,
} from '../gadgets/sessionState.js';
import { pmRegistry } from '../pm/registry.js';
import { captureException } from '../sentry.js';
import type { AgentInput, ProjectConfig } from '../types/index.js';
import { logger } from '../utils/logging.js';
import { readCompletionEvidence } from './completion.js';
import type { AgentEngineResult } from './types.js';

/**
 * Create temp-file paths for all completion sidecars and inject them into
 * projectSecrets so the subprocess can write to them at runtime.
 */
export function createCompletionArtifacts(
	profile: Awaited<ReturnType<typeof getAgentProfile>>,
	_agentType: string,
	needsNativeToolRuntime: boolean,
	input: AgentInput,
	projectSecrets: Record<string, string>,
): {
	prSidecarPath: string | undefined;
	pushedChangesSidecarPath: string | undefined;
	reviewSidecarPath: string | undefined;
	pmWriteSidecarPath: string | undefined;
	frictionSidecarPath: string | undefined;
} {
	const frictionSidecarPath = join(
		tmpdir(),
		`cascade-friction-sidecar-${process.pid}-${Date.now()}.jsonl`,
	);
	projectSecrets[FRICTION_SIDECAR_ENV_VAR] = frictionSidecarPath;

	const reviewSidecarPath = profile.finishHooks.requiresReview
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
	if (input.prBranch) {
		projectSecrets.CASCADE_PR_BRANCH = input.prBranch as string;
	}

	return {
		prSidecarPath,
		pushedChangesSidecarPath,
		reviewSidecarPath,
		pmWriteSidecarPath,
		frictionSidecarPath,
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
		// Prod regression 2026-05-09 (run d8e31665): "PR sidecar missing required
		// fields { hasPrUrl: false }" was the only WARN — operators had no signal
		// of whether the file was empty, malformed, or had a non-prUrl field.
		// Re-read the raw payload and dump the keys + actual values so a single
		// log line tells the whole story. The discriminated 'rawSidecarStatus'
		// field makes empty vs malformed vs missing vs parsed-without-prUrl each
		// produce a distinct log shape so no Loki archaeology is needed.
		const rawSidecar = readRawPRSidecar(sidecarPath);
		const parsedData = rawSidecar.status === 'parsed' ? rawSidecar.data : null;
		logger.warn('PR sidecar missing required fields', {
			sidecarPath,
			hasPrUrl: !!sidecar.prUrl,
			rawSidecarStatus: rawSidecar.status,
			rawSidecarKeys: parsedData ? Object.keys(parsedData).sort() : null,
			rawSidecarPrUrl:
				parsedData !== null && typeof parsedData.prUrl !== 'undefined' ? parsedData.prUrl : null,
			rawSidecarPrNumber:
				parsedData !== null && typeof parsedData.prNumber !== 'undefined'
					? parsedData.prNumber
					: null,
			rawByteLength:
				rawSidecar.status === 'empty' || rawSidecar.status === 'malformed'
					? rawSidecar.rawByteLength
					: undefined,
			parseError: rawSidecar.status === 'malformed' ? rawSidecar.parseError : undefined,
			rawPreview: rawSidecar.status === 'malformed' ? rawSidecar.rawPreview : undefined,
		});
	} catch (err) {
		logger.warn('Failed to read PR sidecar', { path: sidecarPath, error: String(err) });
	}

	return {};
}

/**
 * Discriminated diagnostic result from reading the raw PR sidecar file.
 * Returned by `readRawPRSidecar` so the WARN log can tell apart:
 *   - 'missing'  — file never written (agent exited before calling cascade-tools)
 *   - 'empty'    — file exists but is zero/whitespace bytes (truncated mid-write or race)
 *   - 'malformed' — JSON parse failed (partial write, encoding issue); rawPreview helps triage
 *   - 'parsed'   — valid JSON object (normal path — prUrl simply absent from payload)
 */
type RawSidecarDiagnostic =
	| { status: 'missing' }
	| { status: 'empty'; rawByteLength: number }
	| { status: 'malformed'; rawByteLength: number; parseError: string; rawPreview: string }
	| { status: 'parsed'; data: Record<string, unknown> };

/**
 * Best-effort raw read of the sidecar JSON for diagnostic purposes.
 * Returns a discriminated union instead of a nullable object so the WARN log
 * can distinguish 'no file' / 'empty file' / 'malformed JSON' / 'valid JSON without prUrl'.
 * Each case produces a distinct log shape — operators can triage from a single log line
 * without Loki archaeology.
 */
function readRawPRSidecar(path: string): RawSidecarDiagnostic {
	if (!existsSync(path)) return { status: 'missing' };
	let raw: string;
	try {
		raw = readFileSync(path, 'utf-8');
	} catch (err) {
		// readFileSync itself threw (permissions, I/O error) — treat as malformed.
		return { status: 'malformed', rawByteLength: 0, parseError: String(err), rawPreview: '' };
	}
	if (!raw.trim()) return { status: 'empty', rawByteLength: raw.length };
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === 'object') {
			return { status: 'parsed', data: parsed as Record<string, unknown> };
		}
		// JSON.parse succeeded but returned a primitive (null, number, string) — not an object.
		return {
			status: 'malformed',
			rawByteLength: raw.length,
			parseError: 'parsed value is not an object',
			rawPreview: raw.slice(0, 200),
		};
	} catch (err) {
		return {
			status: 'malformed',
			rawByteLength: raw.length,
			parseError: String(err),
			rawPreview: raw.slice(0, 200),
		};
	}
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

export interface DrainFrictionSidecarOptions {
	sidecarPath?: string;
	project: ProjectConfig;
	agentType: string;
	runId?: string;
	engineId?: string;
}

async function withProjectPMCredentials<T>(
	project: ProjectConfig,
	fn: () => Promise<T>,
): Promise<T> {
	const integration = pmRegistry.getOrNull(project.pm?.type ?? 'trello');
	if (!integration) return fn();
	return integration.withCredentials(project.id, fn);
}

/**
 * Best-effort drain of queued friction reports from the JSONL sidecar.
 *
 * This deliberately never throws. Friction reporting is incidental telemetry:
 * a failed materialization should be visible in logs/Sentry, but must not flip
 * the primary agent run from success to failure or mask the original error.
 */
export async function drainFrictionSidecarReports({
	sidecarPath,
	project,
	agentType,
	runId,
	engineId,
}: DrainFrictionSidecarOptions): Promise<void> {
	if (!sidecarPath) return;

	let pending: Awaited<ReturnType<typeof rewriteFrictionSidecarWithPending>>;
	try {
		pending = await rewriteFrictionSidecarWithPending(sidecarPath);
	} catch (err) {
		logger.warn('Failed to read friction sidecar before drain', {
			sidecarPath,
			projectId: project.id,
			agentType,
			runId,
			engine: engineId,
			error: String(err),
		});
		captureException(err instanceof Error ? err : new Error(String(err)), {
			tags: {
				source: 'friction_sidecar_drain_failed',
				phase: 'read',
				agentType,
			},
			extra: { sidecarPath, projectId: project.id, runId, engine: engineId },
		});
		return;
	}

	if (pending.length === 0) return;

	logger.info('Draining pending friction sidecar reports', {
		sidecarPath,
		projectId: project.id,
		agentType,
		runId,
		engine: engineId,
		pendingCount: pending.length,
	});

	for (const event of pending) {
		try {
			const result = await withProjectPMCredentials(project, () =>
				materializeFrictionReport({ project, report: event.report }),
			);
			if (result.status === 'filed') {
				await appendFiledFrictionReport(sidecarPath, {
					reportId: event.reportId,
					workItemId: result.workItemId,
					workItemUrl: result.workItemUrl,
				});
				logger.info('Drained friction sidecar report', {
					sidecarPath,
					projectId: project.id,
					agentType,
					runId,
					engine: engineId,
					reportId: event.reportId,
					workItemId: result.workItemId,
				});
			} else {
				logger.warn('Skipped friction sidecar report during drain', {
					sidecarPath,
					projectId: project.id,
					agentType,
					runId,
					engine: engineId,
					reportId: event.reportId,
					reason: result.reason,
					message: result.message,
				});
			}
		} catch (err) {
			logger.warn('Failed to drain friction sidecar report', {
				sidecarPath,
				projectId: project.id,
				agentType,
				runId,
				engine: engineId,
				reportId: event.reportId,
				error: String(err),
			});
			captureException(err instanceof Error ? err : new Error(String(err)), {
				tags: {
					source: 'friction_sidecar_drain_failed',
					phase: 'materialize',
					agentType,
				},
				extra: {
					sidecarPath,
					projectId: project.id,
					runId,
					engine: engineId,
					reportId: event.reportId,
				},
			});
		}
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
