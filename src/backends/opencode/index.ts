import { createOpencodeClient } from '@opencode-ai/sdk/client';
import type { AssistantMessage, Config, Part } from '@opencode-ai/sdk/client';

import { logger } from '../../utils/logging.js';
import { OPENCODE_ENGINE_DEFINITION } from '../catalog.js';
import {
	formatNativeToolTransportError,
	isRetryableNativeToolError,
	retryNativeToolOperation,
} from '../nativeToolRetry.js';
import { cleanupContextFiles } from '../shared/contextFiles.js';
import { runContinuationLoop } from '../shared/continuationLoop.js';
import { buildEngineResult, extractAndBuildPrEvidence } from '../shared/engineResult.js';
import { buildSystemPrompt, buildTaskPrompt } from '../shared/nativeToolPrompts.js';
import type { AgentEngine, AgentEngineResult, AgentExecutionPlan } from '../types.js';
import { DEFAULT_OPENCODE_MODEL } from './models.js';
import { buildPermissionConfig } from './permissions.js';
import {
	type OpenCodeServerState,
	attachServerState,
	formatOpenCodeServerExitError,
	startOpenCodeServer,
} from './server.js';
import { OpenCodeSettingsSchema, resolveOpenCodeSettings } from './settings.js';
import { type OpenCodeStreamState, getPartialOutput, processStreamEvent } from './stream.js';

export function resolveOpenCodeModel(cascadeModel: string): string {
	if (cascadeModel.includes('/') && !cascadeModel.includes(':')) return cascadeModel;

	if (cascadeModel.includes(':')) {
		const [provider, ...rest] = cascadeModel.split(':');
		if (provider && rest.length > 0) {
			return `${provider}/${rest.join(':')}`;
		}
	}

	logger.warn('Unsupported model configured for OpenCode engine, falling back to default', {
		configured: cascadeModel,
		fallback: DEFAULT_OPENCODE_MODEL,
	});
	return DEFAULT_OPENCODE_MODEL;
}

// Re-export for backward compatibility (tests import buildPermissionConfig from index.ts)
export { buildPermissionConfig } from './permissions.js';

function buildConfig(
	input: AgentExecutionPlan,
	model: string,
	settings: ReturnType<typeof resolveOpenCodeSettings>,
): Config {
	const permission = buildPermissionConfig(input.nativeToolCapabilities, settings.webSearch);

	return {
		model,
		share: 'disabled',
		autoupdate: false,
		instructions: [],
		permission,
		agent: {
			build: {
				maxSteps: input.maxIterations,
				permission,
			},
			plan: {
				maxSteps: input.maxIterations,
				permission,
			},
		},
	};
}

function buildPromptParts(taskPrompt: string): Array<{ type: 'text'; text: string }> {
	return [{ type: 'text', text: taskPrompt }];
}

function getTextOutput(parts: Part[]): string {
	return parts
		.filter((part): part is Extract<Part, { type: 'text' }> => part.type === 'text')
		.filter((part) => !part.synthetic && !part.ignored)
		.map((part) => part.text)
		.join('')
		.trim();
}

async function cleanupSession(
	client: ReturnType<typeof createOpencodeClient>,
	sessionId: string,
): Promise<void> {
	try {
		await client.session.delete({
			path: { id: sessionId },
			throwOnError: true,
		});
	} catch {
		// Best-effort cleanup
	}
}

interface OpenCodeTurnResult {
	result: AgentEngineResult;
	usedStreamedStateFallback: boolean;
}

function buildOpenCodeResultFromState(
	input: AgentExecutionPlan,
	state: OpenCodeStreamState,
): OpenCodeTurnResult {
	const output = getPartialOutput(state);
	const { prUrl, prEvidence } = extractAndBuildPrEvidence(output);

	if (state.finalError) {
		return {
			result: buildEngineResult({
				success: false,
				output,
				cost: state.totalCost || undefined,
				prUrl,
				prEvidence,
				error: state.finalError,
			}),
			usedStreamedStateFallback: true,
		};
	}

	input.logWriter('INFO', 'OpenCode execution completed from streamed state', {
		turns: state.iterationCount,
		cost: state.totalCost || null,
		prUrl: prUrl ?? null,
	});

	return {
		result: buildEngineResult({
			success: true,
			output,
			cost: state.totalCost || undefined,
			prUrl,
			prEvidence,
		}),
		usedStreamedStateFallback: true,
	};
}

async function promptOpenCodeSession(
	client: ReturnType<typeof createOpencodeClient>,
	sessionId: string,
	agent: 'build' | 'plan',
	input: AgentExecutionPlan,
	promptText: string,
	state: OpenCodeStreamState,
): Promise<
	| {
			parts: Part[];
			info: AssistantMessage;
	  }
	| undefined
> {
	try {
		const promptResult = await retryNativeToolOperation(
			() =>
				client.session.prompt({
					path: { id: sessionId },
					body: {
						agent,
						system: buildSystemPrompt(input.systemPrompt, input.availableTools),
						parts: buildPromptParts(promptText),
					},
					throwOnError: true,
				}),
			{
				logWriter: input.logWriter,
				operation: 'opencode.session.prompt',
				isRetryable: (error) =>
					isRetryableNativeToolError(error) && getPartialOutput(state).length === 0,
			},
		);
		const response = promptResult.data;
		if (!response) {
			throw new Error('OpenCode did not return a prompt response payload');
		}
		return {
			parts: response.parts,
			info: response.info as AssistantMessage,
		};
	} catch (error) {
		if (!(isRetryableNativeToolError(error) && getPartialOutput(state).length > 0)) {
			throw error;
		}
		input.logWriter('WARN', 'OpenCode prompt response lost after stream output began', {
			error: error instanceof Error ? error.message : String(error),
			sessionId,
		});
		return undefined;
	}
}

function createIdlePromise(state: OpenCodeStreamState): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		state.idleResolver = resolve;
		state.idleRejecter = reject;
	});
}

function buildOpenCodeResultFromResponse(
	input: AgentExecutionPlan,
	state: OpenCodeStreamState,
	response: { parts: Part[]; info: AssistantMessage },
): OpenCodeTurnResult {
	const output = getTextOutput(response.parts) || getPartialOutput(state);
	const assistant = response.info;
	const { prUrl, prEvidence } = extractAndBuildPrEvidence(output);

	if (assistant.error || state.finalError) {
		return {
			result: buildEngineResult({
				success: false,
				output,
				cost: state.totalCost || assistant.cost || undefined,
				prUrl,
				prEvidence,
				error:
					state.finalError ??
					(typeof assistant.error?.data?.message === 'string'
						? assistant.error.data.message
						: assistant.error?.name),
			}),
			usedStreamedStateFallback: false,
		};
	}

	input.logWriter('INFO', 'OpenCode execution completed', {
		turns: state.iterationCount,
		cost: state.totalCost || assistant.cost || null,
		prUrl: prUrl ?? null,
	});

	return {
		result: buildEngineResult({
			success: true,
			output,
			cost: state.totalCost || assistant.cost || undefined,
			prUrl,
			prEvidence,
		}),
		usedStreamedStateFallback: false,
	};
}

function buildOpenCodeTurnResult(
	input: AgentExecutionPlan,
	state: OpenCodeStreamState,
	promptResponse:
		| {
				parts: Part[];
				info: AssistantMessage;
		  }
		| undefined,
): OpenCodeTurnResult {
	return promptResponse
		? buildOpenCodeResultFromResponse(input, state, promptResponse)
		: buildOpenCodeResultFromState(input, state);
}

async function createOpenCodeSession(
	client: ReturnType<typeof createOpencodeClient>,
	input: AgentExecutionPlan,
): Promise<string> {
	const sessionResult = await retryNativeToolOperation(
		() =>
			client.session.create({
				body: { title: `CASCADE ${input.agentType}` },
				throwOnError: true,
			}),
		{
			logWriter: input.logWriter,
			operation: 'opencode.session.create',
		},
	);
	const session = sessionResult.data;
	if (!session) {
		throw new Error('OpenCode did not return a session payload');
	}
	return session.id;
}

function createOpenCodeStreamState(
	input: AgentExecutionPlan,
	model: string,
	webSearch: boolean,
	sessionId: string,
): OpenCodeStreamState {
	return {
		sessionId,
		model,
		input,
		permissionConfig: buildPermissionConfig(input.nativeToolCapabilities, webSearch),
		reportedToolCalls: new Set<string>(),
		seenTextPartIds: new Set<string>(),
		iterationCount: 0,
		llmCallCount: 0,
		totalCost: 0,
		partialOutput: [],
		toolCallCount: 0,
	};
}

function logOpenCodeStart(
	input: AgentExecutionPlan,
	model: string,
	agent: 'build' | 'plan',
	webSearch: boolean,
	hasOffloadedContext: boolean,
): void {
	input.logWriter('INFO', 'Starting OpenCode execution', {
		agentType: input.agentType,
		model,
		opencodeAgent: agent,
		repoDir: input.repoDir,
		maxIterations: input.maxIterations,
		webSearch,
		hasOffloadedContext,
	});
}

async function runOpenCodeTurnLoop(
	client: ReturnType<typeof createOpencodeClient>,
	sessionId: string,
	agent: 'build' | 'plan',
	input: AgentExecutionPlan,
	initialPrompt: string,
	state: OpenCodeStreamState,
): Promise<AgentEngineResult> {
	return runContinuationLoop({
		initialPrompt,
		completionRequirements: input.completionRequirements,
		logWriter: input.logWriter,
		engineLabel: 'OpenCode',
		executeTurn: async ({ promptText }) => {
			// Snapshot cost before this turn so we can compute a per-turn delta.
			// state.totalCost is a cumulative running total across all turns (it
			// is never reset between continuation turns), so we must subtract the
			// pre-turn value to avoid double-counting when the shared loop
			// accumulates cost on its own side.
			const costBeforeTurn = state.totalCost;

			const eventAbort = new AbortController();
			const eventStream = await retryNativeToolOperation(
				() =>
					client.event.subscribe({
						signal: eventAbort.signal,
					}),
				{
					logWriter: input.logWriter,
					operation: 'opencode.event.subscribe',
				},
			);

			const streamTask = (async () => {
				try {
					for await (const event of eventStream.stream) {
						await processStreamEvent(client, event, state);
					}
				} catch (error) {
					if (eventAbort.signal.aborted) return;
					state.idleRejecter?.(error instanceof Error ? error : new Error(String(error)));
				}
			})();

			try {
				const idlePromise = createIdlePromise(state);
				const promptResponse = await promptOpenCodeSession(
					client,
					sessionId,
					agent,
					input,
					promptText,
					state,
				);

				await idlePromise;

				const { result: turnResult } = buildOpenCodeTurnResult(input, state, promptResponse);
				// Compute per-turn cost delta so the shared loop accumulates correctly.
				// state.totalCost is a cumulative running total across ALL continuation
				// turns (accumulated via step-finish stream events and never reset between
				// turns). If we returned the cumulative value directly, the shared loop
				// would add it on top of what it already accumulated and double-count.
				//
				// Example: Turn 1 streams $0.30 → state.totalCost = 0.30, loop total = 0.30.
				//          Turn 2 streams $0.20 more → state.totalCost = 0.50.
				//          Without the delta, loop total = 0.30 + 0.50 = $0.80 (wrong).
				//          With the delta (0.50 - 0.30 = 0.20), loop total = 0.30 + 0.20 = $0.50 (correct).
				const perTurnCostDelta = state.totalCost - costBeforeTurn;
				return {
					result: { ...turnResult, cost: perTurnCostDelta },
					toolCallCount: state.toolCallCount,
				};
			} finally {
				eventAbort.abort();
				await streamTask;
			}
		},
	});
}

/**
 * OpenCode backend for CASCADE.
 *
 * Uses the official OpenCode server protocol through the published SDK client,
 * while spawning the server process directly so CASCADE can scope credentials
 * per run without mutating global worker environment.
 */
export class OpenCodeEngine implements AgentEngine {
	readonly definition = OPENCODE_ENGINE_DEFINITION;

	supportsAgentType(_agentType: string): boolean {
		return true;
	}

	resolveModel(cascadeModel: string): string {
		return resolveOpenCodeModel(cascadeModel);
	}

	getSettingsSchema() {
		return OpenCodeSettingsSchema;
	}

	async afterExecute(plan: AgentExecutionPlan, _result: AgentEngineResult): Promise<void> {
		// Clean up offloaded context files — idempotent, safe to call from adapter hook.
		// Server process and session cleanup happen inside execute()'s finally block
		// since those resources are local to the execution.
		await cleanupContextFiles(plan.repoDir);
	}

	async execute(input: AgentExecutionPlan): Promise<AgentEngineResult> {
		const settings = resolveOpenCodeSettings(input.project, input.engineSettings);
		const agent = 'build' as const;
		// resolveOpenCodeModel() is idempotent; calling it here ensures execute() works when
		// invoked directly (e.g. in tests) without going through the adapter.
		const model = resolveOpenCodeModel(input.model);
		const config = buildConfig(input, model, settings);
		const { prompt: taskPrompt, hasOffloadedContext } = await buildTaskPrompt(
			input.taskPrompt,
			input.contextInjections,
			input.repoDir,
		);

		logOpenCodeStart(input, model, agent, settings.webSearch, hasOffloadedContext);

		let server: Awaited<ReturnType<typeof startOpenCodeServer>> | undefined;
		let sessionId: string | undefined;
		let state: OpenCodeStreamState | undefined;
		const serverState: OpenCodeServerState = { stdout: '', stderr: '' };

		try {
			server = await startOpenCodeServer(
				config,
				input.projectSecrets,
				input.engineLogPath,
				input.cliToolsDir,
				input.nativeToolShimDir,
			);
			const client = createOpencodeClient({
				baseUrl: server.url,
				directory: input.repoDir,
			});
			attachServerState(server, serverState);
			sessionId = await createOpenCodeSession(client, input);
			state = createOpenCodeStreamState(input, model, settings.webSearch, sessionId);
			return await runOpenCodeTurnLoop(client, sessionId, agent, input, taskPrompt, state);
		} catch (error) {
			const output = getPartialOutput(state);
			const { prUrl, prEvidence } = extractAndBuildPrEvidence(output);
			const errorMessage =
				serverState.exitCode !== undefined
					? formatOpenCodeServerExitError(serverState)
					: formatNativeToolTransportError('OpenCode transport failed after retries', error);
			input.logWriter('ERROR', 'OpenCode execution failed', {
				error: error instanceof Error ? error.message : String(error),
				serverExited: serverState.exitCode !== undefined,
				serverExitCode: serverState.exitCode ?? null,
				hasPartialOutput: output.length > 0,
			});
			return buildEngineResult({
				success: false,
				output,
				cost: undefined,
				prUrl,
				prEvidence,
				error: errorMessage,
			});
		} finally {
			if (sessionId && server) {
				const client = createOpencodeClient({
					baseUrl: server.url,
					directory: input.repoDir,
				});
				await cleanupSession(client, sessionId);
			}
			server?.child.kill();
			if (hasOffloadedContext) {
				await cleanupContextFiles(input.repoDir);
			}
		}
	}
}
