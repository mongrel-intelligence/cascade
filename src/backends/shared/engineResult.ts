/**
 * Shared result-building helpers for constructing `AgentEngineResult` objects.
 *
 * Provides top-level assemblers that unify the result-construction patterns used
 * across all engine implementations (Claude Code, Codex, OpenCode).  Prefer these
 * helpers over inlining result-object literals so the shape stays consistent and
 * easy to update in one place.
 */

import { extractPRUrl } from '../../utils/prUrl.js';
import type { AgentEngineResult } from '../types.js';
import { buildTextPrEvidence } from './resultBuilder.js';

/**
 * Build an `AgentEngineResult` from its constituent parts.
 *
 * This is the canonical factory for engine results.  Pass only the fields that
 * are known at the call site; omit optional fields (`cost`, `error`, `logBuffer`,
 * `runId`) when they are not available.
 *
 * @example
 * return buildEngineResult({ success: true, output: finalOutput, cost, prUrl, prEvidence });
 */
export function buildEngineResult(params: {
	success: boolean;
	output: string;
	prUrl?: string | undefined;
	prEvidence?: AgentEngineResult['prEvidence'];
	error?: string | undefined;
	cost?: number | undefined;
	logBuffer?: Buffer | undefined;
	runId?: string | undefined;
}): AgentEngineResult {
	const result: AgentEngineResult = {
		success: params.success,
		output: params.output,
	};
	if (params.prUrl !== undefined) result.prUrl = params.prUrl;
	if (params.prEvidence !== undefined) result.prEvidence = params.prEvidence;
	if (params.error !== undefined) result.error = params.error;
	if (params.cost !== undefined) result.cost = params.cost;
	if (params.logBuffer !== undefined) result.logBuffer = params.logBuffer;
	if (params.runId !== undefined) result.runId = params.runId;
	return result;
}

/**
 * Extract a GitHub PR URL from text and build the accompanying PR evidence object
 * in a single call.
 *
 * Combines the two-step `extractPRUrl()` + `buildTextPrEvidence()` pattern that
 * appears across multiple engine backends into one convenience helper.
 *
 * @param text - Agent output text to search for a PR URL
 * @returns `{ prUrl, prEvidence }` — `prUrl` is `undefined` when no URL is found;
 *   `prEvidence` mirrors `buildTextPrEvidence()` (defined iff `prUrl` is defined)
 *
 * @example
 * const { prUrl, prEvidence } = extractAndBuildPrEvidence(output);
 * return buildEngineResult({ success: true, output, cost, prUrl, prEvidence });
 */
export function extractAndBuildPrEvidence(text: string): {
	prUrl: string | undefined;
	prEvidence: AgentEngineResult['prEvidence'];
} {
	const prUrl = extractPRUrl(text);
	const prEvidence = buildTextPrEvidence(prUrl);
	return { prUrl, prEvidence };
}
