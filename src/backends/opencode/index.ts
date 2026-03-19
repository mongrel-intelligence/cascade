import { spawn } from 'node:child_process';
import { type Server, createServer } from 'node:net';

import { createOpencodeClient } from '@opencode-ai/sdk/client';
import type {
	AssistantMessage,
	Config,
	Event,
	Part,
	Permission,
	ToolPart,
} from '@opencode-ai/sdk/client';

import { logger } from '../../utils/logging.js';
import { OPENCODE_ENGINE_DEFINITION } from '../catalog.js';
import {
	formatNativeToolTransportError,
	isRetryableNativeToolError,
	retryNativeToolOperation,
} from '../nativeToolRetry.js';
import { cleanupContextFiles } from '../shared/contextFiles.js';
import { runContinuationLoop } from '../shared/continuationLoop.js';
import { appendEngineLog } from '../shared/engineLog.js';
import { buildEngineResult, extractAndBuildPrEvidence } from '../shared/engineResult.js';
import { logLlmCall } from '../shared/llmCallLogger.js';
import { buildSystemPrompt, buildTaskPrompt } from '../shared/nativeToolPrompts.js';
import type { AgentEngine, AgentEngineResult, AgentExecutionPlan } from '../types.js';
import { buildEnv } from './env.js';
import { DEFAULT_OPENCODE_MODEL } from './models.js';
import { OpenCodeSettingsSchema, resolveOpenCodeSettings } from './settings.js';

function withTrailingSlashRemoved(value: string): string {
	return value.endsWith('/') ? value.slice(0, -1) : value;
}

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

type PermissionDecision = 'allow' | 'deny';

type OpenCodePermissionConfig = NonNullable<Config['permission']>;

export function buildPermissionConfig(
	nativeToolCapabilities: string[] | undefined,
	webSearch: boolean,
): OpenCodePermissionConfig {
	const canWrite = nativeToolCapabilities?.includes('fs:write') ?? false;
	const canExec = nativeToolCapabilities?.includes('shell:exec') ?? false;

	return {
		edit: canWrite ? 'allow' : 'deny',
		bash: canExec ? 'allow' : 'deny',
		webfetch: webSearch ? 'allow' : 'deny',
		doom_loop: 'deny',
		external_directory: 'deny',
	};
}

function normalizePermissionDecision(decision: PermissionDecision): 'always' | 'reject' {
	return decision === 'allow' ? 'always' : 'reject';
}

export function resolvePermissionDecision(
	permission: Pick<Permission, 'type'>,
	config: OpenCodePermissionConfig,
): PermissionDecision {
	switch (permission.type) {
		case 'edit':
			return config.edit === 'allow' ? 'allow' : 'deny';
		case 'bash':
			return config.bash === 'allow' ? 'allow' : 'deny';
		case 'webfetch':
			return config.webfetch === 'allow' ? 'allow' : 'deny';
		case 'external_directory':
			return config.external_directory === 'allow' ? 'allow' : 'deny';
		case 'doom_loop':
			return config.doom_loop === 'allow' ? 'allow' : 'deny';
		default:
			return 'deny';
	}
}

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

async function reservePort(): Promise<number> {
	return await new Promise<number>((resolve, reject) => {
		const server: Server = createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (!address || typeof address === 'string') {
				server.close(() => reject(new Error('Failed to reserve OpenCode server port')));
				return;
			}
			server.close((error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(address.port);
			});
		});
	});
}

async function startOpenCodeServer(
	config: Config,
	projectSecrets: Record<string, string> | undefined,
	engineLogPath: string | undefined,
	cliToolsDir: string,
	nativeToolShimDir?: string,
): Promise<{ child: ReturnType<typeof spawn>; url: string }> {
	const port = await reservePort();
	const host = '127.0.0.1';
	const env = {
		...buildEnv(projectSecrets, cliToolsDir, nativeToolShimDir),
		OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
	};
	const args = ['serve', `--hostname=${host}`, `--port=${port}`];

	appendEngineLog(
		engineLogPath,
		`$ opencode ${args.map((arg) => JSON.stringify(arg)).join(' ')}\n`,
	);

	return await new Promise((resolve, reject) => {
		const child = spawn('opencode', args, {
			env,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let output = '';
		let settled = false;

		const finish = (handler: () => void) => {
			if (settled) return;
			settled = true;
			handler();
		};

		const onChunk = (chunk: Buffer | string) => {
			const text = chunk.toString();
			output += text;
			appendEngineLog(engineLogPath, text);
			for (const line of output.split('\n')) {
				if (!line.startsWith('opencode server listening')) continue;
				const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
				if (!match) continue;
				finish(() => resolve({ child, url: withTrailingSlashRemoved(match[1]) }));
				return;
			}
		};

		child.stdout.on('data', onChunk);
		child.stderr.on('data', onChunk);
		child.once('error', (error) => {
			finish(() => {
				reject(
					error instanceof Error && 'code' in error && error.code === 'ENOENT'
						? new Error(
								'OpenCode CLI not found in PATH. Install `opencode-ai` in the worker image.',
							)
						: error,
				);
			});
		});
		child.once('exit', (code) => {
			finish(() => {
				reject(
					new Error(
						`OpenCode server exited with code ${code ?? 1}${output.trim() ? `\n${output}` : ''}`,
					),
				);
			});
		});
	});
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

function getPartDelta(part: Part, delta?: string): string | undefined {
	if (delta) return delta;
	if (part.type !== 'text' || part.synthetic || part.ignored) return undefined;
	return part.text;
}

function appendPartialOutput(state: OpenCodeStreamState, text: string): void {
	const trimmed = text.trim();
	if (!trimmed) return;
	state.partialOutput.push(trimmed);
}

function getPartialOutput(state: OpenCodeStreamState | undefined): string {
	if (!state) return '';
	return state.partialOutput.join('\n').trim();
}

function summarizeServerOutput(serverState: OpenCodeServerState): string | undefined {
	const summary = [serverState.stderr.trim(), serverState.stdout.trim()].filter(Boolean).join('\n');
	if (!summary) return undefined;
	return summary.length > 500 ? `${summary.slice(0, 500)}...` : summary;
}

function formatOpenCodeServerExitError(serverState: OpenCodeServerState): string {
	const summary = summarizeServerOutput(serverState);
	return summary
		? `OpenCode server exited unexpectedly with code ${serverState.exitCode ?? 1}: ${summary}`
		: `OpenCode server exited unexpectedly with code ${serverState.exitCode ?? 1}`;
}

function reportToolPart(
	input: AgentExecutionPlan,
	part: ToolPart,
	reportedToolCalls: Set<string>,
): void {
	if (reportedToolCalls.has(part.callID)) return;
	if (part.state.status === 'pending') return;
	reportedToolCalls.add(part.callID);
	input.progressReporter.onToolCall(part.tool, part.state.input);
}

function storeUsage(
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

interface OpenCodeStreamState {
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

interface OpenCodeServerState {
	stdout: string;
	stderr: string;
	exitCode?: number;
}

async function handlePermissionEvent(
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

function handleSessionTerminalEvent(event: EventPayload, state: OpenCodeStreamState): boolean {
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

async function handleMessagePartUpdated(
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

type EventPayload = Event;

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

async function processStreamEvent(
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

function attachServerState(
	server: Awaited<ReturnType<typeof startOpenCodeServer>>,
	serverState: OpenCodeServerState,
): void {
	server.child.stdout?.on('data', (chunk: Buffer | string) => {
		serverState.stdout += chunk.toString();
	});
	server.child.stderr?.on('data', (chunk: Buffer | string) => {
		serverState.stderr += chunk.toString();
	});
	server.child.once('exit', (code) => {
		serverState.exitCode = code ?? 1;
	});
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
				return {
					result: turnResult,
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
		// Resolve model again here for backward compatibility: execute() may be called
		// directly (e.g. in tests) without going through the adapter, so we cannot rely
		// solely on the adapter's engine.resolveModel() pre-resolution. Since
		// resolveOpenCodeModel() is idempotent, calling it twice via the normal adapter path
		// is safe.
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
