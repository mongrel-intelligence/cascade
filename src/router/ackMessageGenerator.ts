/**
 * LLM-generated acknowledgment messages for webhook events.
 *
 * Makes a single-shot LLM call to a lightweight model (same as progress tracking)
 * to produce a short, contextual ack message that reflects the actual request.
 * Gracefully falls back to static INITIAL_MESSAGES on any failure.
 */

import { LLMist, type ModelSpec } from 'llmist';

import { AGENT_ROLE_HINTS, INITIAL_MESSAGES } from '../config/agentMessages.js';
import { CUSTOM_MODELS } from '../config/customModels.js';
import { getOrgCredential, loadConfig } from '../config/provider.js';
import { logger } from '../utils/logging.js';

// ---------------------------------------------------------------------------
// System prompt for ack message generation
// ---------------------------------------------------------------------------

const ACK_SYSTEM_PROMPT = `You write brief, casual acknowledgment messages for an AI coding bot. The goal is to buy time — let the user know you've seen their request while work kicks off in the background.
Keep it under 20 words. Start with a single relevant emoji. Be conversational and natural — like a friendly coworker responding in chat. Reference the specific topic from the context (e.g. "the chart library question", "that auth bug", "the dark mode feature"). Never say "Understood", "I will", or "I'll be working on". No markdown formatting. No period at the end.

CRITICAL: Match the action verb to the agent's role. Use role-appropriate phrasing:
- Implementation agent: "On it — starting work on...", "Getting to work on...", "Building the...", "Coding up the..."
- Planning agent: "Mapping out...", "Designing the plan for...", "Sketching out the approach for...", "Planning the..."
- Review agent: "On it — checking the...", "Examining the...", "Looking over the...", "Reviewing the..."
- Splitting agent: "Breaking down...", "Splitting up...", "Carving out the tasks for..."
- Debug agent: "Digging into the logs for...", "Tracing the issue in...", "Investigating the..."
- Feedback/respond agent: "Reading through the feedback on...", "Going through the comments on..."
- Backlog-manager agent: "Checking the pipeline for...", "Selecting the next item..."
- Resolve-conflicts agent: "Resolving the conflicts on...", "Sorting out the merge conflicts for..."
- Respond-to-ci agent: "Fixing the CI failures on...", "Patching up the build for..."
- For other agent types, use generic action language: "Working on...", "Taking care of...", "Handling the..."`;

// ---------------------------------------------------------------------------
// Context extractors — pull relevant snippets from webhook payloads
// ---------------------------------------------------------------------------

const MAX_CONTEXT_LENGTH = 500;

function truncate(text: string, maxLength: number = MAX_CONTEXT_LENGTH): string {
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength)}…`;
}

/**
 * Extract context from a Trello webhook payload.
 * Pulls card name and optional comment text.
 */
export function extractTrelloContext(payload: unknown): string {
	if (!payload || typeof payload !== 'object') return '';

	const p = payload as Record<string, unknown>;
	const action = p.action as Record<string, unknown> | undefined;
	if (!action) return '';

	const data = action.data as Record<string, unknown> | undefined;
	if (!data) return '';

	const parts: string[] = [];

	const card = data.card as Record<string, unknown> | undefined;
	if (card?.name) {
		parts.push(`Card: ${card.name as string}`);
	}

	// Comment text (for commentCard actions)
	const text = data.text as string | undefined;
	if (text) {
		parts.push(`Comment: ${text}`);
	}

	return truncate(parts.join('\n'));
}

/**
 * Extract PR context from a check_suite payload.
 * PR info lives under check_suite.pull_requests[] (not at the top level).
 */
function extractCheckSuiteContext(p: Record<string, unknown>): string[] {
	const parts: string[] = [];
	const suite = p.check_suite as Record<string, unknown> | undefined;
	const prs = suite?.pull_requests as Array<Record<string, unknown>> | undefined;
	if (prs?.[0]) {
		const prNum = prs[0].number;
		const headBranch = (prs[0].head as Record<string, unknown> | undefined)?.ref;
		if (prNum) parts.push(`PR: #${prNum}`);
		if (headBranch) parts.push(`Branch: ${headBranch as string}`);
	}
	// Fall back to head_branch on the suite itself
	const headBranch = suite?.head_branch as string | undefined;
	if (headBranch && parts.length === 0) {
		parts.push(`Branch: ${headBranch}`);
	}
	return parts;
}

/**
 * Extract context from a GitHub webhook payload.
 * Pulls PR title and optional comment/review body.
 */
export function extractGitHubContext(payload: unknown, eventType: string): string {
	if (!payload || typeof payload !== 'object') return '';

	const p = payload as Record<string, unknown>;
	const parts: string[] = [];

	const pr = p.pull_request as Record<string, unknown> | undefined;
	if (pr?.title) {
		parts.push(`PR: ${pr.title as string}`);
	}

	// Fallback for check_suite events — PR info is nested differently
	if (!pr && eventType === 'check_suite') {
		parts.push(...extractCheckSuiteContext(p));
	}

	// Comment body (issue_comment or pull_request_review_comment)
	if (eventType === 'issue_comment' || eventType === 'pull_request_review_comment') {
		const comment = p.comment as Record<string, unknown> | undefined;
		if (comment?.body) {
			parts.push(`Comment: ${comment.body as string}`);
		}
	}

	// Review body (pull_request_review)
	if (eventType === 'pull_request_review') {
		const review = p.review as Record<string, unknown> | undefined;
		if (review?.body) {
			parts.push(`Review: ${review.body as string}`);
		}
	}

	return truncate(parts.join('\n'));
}

/**
 * Extract context from a JIRA webhook payload.
 * Pulls issue summary and optional comment body.
 */
export function extractJiraContext(payload: unknown): string {
	if (!payload || typeof payload !== 'object') return '';

	const p = payload as Record<string, unknown>;
	const parts: string[] = [];

	const issue = p.issue as Record<string, unknown> | undefined;
	if (issue) {
		const fields = issue.fields as Record<string, unknown> | undefined;
		if (fields?.summary) {
			parts.push(`Issue: ${fields.summary as string}`);
		}
	}

	const comment = p.comment as Record<string, unknown> | undefined;
	if (comment?.body) {
		parts.push(`Comment: ${comment.body as string}`);
	}

	return truncate(parts.join('\n'));
}

// ---------------------------------------------------------------------------
// Core generator
// ---------------------------------------------------------------------------

const ACK_TIMEOUT_MS = 30_000;

const GENERIC_FALLBACK = '**⚙️ Working on it** — Processing your request...';

function getStaticFallback(agentType: string): string {
	return INITIAL_MESSAGES[agentType] ?? GENERIC_FALLBACK;
}

/**
 * Generate a contextual acknowledgment message using a lightweight LLM call.
 *
 * Falls back to static INITIAL_MESSAGES on any failure:
 * - No progressModel configured
 * - No OPENROUTER_API_KEY credential
 * - Empty context snippet
 * - LLM call failure (network, auth, etc.)
 * - LLM call exceeds 30s timeout
 * - LLM returns empty output
 */
export async function generateAckMessage(
	agentType: string,
	contextSnippet: string,
	projectId: string,
): Promise<string> {
	const fallback = getStaticFallback(agentType);

	// No context to work with — use static message
	if (!contextSnippet.trim()) {
		return fallback;
	}

	let restoreEnv: (() => void) | undefined;

	try {
		// Load config to get progressModel from project config
		const config = await loadConfig();
		const project = config.projects?.find((p) => p.id === projectId);
		const progressModel = project?.progressModel;
		if (!progressModel) {
			return fallback;
		}

		// Resolve API key
		const apiKey = await getOrgCredential(projectId, 'OPENROUTER_API_KEY');
		if (!apiKey) {
			return fallback;
		}

		// Temporarily inject API key into process.env (same pattern as llmEnv.ts)
		const previousKey = process.env.OPENROUTER_API_KEY;
		process.env.OPENROUTER_API_KEY = apiKey;
		restoreEnv = () => {
			if (previousKey === undefined) {
				process.env.OPENROUTER_API_KEY = undefined;
			} else {
				process.env.OPENROUTER_API_KEY = previousKey;
			}
		};

		// Single-shot LLM call with timeout
		const llmPromise = callAckModel(progressModel, agentType, contextSnippet);
		const timeoutPromise = new Promise<never>((_resolve, reject) => {
			setTimeout(() => reject(new Error('Ack message generation timed out')), ACK_TIMEOUT_MS);
		});

		const result = await Promise.race([llmPromise, timeoutPromise]);

		if (!result || !result.trim()) {
			return fallback;
		}

		return result.trim();
	} catch (err) {
		logger.warn('[Router] Ack message generation failed (using static fallback):', String(err));
		return fallback;
	} finally {
		restoreEnv?.();
	}
}

/**
 * Make the actual single-shot LLM call to generate an ack message.
 */
async function callAckModel(
	model: string,
	agentType: string,
	contextSnippet: string,
): Promise<string> {
	const client = new LLMist({ customModels: CUSTOM_MODELS as ModelSpec[] });
	const roleHint = AGENT_ROLE_HINTS[agentType] ?? 'Processes the request';
	const userPrompt = `Agent type: ${agentType}\nAgent role: ${roleHint}\n\nYour message MUST reflect the "${agentType}" agent's role: "${roleHint}". Use action language appropriate for this specific role.\n\nRequest context:\n${contextSnippet}`;

	const result = await client.text.complete(userPrompt, {
		model,
		temperature: 0,
		systemPrompt: ACK_SYSTEM_PROMPT,
	});

	return result.trim();
}
