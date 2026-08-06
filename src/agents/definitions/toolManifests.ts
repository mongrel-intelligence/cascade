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
	approveMRDef,
	createMRDef,
	createMRReviewDef,
	getFailedPipelineJobsDef,
	getMRDetailsDef,
	getMRDiffDef,
	getMRNotesDef,
	getPipelineStatusDef,
	mergeMRDef,
	postMRNoteDef,
	updateMRNoteDef,
} from '../../gadgets/gitlab/definitions.js';
import {
	addChecklistDef,
	createWorkItemDef,
	listWorkItemsDef,
	moveWorkItemDef,
	pmDeleteChecklistItemDef,
	pmUpdateChecklistItemDef,
	postCommentDef,
	readWorkItemDef,
	reportFrictionDef,
	updateWorkItemDef,
} from '../../gadgets/pm/definitions.js';
import { finishDef } from '../../gadgets/session/definitions.js';
import { generateToolManifest } from '../../gadgets/shared/manifestGenerator.js';
import type { ToolDefinition } from '../../gadgets/shared/toolDefinition.js';
import type { ToolManifest } from '../contracts/index.js';

/** PM tool definitions (shared across all SCM providers). */
const PM_DEFINITIONS: ToolDefinition[] = [
	readWorkItemDef,
	postCommentDef,
	updateWorkItemDef,
	createWorkItemDef,
	reportFrictionDef,
	listWorkItemsDef,
	addChecklistDef,
	moveWorkItemDef,
	pmUpdateChecklistItemDef,
	pmDeleteChecklistItemDef,
];

/** GitHub SCM tool definitions. */
const GITHUB_SCM_DEFINITIONS: ToolDefinition[] = [
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
];

/** GitLab SCM tool definitions. */
const GITLAB_SCM_DEFINITIONS: ToolDefinition[] = [
	createMRDef,
	getMRDetailsDef,
	getMRDiffDef,
	getMRNotesDef,
	postMRNoteDef,
	updateMRNoteDef,
	createMRReviewDef,
	approveMRDef,
	getPipelineStatusDef,
	getFailedPipelineJobsDef,
	mergeMRDef,
];

/** Session tool definitions. */
const SESSION_DEFINITIONS: ToolDefinition[] = [finishDef];

/**
 * Get the CLI tool manifests for CASCADE-specific tools.
 * Selects GitHub or GitLab SCM tools based on CASCADE_SCM_PROVIDER env var.
 */
export function getToolManifests(): ToolManifest[] {
	const scmProvider = process.env.CASCADE_SCM_PROVIDER;
	const scmDefs = scmProvider === 'gitlab' ? GITLAB_SCM_DEFINITIONS : GITHUB_SCM_DEFINITIONS;
	const allDefs = [...PM_DEFINITIONS, ...scmDefs, ...SESSION_DEFINITIONS];
	return allDefs.map((def) => generateToolManifest(def));
}
