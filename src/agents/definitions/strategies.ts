import type { ContextInjection } from '../../backends/types.js';
import type { AgentCapabilities } from '../shared/capabilities.js';
import {
	buildEmailJokeGadgets,
	buildPRAgentGadgets,
	buildReviewGadgets,
	buildWorkItemGadgets,
} from '../shared/gadgets.js';
import {
	type FetchContextParams,
	type PreExecuteParams,
	fetchContextFilesStep,
	fetchDirectoryListingStep,
	fetchEmailsFromInputStep,
	fetchPRContextStep,
	fetchPRConversationStep,
	fetchSquintStep,
	fetchWorkItemStep,
	postInitialPRCommentHook,
} from './contextSteps.js';

// ============================================================================
// Tool Set Registry
// ============================================================================

/** PM tools available to most agents */
export const PM_TOOLS = [
	'ReadWorkItem',
	'PostComment',
	'UpdateWorkItem',
	'CreateWorkItem',
	'ListWorkItems',
	'AddChecklist',
];

/** PM checklist update — excluded from planning to prevent premature completion */
export const PM_CHECKLIST_TOOL = 'UpdateChecklistItem';

/** GitHub review tools for code review agents */
export const GITHUB_REVIEW_TOOLS = [
	'GetPRDetails',
	'GetPRDiff',
	'GetPRChecks',
	'GetPRComments',
	'PostPRComment',
	'UpdatePRComment',
	'ReplyToReviewComment',
	'CreatePRReview',
];

/** GitHub CI tools for respond-to-ci agent (no CreatePR — pushes to existing branch) */
export const GITHUB_CI_TOOLS = [
	'GetPRDetails',
	'GetPRDiff',
	'GetPRChecks',
	'PostPRComment',
	'UpdatePRComment',
];

/** Email tools for agents that need email access */
export const EMAIL_TOOLS = [
	'SendEmail',
	'SearchEmails',
	'ReadEmail',
	'ReplyToEmail',
	'MarkEmailAsSeen',
];

export const SESSION_TOOL = 'Finish';

export const ALL_SDK_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];
export const READ_ONLY_SDK_TOOLS = ['Read', 'Bash', 'Glob', 'Grep'];

/**
 * Maps YAML tool set names to the actual tool name arrays.
 */
export const TOOL_SET_REGISTRY: Record<string, string[]> = {
	pm: PM_TOOLS,
	pm_checklist: [PM_CHECKLIST_TOOL],
	session: [SESSION_TOOL],
	github_review: GITHUB_REVIEW_TOOLS,
	github_ci: GITHUB_CI_TOOLS,
	email: EMAIL_TOOLS,
	// 'all' is a sentinel — handled by returning allTools unfiltered
};

/**
 * Maps YAML sdkTools names to actual SDK tool arrays.
 */
export const SDK_TOOLS_REGISTRY: Record<string, string[]> = {
	all: ALL_SDK_TOOLS,
	readOnly: READ_ONLY_SDK_TOOLS,
};

// ============================================================================
// Context Pipeline Step Registry
// ============================================================================

export const CONTEXT_STEP_REGISTRY: Record<
	string,
	(params: FetchContextParams) => ContextInjection[] | Promise<ContextInjection[]>
> = {
	directoryListing: fetchDirectoryListingStep,
	contextFiles: fetchContextFilesStep,
	squint: fetchSquintStep,
	workItem: fetchWorkItemStep,
	prContext: fetchPRContextStep,
	prConversation: fetchPRConversationStep,
	prefetchedEmails: fetchEmailsFromInputStep,
};

// ============================================================================
// Pre-Execute Hook Registry
// ============================================================================

export const PRE_EXECUTE_REGISTRY: Record<
	string,
	(agentType: string, params: PreExecuteParams) => Promise<void>
> = {
	postInitialPRComment: postInitialPRCommentHook,
};

// ============================================================================
// Gadget Builder Registry
// ============================================================================

export const GADGET_BUILDER_REGISTRY: Record<
	string,
	(caps: AgentCapabilities, options?: { includeReviewComments?: boolean }) => unknown[]
> = {
	workItem: (caps) => buildWorkItemGadgets(caps),
	review: () => buildReviewGadgets(),
	prAgent: (_caps, options) => buildPRAgentGadgets(options),
	emailJoke: () => buildEmailJokeGadgets(),
};
