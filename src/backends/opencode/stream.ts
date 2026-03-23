/**
 * Stream event handling for OpenCode engine runs.
 *
 * Processes the SSE event stream from the OpenCode server, dispatching
 * permission requests, session lifecycle events, and message part updates.
 */

import type { createOpencodeClient } from '@opencode-ai/sdk/client';
import type { Event, Part, ToolPart } from '@opencode-ai/sdk/client';

import { retryNativeToolOperation } from '../nativeToolRetry.js';
import { appendEngineLog } from '../shared/engineLog.js';
import { logLlmCall } from '../shared/llmCallLogger.js';
import type { AgentExecutionPlan } from '../types.js';
import {
	type OpenCodePermissionConfig,
	normalizePermissionDecision,
	resolvePermissionDecision,
} from './permissions.js';

export interface OpenCodeStreamState {
	sessionId: string;
	model: string;
	input: AgentExecutionPlan;
	permissionConfig: OpenCodePermissionConfig;
	reportedToolCalls: Set<string>;
	seenTextPartIds: Set<string>;
	iterationCount: number;
	llmCallCount: number;
	totalCost: number;
	partialOutput: string[];
	toolCallCount: number;
	finalError?: string;
	idleResolver?: () => void;
	idleRejecter?: (error: Error) => void;
}

type EventPayload = Event;

export function appendPartialOutput(state: OpenCodeStreamState, text: string): void {
	const trimmed = text.trim();
	if (!trimmed) return;
	state.partialOutput.push(trimmed);
}

export function getPartialOutput(state: OpenCodeStreamState | undefined): string {
	if (!state) return '';
	return state.partialOutput.join('\n').trim();
}

function getPartDelta(part: Part, delta?: string): string | undefined {
	if (delta) return delta;
	if (part.type !== 'text' || part.synthetic || part.ignored) return undefined;
	return part.text;
}

export function reportToolPart(
	input: AgentExecutionPlan,
	part: ToolPart,
	reportedToolCalls: Set<string>,
): void {
	if (reportedToolCalls.has(part.callID)) return;
	if (part.state.status === 'pending') return;
	reportedToolCalls.add(part.callID);
	input.progressReporter.onToolCall(part.tool, part.state.input);
}

export function storeUsage(
	input: AgentExecutionPlan,
	model: string,
	llmCallCount: number,
	part: Extract<Part, { type: 'step-finish' }>,
): void {
	logLlmCall({
		runId: input.runId,
		callNumber: llmCallCount,
		model,
		inputTokens: part.tokens.input,
		outputTokens: part.tokens.output,
		cachedTokens: part.tokens.cache.read,
		costUsd: part.cost,
		response: JSON.stringify(part),
		engineLabel: 'OpenCode',
	});
}

export async function handlePermissionEvent(
	client: ReturnType<typeof createOpencodeClient>,
	event: Extract<EventPayload, { type: 'permission.updated' }>,
	state: OpenCodeStreamState,
): Promise<boolean> {
	if (event.properties.sessionID !== state.sessionId) return false;
	const decision = resolvePermissionDecision(event.properties, state.permissionConfig);
	await retryNativeToolOperation(
		() =>
			client.postSessionIdPermissionsPermissionId({
				path: { id: state.sessionId, permissionID: event.properties.id },
				body: { response: normalizePermissionDecision(decision) },
				throwOnError: true,
			}),
		{
			logWriter: state.input.logWriter,
			operation: 'opencode.permission.respond',
		},
	);
	return true;
}

export function handleSessionTerminalEvent(
	event: EventPayload,
	state: OpenCodeStreamState,
): boolean {
	if (
		event.type === 'session.error' &&
		(!event.properties.sessionID || event.properties.sessionID === state.sessionId)
	) {
		state.finalError =
			typeof event.properties.error?.data?.message === 'string'
				? event.properties.error.data.message
				: event.properties.error?.name;
		state.idleRejecter?.(new Error(state.finalError ?? 'OpenCode session error'));
		return true;
	}

	if (event.type === 'session.idle' && event.properties.sessionID === state.sessionId) {
		state.idleResolver?.();
		return true;
	}

	if (
		event.type === 'session.status' &&
		event.properties.sessionID === state.sessionId &&
		event.properties.status.type === 'idle'
	) {
		state.idleResolver?.();
		return true;
	}

	return false;
}

export async function handleMessagePartUpdated(
	event: Extract<EventPayload, { type: 'message.part.updated' }>,
	state: OpenCodeStreamState,
): Promise<void> {
	if (event.properties.part.sessionID !== state.sessionId) return;

	const part = event.properties.part;
	if (part.type === 'step-start') {
		state.iterationCount += 1;
		await state.input.progressReporter.onIteration(state.iterationCount, state.input.maxIterations);
		return;
	}

	if (part.type === 'step-finish') {
		state.llmCallCount += 1;
		state.totalCost += part.cost;
		storeUsage(state.input, state.model, state.llmCallCount, part);
		return;
	}

	if (part.type === 'tool') {
		state.toolCallCount += 1;
		reportToolPart(state.input, part, state.reportedToolCalls);
		return;
	}

	const textDelta = getPartDelta(part, event.properties.delta);
	if (!textDelta) return;
	if (!event.properties.delta && state.seenTextPartIds.has(part.id)) return;
	state.seenTextPartIds.add(part.id);
	appendPartialOutput(state, textDelta);
	state.input.logWriter('INFO', 'OpenCode text', {
		text: textDelta.length > 300 ? `${textDelta.slice(0, 300)}...` : textDelta,
	});
	state.input.progressReporter.onText(textDelta);
}

export async function processStreamEvent(
	client: ReturnType<typeof createOpencodeClient>,
	event: EventPayload,
	state: OpenCodeStreamState,
): Promise<void> {
	appendEngineLog(state.input.engineLogPath, `${JSON.stringify(event)}\n`);
	if (!event || !('type' in event)) return;
	if (event.type === 'permission.updated' && (await handlePermissionEvent(client, event, state))) {
		return;
	}
	if (handleSessionTerminalEvent(event, state)) return;
	if (event.type === 'message.part.updated') {
		await handleMessagePartUpdated(event, state);
	}
}
