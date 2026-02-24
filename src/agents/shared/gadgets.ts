import { AstGrep } from '../../gadgets/AstGrep.js';
import { FileMultiEdit } from '../../gadgets/FileMultiEdit.js';
import { FileSearchAndReplace } from '../../gadgets/FileSearchAndReplace.js';
import { Finish } from '../../gadgets/Finish.js';
import { ListDirectory } from '../../gadgets/ListDirectory.js';
import { ReadFile } from '../../gadgets/ReadFile.js';
import { RipGrep } from '../../gadgets/RipGrep.js';
import { Sleep } from '../../gadgets/Sleep.js';
import { VerifyChanges } from '../../gadgets/VerifyChanges.js';
import { WriteFile } from '../../gadgets/WriteFile.js';
import {
	CreatePR,
	CreatePRReview,
	GetPRChecks,
	GetPRComments,
	GetPRDetails,
	GetPRDiff,
	PostPRComment,
	ReplyToReviewComment,
	UpdatePRComment,
} from '../../gadgets/github/index.js';
import {
	AddChecklist,
	CreateWorkItem,
	ListWorkItems,
	PMDeleteChecklistItem,
	PMUpdateChecklistItem,
	PostComment,
	ReadWorkItem,
	UpdateWorkItem,
} from '../../gadgets/pm/index.js';
import { Tmux } from '../../gadgets/tmux.js';
import { TodoDelete, TodoUpdateStatus, TodoUpsert } from '../../gadgets/todo/index.js';
import type { CreateBuilderOptions } from './builderFactory.js';
import type { AgentCapabilities } from './capabilities.js';

/**
 * Build the standard set of gadgets for work-item-based agents.
 *
 * Used by both the llmist backend (agents/base.ts) and the Claude Code backend
 * (backends/agent-profiles.ts) to ensure identical gadget sets for matching
 * agent types regardless of which backend runs the agent.
 *
 * Applies capabilities to gate optional gadgets:
 * - canEditFiles: file writing tools (FileSearchAndReplace, FileMultiEdit, WriteFile, VerifyChanges)
 * - canCreatePR: CreatePR
 * - canUpdateChecklists: PMUpdateChecklistItem
 */
export function buildWorkItemGadgets(caps: AgentCapabilities): CreateBuilderOptions['gadgets'] {
	return [
		// Filesystem gadgets (read-only when canEditFiles is false)
		new ListDirectory(),
		new ReadFile(),
		new RipGrep(),
		new AstGrep(),
		...(caps.canEditFiles
			? [new FileSearchAndReplace(), new FileMultiEdit(), new WriteFile(), new VerifyChanges()]
			: []),
		// Shell commands via tmux (no timeout issues)
		new Tmux(),
		new Sleep(),
		// Task tracking gadgets
		new TodoUpsert(),
		new TodoUpdateStatus(),
		new TodoDelete(),
		// GitHub gadgets (PR creation gated by capability)
		...(caps.canCreatePR ? [new CreatePR()] : []),
		// PM gadgets (work items, comments, checklists — PM-agnostic)
		new ReadWorkItem(),
		new PostComment(),
		new UpdateWorkItem(),
		new CreateWorkItem(),
		new ListWorkItems(),
		new AddChecklist(),
		// UpdateChecklistItem gated by capability — prevents planning from marking items complete
		// prematurely, while respond-to-planning-comment CAN update them
		...(caps.canUpdateChecklists ? [new PMUpdateChecklistItem(), new PMDeleteChecklistItem()] : []),
		// Session control
		new Finish(),
	];
}

/**
 * Build gadgets for the review agent (read-only, PR-focused).
 *
 * Used by both backends — review agent sees PR details, diff, checks, and
 * can submit a review, but cannot modify files or create new PRs.
 */
export function buildReviewGadgets(): CreateBuilderOptions['gadgets'] {
	return [
		new ListDirectory(),
		new ReadFile(),
		new Tmux(),
		new Sleep(),
		new TodoUpsert(),
		new TodoUpdateStatus(),
		new TodoDelete(),
		new GetPRDetails(),
		new GetPRDiff(),
		new GetPRChecks(),
		new CreatePRReview(),
		new UpdatePRComment(),
		new Finish(),
	];
}

/**
 * Build gadgets for PR-modifying agents (respond-to-review, respond-to-ci,
 * respond-to-pr-comment).
 *
 * Includes file editing + GitHub tools but NOT CreatePR (agents push to
 * existing branches). Pass includeReviewComments=true for agents that need
 * GetPRComments and ReplyToReviewComment.
 *
 * Used by both backends to ensure identical tool sets.
 */
export function buildPRAgentGadgets(options?: {
	includeReviewComments?: boolean;
}): CreateBuilderOptions['gadgets'] {
	const gadgets: CreateBuilderOptions['gadgets'] = [
		new ListDirectory(),
		new ReadFile(),
		new FileSearchAndReplace(),
		new FileMultiEdit(),
		new WriteFile(),
		new VerifyChanges(),
		new AstGrep(),
		new RipGrep(),
		new Tmux(),
		new Sleep(),
		new TodoUpsert(),
		new TodoUpdateStatus(),
		new TodoDelete(),
		new GetPRDetails(),
		new GetPRDiff(),
		new GetPRChecks(),
		new PostPRComment(),
		new UpdatePRComment(),
		new Finish(),
	];

	if (options?.includeReviewComments) {
		gadgets.push(new GetPRComments(), new ReplyToReviewComment());
	}

	return gadgets;
}
