/**
 * Strategy Registries
 *
 * Contains registries for context pipeline steps and pre-execute hooks.
 *
 * Note: Tool set and gadget builder registries have been removed.
 * Tools and gadgets are now derived from capabilities via the capability registry.
 * See: src/agents/capabilities/registry.ts
 */

import type { ContextInjection } from '../contracts/index.js';
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
