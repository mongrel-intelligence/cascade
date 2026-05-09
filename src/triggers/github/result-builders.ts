import type { TriggerResult } from '../../types/index.js';
import { TRIGGER_EVENTS } from '../shared/events.js';
import { buildGitHubPRDispatchResult } from '../shared/result-builders.js';
import type { PRDetails } from './respond-to-ci-dispatch.js';

interface GitHubPRResultBase {
	prNumber: number;
	prDetails: PRDetails;
	repoFullName: string;
	headSha: string;
	workItemId?: string;
	workItemUrl?: string;
	workItemTitle?: string;
}

export function buildRespondToCiResult(options: GitHubPRResultBase): TriggerResult {
	return buildGitHubPRDispatchResult({
		agentType: 'respond-to-ci',
		triggerEvent: TRIGGER_EVENTS.SCM.CHECK_SUITE_FAILURE,
		prNumber: options.prNumber,
		prUrl: options.prDetails.htmlUrl,
		prTitle: options.prDetails.title,
		workItemId: options.workItemId,
		workItemUrl: options.workItemUrl,
		workItemTitle: options.workItemTitle,
		agentInput: {
			prBranch: options.prDetails.headRef,
			repoFullName: options.repoFullName,
			headSha: options.headSha,
			triggerType: 'check-failure',
		},
	});
}

export function buildReviewResult(
	options: GitHubPRResultBase & { onBlocked: TriggerResult['onBlocked'] },
): TriggerResult {
	return buildGitHubPRDispatchResult({
		agentType: 'review',
		triggerEvent: TRIGGER_EVENTS.SCM.CHECK_SUITE_SUCCESS,
		prNumber: options.prNumber,
		prUrl: options.prDetails.htmlUrl,
		prTitle: options.prDetails.title,
		workItemId: options.workItemId,
		workItemUrl: options.workItemUrl,
		workItemTitle: options.workItemTitle,
		onBlocked: options.onBlocked,
		agentInput: {
			prBranch: options.prDetails.headRef,
			repoFullName: options.repoFullName,
			headSha: options.headSha,
			triggerType: 'ci-success',
		},
	});
}

export function buildResolveConflictsResult(options: GitHubPRResultBase): TriggerResult {
	return buildGitHubPRDispatchResult({
		agentType: 'resolve-conflicts',
		triggerEvent: TRIGGER_EVENTS.SCM.PR_CONFLICT_DETECTED,
		prNumber: options.prNumber,
		prUrl: options.prDetails.htmlUrl,
		prTitle: options.prDetails.title,
		workItemId: options.workItemId,
		agentInput: {
			prBranch: options.prDetails.headRef,
			repoFullName: options.repoFullName,
			headSha: options.headSha,
			triggerType: 'conflict-resolution',
		},
	});
}
