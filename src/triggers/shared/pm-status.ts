import type { AgentInput, TriggerResult } from '../../types/index.js';
import { resolveWorkflowStatusDefinition } from '../../workflow/statusDefinitions.js';
import { TRIGGER_EVENTS } from './events.js';
import { buildPMDispatchResult } from './result-builders.js';
import { STATUS_TO_AGENT } from './status-to-agent.js';

export interface ResolvedPMStatusAgent {
	agentType: string;
	cascadeStatus: string;
}

type StatusMatcher = (configuredStatus: string, incomingStatus: string) => boolean;

const exactStatusMatcher: StatusMatcher = (configuredStatus, incomingStatus) =>
	configuredStatus === incomingStatus;

const caseInsensitiveStatusMatcher: StatusMatcher = (configuredStatus, incomingStatus) =>
	configuredStatus.toLowerCase() === incomingStatus.toLowerCase();

export function shouldFirePMStatusEvent(
	isCreate: boolean,
	parameters: Record<string, unknown>,
): boolean {
	if (isCreate) return parameters.onCreate === true;
	return parameters.onMove !== false;
}

export function resolvePMStatusAgent(args: {
	incomingStatus: string;
	configuredStatuses: Record<string, string>;
	matcher?: StatusMatcher;
}): ResolvedPMStatusAgent | undefined {
	const matcher = args.matcher ?? exactStatusMatcher;

	for (const [cascadeStatus, configuredStatus] of Object.entries(args.configuredStatuses)) {
		if (matcher(configuredStatus, args.incomingStatus)) {
			const agentType = STATUS_TO_AGENT[cascadeStatus];
			if (agentType) return { agentType, cascadeStatus };
		}
	}

	return undefined;
}

export function resolvePMStatusAgentByName(args: {
	statusName: string;
	configuredStatuses: Record<string, string>;
}): ResolvedPMStatusAgent | undefined {
	return resolvePMStatusAgent({
		incomingStatus: args.statusName,
		configuredStatuses: args.configuredStatuses,
		matcher: caseInsensitiveStatusMatcher,
	});
}

export function resolvePMStatusAgentById(args: {
	statusId: string;
	configuredStatuses: Record<string, string>;
}): ResolvedPMStatusAgent | undefined {
	return resolvePMStatusAgent({
		incomingStatus: args.statusId,
		configuredStatuses: args.configuredStatuses,
		matcher: exactStatusMatcher,
	});
}

export async function resolvePMStatusAgentFromWorkflowDefinitions(args: {
	incomingStatus: string;
	configuredStatuses: Record<string, string>;
	matcher?: StatusMatcher;
}): Promise<ResolvedPMStatusAgent | undefined> {
	const matcher = args.matcher ?? exactStatusMatcher;

	for (const [cascadeStatus, configuredStatus] of Object.entries(args.configuredStatuses)) {
		if (matcher(configuredStatus, args.incomingStatus)) {
			const definition = await resolveWorkflowStatusDefinition(cascadeStatus);
			if (definition?.agentType) {
				return { agentType: definition.agentType, cascadeStatus };
			}
		}
	}

	return undefined;
}

export function resolvePMStatusAgentByIdFromWorkflowDefinitions(args: {
	statusId: string;
	configuredStatuses: Record<string, string>;
}): Promise<ResolvedPMStatusAgent | undefined> {
	return resolvePMStatusAgentFromWorkflowDefinitions({
		incomingStatus: args.statusId,
		configuredStatuses: args.configuredStatuses,
		matcher: exactStatusMatcher,
	});
}

export function resolvePMStatusAgentByNameFromWorkflowDefinitions(args: {
	statusName: string;
	configuredStatuses: Record<string, string>;
}): Promise<ResolvedPMStatusAgent | undefined> {
	return resolvePMStatusAgentFromWorkflowDefinitions({
		incomingStatus: args.statusName,
		configuredStatuses: args.configuredStatuses,
		matcher: caseInsensitiveStatusMatcher,
	});
}

/**
 * Resolve an agent from a configured-status map by matching on a
 * locale-invariant status ID first, falling back to a case-insensitive
 * status-name match (MNG-1768).
 *
 * JIRA status *names* are rendered in the language of whichever account
 * the webhook / credential is scoped to, so name-only matching silently
 * no-ops when the site language differs from the credential account's
 * language. Matching on the numeric status ID (`"10010"`) is locale-proof.
 * Name matching is retained as a fallback so existing name-based configs
 * keep dispatching untouched.
 *
 * There is no collision risk between the two branches: JIRA status IDs are
 * numeric strings while names are free text, so a configured value matches
 * at most one interpretation.
 *
 * Reuses `resolvePMStatusAgentFromWorkflowDefinitions` (via a closure
 * matcher) so the `resolveWorkflowStatusDefinition(cascadeStatus)` lookup —
 * and therefore custom workflow statuses plus the null-`agentType` guard —
 * keeps working unchanged.
 */
export function resolvePMStatusAgentByIdOrNameFromWorkflowDefinitions(args: {
	statusId?: string;
	statusName?: string;
	configuredStatuses: Record<string, string>;
}): Promise<ResolvedPMStatusAgent | undefined> {
	const { statusId, statusName } = args;
	const matcher: StatusMatcher = (configuredStatus) => {
		if (statusId && configuredStatus === statusId) return true;
		if (statusName && configuredStatus.toLowerCase() === statusName.toLowerCase()) return true;
		return false;
	};

	return resolvePMStatusAgentFromWorkflowDefinitions({
		// `incomingStatus` is unused by the closure matcher above (it captures
		// both id and name directly); pass the id when present for readable logs.
		incomingStatus: statusId ?? statusName ?? '',
		configuredStatuses: args.configuredStatuses,
		matcher,
	});
}

export function buildPMStatusCoalesceKey(projectId: string, workItemId: string): string {
	return `${projectId}:${workItemId}`;
}

export function buildPMStatusDispatchResult(args: {
	projectId: string;
	agentType: string;
	workItemId: string;
	workItemUrl?: string;
	workItemTitle?: string;
	agentInput?: AgentInput;
}): TriggerResult {
	return buildPMDispatchResult({
		agentType: args.agentType,
		triggerEvent: TRIGGER_EVENTS.PM.STATUS_CHANGED,
		workItemId: args.workItemId,
		workItemUrl: args.workItemUrl,
		workItemTitle: args.workItemTitle,
		agentInput: {
			workItemUrl: args.workItemUrl,
			workItemTitle: args.workItemTitle,
			...args.agentInput,
		},
		coalesceKey: buildPMStatusCoalesceKey(args.projectId, args.workItemId),
	});
}
