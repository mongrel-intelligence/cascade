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

interface AgentInputExtraContext {
	workItemUrl?: string;
	workItemTitle?: string;
	prUrl?: string;
	prTitle?: string;
}

function buildAgentInput(
	agentInput: AgentInput | undefined,
	triggerEvent: CanonicalTriggerEvent,
	workItemId: string | undefined,
	prNumber?: number,
	extraContext?: AgentInputExtraContext,
): AgentInput {
	return {
		...agentInput,
		triggerEvent,
		...(workItemId ? { workItemId } : {}),
		...(prNumber !== undefined ? { prNumber } : {}),
		// Mirror URL/title fields into agentInput so injectAgentInputContext
		// can inject them as CASCADE_WORK_ITEM_URL/TITLE/CASCADE_PR_URL/TITLE
		// env vars into the subprocess. Without this, webhook-triggered native-tool
		// runs receive IDs but miss the URL/title context.
		...(extraContext?.workItemUrl ? { workItemUrl: extraContext.workItemUrl } : {}),
		...(extraContext?.workItemTitle ? { workItemTitle: extraContext.workItemTitle } : {}),
		...(extraContext?.prUrl ? { prUrl: extraContext.prUrl } : {}),
		...(extraContext?.prTitle ? { prTitle: extraContext.prTitle } : {}),
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
		agentInput: buildAgentInput(agentInput, triggerEvent, workItemId, undefined, {
			workItemUrl,
			workItemTitle,
		}),
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
		agentInput: buildAgentInput(agentInput, triggerEvent, workItemId, prNumber, {
			workItemUrl,
			workItemTitle,
			prUrl,
			prTitle,
		}),
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
