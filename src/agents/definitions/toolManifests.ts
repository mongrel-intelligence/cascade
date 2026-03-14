import {
	createPRDef,
	createPRReviewDef,
	getCIRunLogsDef,
	getPRChecksDef,
	getPRCommentsDef,
	getPRDetailsDef,
	getPRDiffDef,
	postPRCommentDef,
	replyToReviewCommentDef,
	updatePRCommentDef,
} from '../../gadgets/github/definitions.js';
import {
	addChecklistDef,
	createWorkItemDef,
	listWorkItemsDef,
	moveWorkItemDef,
	pmDeleteChecklistItemDef,
	pmUpdateChecklistItemDef,
	postCommentDef,
	readWorkItemDef,
	updateWorkItemDef,
} from '../../gadgets/pm/definitions.js';
import { finishDef } from '../../gadgets/session/definitions.js';
import { generateToolManifest } from '../../gadgets/shared/manifestGenerator.js';
import type { ToolManifest } from '../contracts/index.js';

/**
 * All tool definitions in display order.
 * PM tools → SCM tools → Session tools.
 */
const ALL_DEFINITIONS = [
	// PM tools
	readWorkItemDef,
	postCommentDef,
	updateWorkItemDef,
	createWorkItemDef,
	listWorkItemsDef,
	addChecklistDef,
	moveWorkItemDef,
	pmUpdateChecklistItemDef,
	pmDeleteChecklistItemDef,
	// SCM tools
	createPRDef,
	getPRDetailsDef,
	getPRDiffDef,
	getPRChecksDef,
	getPRCommentsDef,
	postPRCommentDef,
	updatePRCommentDef,
	replyToReviewCommentDef,
	createPRReviewDef,
	getCIRunLogsDef,
	// Session tools
	finishDef,
];

/**
 * Get the CLI tool manifests for CASCADE-specific tools.
 * These describe the tools available via cascade-tools CLI.
 */
export function getToolManifests(): ToolManifest[] {
	return ALL_DEFINITIONS.map((def) => generateToolManifest(def));
}
