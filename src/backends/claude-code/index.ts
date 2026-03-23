import { constants, accessSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { getEngineSettings } from '../../config/engineSettings.js';
import { logger } from '../../utils/logging.js';
import { getWorkspaceDir } from '../../utils/repo.js';
import { CLAUDE_CODE_ENGINE_DEFINITION } from '../catalog.js';
import { cleanupContextFiles } from '../shared/contextFiles.js';
import { runContinuationLoop } from '../shared/continuationLoop.js';
import { buildSystemPrompt, buildTaskPrompt } from '../shared/nativeToolPrompts.js';
import type { AgentEngine, AgentEngineResult, AgentExecutionPlan } from '../types.js';
import { buildClaudeEnv } from './env.js';
import { buildHooks } from './hooks.js';
import {
	buildPromptWithImages,
	buildResult,
	consumeStream,
	filterContextImages,
} from './messageProcessing.js';
import { CLAUDE_CODE_MODEL_IDS, DEFAULT_CLAUDE_CODE_MODEL } from './models.js';
import { ClaudeCodeSettingsSchema, resolveClaudeCodeSettings } from './settings.js';

export {
	buildToolGuidance,
	buildTaskPrompt,
	buildSystemPrompt,
} from '../shared/nativeToolPrompts.js';
export { buildClaudeEnv as buildEnv } from './env.js';
export { buildPromptWithImages, formatErrorMessage } from './messageProcessing.js';

/**
 * Resolve a CASCADE model string to a Claude model ID.
 *
 * CASCADE config uses prefixed model names (e.g., 'openrouter:google/gemini-3-flash-preview').
 * The Claude Code SDK expects Anthropic model IDs.
 */
export function resolveClaudeModel(cascadeModel: string): string {
	if (CLAUDE_CODE_MODEL_IDS.includes(cascadeModel)) return cascadeModel;
	if (cascadeModel.startsWith('claude-')) return cascadeModel;
	if (cascadeModel.startsWith('anthropic:')) return cascadeModel.replace('anthropic:', '');

	throw new Error(
		`Model "${cascadeModel}" is not compatible with the Claude Code engine. Configure a Claude-compatible model (e.g. "${DEFAULT_CLAUDE_CODE_MODEL}") or switch to a different engine.`,
	);
}

/**
 * Ensure $HOME/.claude.json exists with the onboarding flag.
 * Claude Code CLI requires this file to skip interactive onboarding
 * in headless environments, regardless of auth method (API key or subscription).
 */
export function ensureOnboardingFlag(): void {
	const homeDir = process.env.HOME ?? '/home/node';
	const claudeJsonPath = path.join(homeDir, '.claude.json');
	if (!existsSync(claudeJsonPath)) {
		writeFileSync(claudeJsonPath, JSON.stringify({ hasCompletedOnboarding: true }), {
			mode: 0o600,
		});
	}
}

function debugRepoDirectory(repoDir: string): void {
	const repoDirExists = existsSync(repoDir);
	let repoDirReadable = false;
	let repoDirEntries: string[] = [];
	try {
		accessSync(repoDir, constants.R_OK | constants.X_OK);
		repoDirReadable = true;
		repoDirEntries = readdirSync(repoDir).slice(0, 15);
	} catch {}
	const repoDirStat = repoDirExists ? statSync(repoDir) : null;
	logger.info('Claude Code pre-launch directory check', {
		repoDir,
		exists: repoDirExists,
		readable: repoDirReadable,
		isDirectory: repoDirStat?.isDirectory() ?? false,
		uid: repoDirStat?.uid,
		gid: repoDirStat?.gid,
		mode: repoDirStat ? `0${(repoDirStat.mode & 0o777).toString(8)}` : null,
		entries: repoDirEntries,
		processCwd: process.cwd(),
		workspaceDir: getWorkspaceDir(),
	});

	if (!repoDirExists || !repoDirReadable) {
		logger.error('Repo directory not accessible — Claude Code will likely fail', {
			repoDir,
			exists: repoDirExists,
			readable: repoDirReadable,
		});
	}
}

const CLAUDE_NATIVE_TOOL_MAP: Record<string, string[]> = {
	'fs:read': ['Read', 'Glob', 'Grep'],
	'fs:write': ['Write', 'Edit'],
	'shell:exec': ['Bash'],
};

function resolveNativeTools(nativeToolCapabilities?: string[]): string[] {
	if (!nativeToolCapabilities || nativeToolCapabilities.length === 0) {
		return ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];
	}

	const tools = new Set<string>();
	for (const capability of nativeToolCapabilities) {
		for (const tool of CLAUDE_NATIVE_TOOL_MAP[capability] ?? []) {
			tools.add(tool);
		}
	}

	return tools.size > 0 ? [...tools] : ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];
}

/**
 * Map raw Claude Code engine settings to SDK query options.
 * Only settings that are explicitly configured are returned; undefined fields
 * are omitted to preserve SDK defaults.
 */
function buildSettingsOptions(rawSettings: {
	effort?: 'low' | 'medium' | 'high' | 'max';
	thinking?: 'adaptive' | 'enabled' | 'disabled';
	thinkingBudgetTokens?: number;
}): {
	effort?: 'low' | 'medium' | 'high' | 'max';
	thinking?:
		| { type: 'adaptive' }
		| { type: 'enabled'; budgetTokens: number }
		| { type: 'disabled' };
	maxThinkingTokens?: number;
} {
	const result: ReturnType<typeof buildSettingsOptions> = {};

	if (rawSettings.effort !== undefined) {
		result.effort = rawSettings.effort;
	}

	if (rawSettings.thinking !== undefined) {
		if (rawSettings.thinking === 'enabled') {
			result.thinking = {
				type: 'enabled',
				budgetTokens: rawSettings.thinkingBudgetTokens ?? 10_000,
			};
		} else if (rawSettings.thinking === 'disabled') {
			result.thinking = { type: 'disabled' };
		} else {
			result.thinking = { type: 'adaptive' };
		}
	} else if (rawSettings.thinkingBudgetTokens !== undefined) {
		// No explicit thinking mode — pass budget via deprecated maxThinkingTokens
		result.maxThinkingTokens = rawSettings.thinkingBudgetTokens;
	}

	return result;
}

/**
 * Clean up the Claude Code persisted session directory.
 * Since workers are ephemeral, there's no need to keep session data after execution.
 *
 * The SDK encodes cwd into the session directory name by replacing path separators with '-'.
 * For example, /tmp/cascade-repo-abc becomes ~/.claude/projects/-tmp-cascade-repo-abc.
 */
async function cleanupPersistedSession(repoDir: string): Promise<void> {
	const encodedDir = repoDir.replaceAll(path.sep, '-');
	const sessionDir = path.join(homedir(), '.claude', 'projects', encodedDir);
	try {
		if (existsSync(sessionDir)) {
			await rm(sessionDir, { recursive: true, force: true });
		}
	} catch {
		// Best-effort cleanup
	}
}

/**
 * Claude Code SDK backend for CASCADE.
 *
 * Uses the Claude Code SDK's query() function to run agents with built-in file tools
 * (Read, Write, Edit, Bash, Glob, Grep). CASCADE's domain tools (Trello, GitHub, Session)
 * are invoked via the built-in Bash tool through the cascade-tools CLI, with usage
 * guidance injected into the system prompt.
 */
export class ClaudeCodeEngine implements AgentEngine {
	readonly definition = CLAUDE_CODE_ENGINE_DEFINITION;

	supportsAgentType(_agentType: string): boolean {
		return true;
	}

	resolveModel(cascadeModel: string): string {
		return resolveClaudeModel(cascadeModel);
	}

	getSettingsSchema() {
		return ClaudeCodeSettingsSchema;
	}

	async beforeExecute(plan: AgentExecutionPlan): Promise<void> {
		// Ensure onboarding flag exists (required for both API key and subscription auth)
		ensureOnboardingFlag();
		// Log repo directory state for debugging
		debugRepoDirectory(plan.repoDir);
	}

	async afterExecute(plan: AgentExecutionPlan, _result: AgentEngineResult): Promise<void> {
		// Clean up offloaded context files after execution
		await cleanupContextFiles(plan.repoDir);
		// Clean up persisted session directory — workers are ephemeral
		await cleanupPersistedSession(plan.repoDir);
	}

	async execute(input: AgentExecutionPlan): Promise<AgentEngineResult> {
		const startTime = Date.now();
		const systemPrompt = buildSystemPrompt(input.systemPrompt, input.availableTools);

		// Collect supported images for native SDK delivery; strip from injections so
		// offloadLargeContext does not also write them to disk (redundant for this engine).
		const supportedImages = filterContextImages(input.contextInjections, input.logWriter);
		const injectionsForPrompt = input.contextInjections.map(({ images: _images, ...rest }) => rest);

		const { prompt: taskPrompt, hasOffloadedContext } = await buildTaskPrompt(
			input.taskPrompt,
			injectionsForPrompt,
			input.repoDir,
		);
		// resolveClaudeModel() is idempotent; calling it here ensures execute() works when
		// invoked directly (e.g. in tests) without going through the adapter.
		const model = resolveClaudeModel(input.model);
		const resolvedSettings = resolveClaudeCodeSettings(input.project, input.engineSettings);
		// Only the explicitly-configured fields (raw, pre-default) are passed to the SDK.
		// This preserves SDK defaults when no project-level settings are configured.
		// Use the merged engineSettings from the execution plan (falls back to project-level).
		const effectiveEngineSettings = input.engineSettings ?? input.project.engineSettings;
		const rawEngineSettings =
			getEngineSettings(effectiveEngineSettings, 'claude-code', ClaudeCodeSettingsSchema) ?? {};

		input.logWriter('INFO', 'Starting Claude Code SDK execution', {
			agentType: input.agentType,
			model,
			repoDir: input.repoDir,
			maxIterations: input.maxIterations,
			hasOffloadedContext,
			effort: resolvedSettings.effort,
			thinking: resolvedSettings.thinking,
			thinkingBudgetTokens: resolvedSettings.thinkingBudgetTokens,
		});

		const { env } = buildClaudeEnv(
			input.projectSecrets,
			input.cliToolsDir,
			input.nativeToolShimDir,
		);
		const hooks = buildHooks(input.logWriter, input.repoDir, input.enableStopHooks ?? true, {
			blockGitPush: input.blockGitPush,
		});

		const sdkTools = resolveNativeTools(input.nativeToolCapabilities);
		const sdkSettingsOptions = buildSettingsOptions(rawEngineSettings);

		// Use AsyncIterable prompt for the first turn when images are present; string otherwise.
		// Continuation turns always use a plain string prompt.
		const initialPromptInput: string | AsyncIterable<SDKUserMessage> =
			supportedImages.length > 0 ? buildPromptWithImages(taskPrompt, supportedImages) : taskPrompt;
		let turnCount = 0;

		return runContinuationLoop({
			initialPrompt: taskPrompt,
			completionRequirements: input.completionRequirements,
			logWriter: input.logWriter,
			engineLabel: 'Claude Code',
			executeTurn: async ({ promptText, isContinuation }) => {
				// Use the AsyncIterable prompt for the first turn when images are present,
				// fall back to string for continuation turns (which always use plain text).
				const promptInput: string | AsyncIterable<SDKUserMessage> =
					!isContinuation && supportedImages.length > 0 ? initialPromptInput : promptText;
				const stderrChunks: string[] = [];
				const stream = query({
					prompt: promptInput,
					options: {
						model,
						systemPrompt,
						cwd: input.repoDir,
						additionalDirectories: [getWorkspaceDir()],
						maxBudgetUsd: input.budgetUsd,
						permissionMode: 'bypassPermissions',
						allowDangerouslySkipPermissions: true,
						tools: sdkTools,
						allowedTools: sdkTools,
						persistSession: true,
						hooks,
						env,
						debug: true,
						stderr: (data: string) => {
							stderrChunks.push(data);
							input.logWriter('INFO', 'Claude Code stderr', { data: data.trim() });
						},
						...(isContinuation ? { continue: true } : {}),
						...sdkSettingsOptions,
					},
				});

				const {
					assistantMessages,
					resultMessage,
					turnCount: newTurnCount,
					toolCallCount,
				} = await consumeStream(stream, input, model, turnCount);
				turnCount = newTurnCount;

				const turnResult = buildResult(
					assistantMessages,
					resultMessage,
					stderrChunks,
					input,
					startTime,
				);

				return { result: turnResult, toolCallCount };
			},
		});
	}
}
