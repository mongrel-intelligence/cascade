import type { AgentInput, TriggerResult } from '../../types/index.js';
import { TRIGGER_EVENTS } from './events.js';
import { resolvePMStatusAgentById, resolvePMStatusAgentByName } from './pm-status.js';
import { buildPMDispatchResult } from './result-builders.js';

export function resolvePMLabelAgentByList(args: {
	currentListId: string;
	lists: Partial<Record<'splitting' | 'planning' | 'todo', string>>;
}): string | undefined {
	if (args.currentListId === args.lists.splitting) return 'splitting';
	if (args.currentListId === args.lists.planning) return 'planning';
	if (args.currentListId === args.lists.todo) return 'implementation';
	return undefined;
}

export function resolvePMLabelAgentByStatusName(args: {
	statusName: string;
	configuredStatuses: Record<string, string>;
}): string | undefined {
	return resolvePMStatusAgentByName({
		statusName: args.statusName,
		configuredStatuses: args.configuredStatuses,
	})?.agentType;
}

export function resolvePMLabelAgentByStatusId(args: {
	statusId: string;
	configuredStatuses: Record<string, string>;
}): { agentType: string; cascadeStatus: string } | undefined {
	return resolvePMStatusAgentById({
		statusId: args.statusId,
		configuredStatuses: args.configuredStatuses,
	});
}

export function buildPMLabelDispatchResult(args: {
	agentType: string;
	workItemId: string;
	workItemUrl?: string;
	workItemTitle?: string;
	agentInput?: AgentInput;
}): TriggerResult {
	return buildPMDispatchResult({
		agentType: args.agentType,
		triggerEvent: TRIGGER_EVENTS.PM.LABEL_ADDED,
		workItemId: args.workItemId,
		workItemUrl: args.workItemUrl,
		workItemTitle: args.workItemTitle,
		agentInput: {
			workItemUrl: args.workItemUrl,
			workItemTitle: args.workItemTitle,
			...args.agentInput,
		},
	});
}
