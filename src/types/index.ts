import type { z } from 'zod';
import type { CascadeConfigSchema, ProjectConfigSchema } from '../config/schema.js';
import type { PersonaIdentities } from '../github/personas.js';

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type CascadeConfig = z.infer<typeof CascadeConfigSchema>;

export interface AgentInput {
	cardId?: string;
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
		| 'manual';

	// Debug agent fields
	logDir?: string;
	originalCardId?: string;
	originalCardName?: string;
	originalCardUrl?: string;
	detectedAgentType?: string;

	// Trello comment trigger fields
	triggerCommentText?: string;
	triggerCommentAuthor?: string;

	// Interactive mode (local development)
	interactive?: boolean;
	// Auto-accept prompts in interactive mode
	autoAccept?: boolean;
	// Override the model for this agent run
	modelOverride?: string;

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

export type TriggerSource = 'trello' | 'github' | 'jira' | 'manual';

export interface TriggerContext {
	project: ProjectConfig;
	source: TriggerSource;
	payload: unknown;
	/** Resolved GitHub usernames for bot detection. Present for GitHub-sourced triggers. */
	personaIdentities?: PersonaIdentities;
}

export interface TriggerResult {
	agentType: string;
	agentInput: AgentInput;
	/** @deprecated Use workItemId instead */
	cardId?: string;
	/** Alias for cardId — preferred name for PM-agnostic code */
	workItemId?: string;
	prNumber?: number;
}

export interface TriggerHandler {
	name: string;
	description: string;
	matches: (ctx: TriggerContext) => boolean;
	handle: (ctx: TriggerContext) => Promise<TriggerResult | null>;
}
