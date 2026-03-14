import type { z } from 'zod';
import type { CascadeConfigSchema, ProjectConfigSchema } from '../config/schema.js';
import type { PersonaIdentities } from '../github/personas.js';

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type CascadeConfig = z.infer<typeof CascadeConfigSchema>;

export interface AgentInput {
	workItemId?: string;
	prNumber?: number;
	repoDir?: string;

	// PR context fields for check-failure flow
	prBranch?: string;
	repoFullName?: string;
	headSha?: string;
	triggerType?:
		| 'check-failure'
		| 'feature-implementation'
		| 'ci-success'
		| 'review-requested'
		| 'pr-opened'
		| 'conflict-resolution'
		| 'manual';

	/** YAML-format trigger event name for context pipeline resolution (e.g. 'scm:check-suite-success') */
	triggerEvent?: string;

	// Debug agent fields
	logDir?: string;
	originalWorkItemId?: string;
	originalWorkItemName?: string;
	originalWorkItemUrl?: string;
	detectedAgentType?: string;

	// Trello comment trigger fields
	triggerCommentText?: string;
	triggerCommentAuthor?: string;

	// PR comment trigger fields (for respond-to-pr-comment and similar agents)
	triggerCommentBody?: string;
	triggerCommentPath?: string;

	// Interactive mode (local development)
	interactive?: boolean;
	// Auto-accept prompts in interactive mode
	autoAccept?: boolean;
	// Override the model for this agent run
	modelOverride?: string;

	// Router-posted ack comment ID — used by ProgressMonitor to update in-place
	ackCommentId?: string | number;
	// Router/webhook-handler-posted ack message text — reused as initial comment header
	ackMessage?: string;

	[key: string]: unknown;
}

export interface AgentResult {
	success: boolean;
	output: string;
	prUrl?: string;
	progressCommentId?: string;
	error?: string;
	logBuffer?: Buffer;
	cost?: number;
	runId?: string;
	durationMs?: number;
}

export type TriggerSource = string;

export interface TriggerContext {
	project: ProjectConfig;
	source: TriggerSource;
	payload: unknown;
	/** Resolved GitHub usernames for bot detection. Present for GitHub-sourced triggers. */
	personaIdentities?: PersonaIdentities;
}

export interface TriggerResult {
	agentType: string | null;
	agentInput: AgentInput;
	workItemId?: string;
	/** URL to the work item in the PM provider (e.g. Trello card URL, Jira issue URL). */
	workItemUrl?: string;
	/** Display title of the work item (e.g. Trello card name, Jira issue summary). */
	workItemTitle?: string;
	prNumber?: number;
	/** URL to the pull request (e.g. https://github.com/owner/repo/pull/123). */
	prUrl?: string;
	/** Display title of the pull request. */
	prTitle?: string;
	/** When true, the worker must poll for all CI checks to pass before starting the agent. */
	waitForChecks?: boolean;
	/** Called when the router cannot enqueue the job (work-item lock, concurrency limit).
	 *  Allows the trigger handler to undo side-effects like dedup marking. */
	onBlocked?: () => void;
}

export interface TriggerHandler {
	name: string;
	description: string;
	matches: (ctx: TriggerContext) => boolean;
	handle: (ctx: TriggerContext) => Promise<TriggerResult | null>;
}
