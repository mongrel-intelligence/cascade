/**
 * Strategy Registries
 *
 * Contains registries for context pipeline steps.
 *
 * Note: Tool set and gadget builder registries have been removed.
 * Tools and gadgets are now derived from capabilities via the capability registry.
 * See: src/agents/capabilities/registry.ts
 */

import type { ContextInjection } from '../contracts/index.js';
import {
	type FetchContextParams,
	fetchAlertingIssueStep,
	fetchContextFilesStep,
	fetchDirectoryListingStep,
	fetchPipelineSnapshotStep,
	fetchPRContextStep,
	fetchPRConversationStep,
	fetchSquintStep,
	fetchWorkItemStep,
	prepopulateTodosStep,
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
	prepopulateTodos: prepopulateTodosStep,
	prContext: fetchPRContextStep,
	prConversation: fetchPRConversationStep,
	pipelineSnapshot: fetchPipelineSnapshotStep,
	alertingIssue: fetchAlertingIssueStep,
};
