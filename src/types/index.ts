import type { z } from 'zod';
import type { CascadeConfigSchema, ProjectConfigSchema } from '../config/schema.js';

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type CascadeConfig = z.infer<typeof CascadeConfigSchema>;

export interface AgentInput {
	cardId?: string;
	prNumber?: number;
	repoDir?: string;
	[key: string]: unknown;
}

export interface AgentResult {
	success: boolean;
	output: string;
	prUrl?: string;
	error?: string;
	logBuffer?: Buffer;
	cost?: number;
}

export type TriggerSource = 'trello' | 'github' | 'manual';

export interface TriggerContext {
	project: ProjectConfig;
	source: TriggerSource;
	payload: unknown;
}

export interface TriggerResult {
	agentType: string;
	agentInput: AgentInput;
	cardId?: string;
	prNumber?: number;
}

export interface TriggerHandler {
	name: string;
	description: string;
	matches: (ctx: TriggerContext) => boolean;
	handle: (ctx: TriggerContext) => Promise<TriggerResult>;
}
