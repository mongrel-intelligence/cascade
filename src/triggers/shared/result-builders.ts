import type { AgentInput, TriggerResult } from '../../types/index.js';
import type { CanonicalTriggerEvent, PMTriggerEvent, SCMTriggerEvent } from './events.js';

type AgentType = Exclude<TriggerResult['agentType'], null>;

interface BaseDispatchOptions {
	agentType: AgentType;
	agentInput?: AgentInput;
	workItemId?: string;
	workItemUrl?: string;
	workItemTitle?: string;
	onBlocked?: TriggerResult['onBlocked'];
	coalesceKey?: string;
}

interface PMDispatchOptions extends BaseDispatchOptions {
	triggerEvent: PMTriggerEvent;
	workItemId: string;
}

interface GitHubPRDispatchOptions extends BaseDispatchOptions {
	triggerEvent: SCMTriggerEvent;
	prNumber: number;
	prUrl?: string;
	prTitle?: string;
}

interface NoAgentOptions {
	agentInput?: AgentInput;
	workItemId?: string;
	workItemUrl?: string;
	workItemTitle?: string;
	prNumber?: number;
	prUrl?: string;
	prTitle?: string;
	lockKey?: string;
	coalesceKey?: string;
}

interface DeferredRecheckOptions {
	delayMs: number;
	coalesceKey: string;
	agentInput?: AgentInput;
}

function buildAgentInput(
	agentInput: AgentInput | undefined,
	triggerEvent: CanonicalTriggerEvent,
	workItemId: string | undefined,
): AgentInput {
	return {
		...agentInput,
		triggerEvent,
		...(workItemId ? { workItemId } : {}),
	};
}

export function buildPMDispatchResult(options: PMDispatchOptions): TriggerResult {
	const {
		agentType,
		agentInput,
		triggerEvent,
		workItemId,
		workItemUrl,
		workItemTitle,
		onBlocked,
		coalesceKey,
	} = options;

	return {
		agentType,
		agentInput: buildAgentInput(agentInput, triggerEvent, workItemId),
		workItemId,
		workItemUrl,
		workItemTitle,
		onBlocked,
		coalesceKey,
	};
}

export function buildGitHubPRDispatchResult(options: GitHubPRDispatchOptions): TriggerResult {
	const {
		agentType,
		agentInput,
		triggerEvent,
		workItemId,
		workItemUrl,
		workItemTitle,
		prNumber,
		prUrl,
		prTitle,
		onBlocked,
		coalesceKey,
	} = options;

	return {
		agentType,
		agentInput: buildAgentInput(agentInput, triggerEvent, workItemId),
		prNumber,
		prUrl,
		prTitle,
		workItemId,
		workItemUrl,
		workItemTitle,
		onBlocked,
		coalesceKey,
	};
}

export function buildSkipResult(handler: string, message: string): TriggerResult {
	return {
		agentType: null,
		agentInput: {},
		skipReason: { handler, message },
	};
}

export function buildNoAgentResult(options: NoAgentOptions = {}): TriggerResult {
	return {
		agentType: null,
		agentInput: options.agentInput ?? {},
		...(options.workItemId ? { workItemId: options.workItemId } : {}),
		...(options.workItemUrl ? { workItemUrl: options.workItemUrl } : {}),
		...(options.workItemTitle ? { workItemTitle: options.workItemTitle } : {}),
		...(options.prNumber ? { prNumber: options.prNumber } : {}),
		...(options.prUrl ? { prUrl: options.prUrl } : {}),
		...(options.prTitle ? { prTitle: options.prTitle } : {}),
		...(options.lockKey ? { lockKey: options.lockKey } : {}),
		...(options.coalesceKey ? { coalesceKey: options.coalesceKey } : {}),
	};
}

export function buildDeferredRecheckResult(options: DeferredRecheckOptions): TriggerResult {
	return {
		agentType: null,
		agentInput: options.agentInput ?? {},
		deferredRecheck: {
			delayMs: options.delayMs,
			coalesceKey: options.coalesceKey,
		},
	};
}
