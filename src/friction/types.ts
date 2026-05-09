import type { ProjectConfig } from '../types/index.js';

export type FrictionCategory =
	| 'tooling'
	| 'environment'
	| 'permissions'
	| 'dependency'
	| 'test-failure'
	| 'pm-data'
	| 'scm-data'
	| 'other';

export type FrictionSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface FrictionReport {
	/** Stable id used for sidecar deduplication across queued/filed events. */
	reportId: string;
	summary: string;
	details: string;
	category: FrictionCategory;
	severity: FrictionSeverity;
	/** Short description of the task or operation in progress when friction occurred. */
	whileDoing: string;
	context: FrictionRuntimeContext;
	/** ISO-8601 timestamp. Formatting uses this when supplied, otherwise the materializer clock. */
	createdAt?: string;
}

export interface FrictionRuntimeContext {
	project: FrictionProjectContext;
	agent?: FrictionAgentContext;
	run?: FrictionRunContext;
	workItem?: FrictionWorkItemContext;
	pr?: FrictionPullRequestContext;
}

export interface FrictionProjectContext {
	id: string;
	name?: string;
	repo?: string;
	pmType?: ProjectConfig['pm']['type'];
}

export interface FrictionAgentContext {
	type: string;
	engine?: string;
	model?: string;
}

export interface FrictionRunContext {
	id?: string;
	url?: string;
	startedAt?: string;
}

export interface FrictionWorkItemContext {
	id?: string;
	title?: string;
	url?: string;
}

export interface FrictionPullRequestContext {
	number?: number;
	title?: string;
	url?: string;
	branch?: string;
	headSha?: string;
}

export interface FormattedFrictionReport {
	title: string;
	descriptionMarkdown: string;
}

export type FrictionMaterializationResult =
	| {
			status: 'filed';
			reportId: string;
			workItemId: string;
			workItemUrl?: string;
	  }
	| {
			status: 'skipped';
			reportId: string;
			reason: 'friction_slot_missing';
			message: string;
	  };

export interface FrictionQueuedEvent {
	event: 'queued';
	reportId: string;
	report: FrictionReport;
	timestamp: string;
}

export interface FrictionFiledEvent {
	event: 'filed';
	reportId: string;
	workItemId: string;
	workItemUrl?: string;
	timestamp: string;
}

export type FrictionSidecarEvent = FrictionQueuedEvent | FrictionFiledEvent;
