import type { ProjectConfig } from '../types/index.js';

/**
 * Free-form labels accepted as-is from the agent.
 *
 * Originally typed as a closed union (8 categories × 4 severities). Loosened
 * on 2026-05-10 after prod run `ff6adf00` showed an agent recognizing a
 * textbook friction (CASCADE_ORG_ID env-var leak in tests) but failing to
 * file because oclif's enum gate rejected `--severity 'medium slowdown'`
 * (the agent took the describe text literally — the gadget describe was
 * `'Severity: low annoyance, medium slowdown, ...'`). The agent then crashed
 * trying to discover correct values via `node bin/cascade-tools.js --help`
 * because dist/ wasn't built in the workspace checkout, and gave up.
 *
 * Free-form for now lets the agent file any reasonable label. We can
 * cluster + re-tighten after a week of real usage data.
 */
export type FrictionCategory = string;

export type FrictionSeverity = string;

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
	pmType?: NonNullable<ProjectConfig['pm']>['type'];
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
