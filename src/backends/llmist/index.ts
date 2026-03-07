import os from 'node:os';

import { LLMist, type ModelSpec, createLogger } from 'llmist';

import { createIntegrationChecker } from '../../agents/capabilities/index.js';
import { getAgentProfile } from '../../agents/definitions/profiles.js';
import { type BuilderType, createConfiguredBuilder } from '../../agents/shared/builderFactory.js';
import { injectSyntheticCall } from '../../agents/shared/syntheticCalls.js';
import { runAgentLoop } from '../../agents/utils/agentLoop.js';
import type { AccumulatedLlmCall } from '../../agents/utils/hooks.js';
import { getLogLevel } from '../../agents/utils/index.js';
import { createAgentLogger } from '../../agents/utils/logging.js';
import { createTrackingContext } from '../../agents/utils/tracking.js';
import { CUSTOM_MODELS } from '../../config/customModels.js';
import { createLLMCallLogger } from '../../utils/llmLogging.js';
import { extractPRUrl } from '../../utils/prUrl.js';
import type { AgentBackend, AgentBackendInput, AgentBackendResult } from '../types.js';

/**
 * llmist backend — executes agents using the llmist SDK.
 *
 * Receives a fully pre-resolved AgentBackendInput from the shared adapter
 * (adapter.ts → executeWithBackend → buildBackendInput), which provides:
 *   - systemPrompt, taskPrompt, model, maxIterations
 *   - contextInjections (pre-fetched PR/work-item/directory data)
 *   - repoDir (already set up by the outer executeAgentPipeline)
 *   - logWriter (shared file logger from the outer pipeline)
 *
 * Llmist-specific features preserved:
 *   - AccumulatedLlmCall metrics (via createObserverHooks inside createConfiguredBuilder)
 *   - Loop detection and hard-stop (via createObserverHooks + runAgentLoop)
 *   - Iteration hints / trailing messages (via createConfiguredBuilder)
 *   - Context compaction (via createConfiguredBuilder)
 *   - Synthetic gadget call injection from ContextInjection[]
 */
export class LlmistBackend implements AgentBackend {
	readonly name = 'llmist';

	supportsAgentType(): boolean {
		return true; // llmist supports all agent types
	}

	async execute(input: AgentBackendInput): Promise<AgentBackendResult> {
		const {
			agentType,
			systemPrompt,
			taskPrompt,
			model,
			maxIterations,
			contextInjections,
			budgetUsd,
			repoDir,
			logWriter,
			runId,
			agentInput,
			llmistLogPath,
			progressReporter,
		} = input;

		const profile = await getAgentProfile(agentType);

		// Create LLMist client with custom model definitions
		const client = new LLMist({ customModels: CUSTOM_MODELS as ModelSpec[] });

		// Create per-execution llmist logger and tracking state
		const llmistLogger = createLogger({ minLevel: getLogLevel() });
		const trackingContext = createTrackingContext();
		const llmCallAccumulator: AccumulatedLlmCall[] = [];

		// Create a LLM call logger for raw request/response file logging.
		// Lives in the system tmp dir, independent from the outer fileLogger
		// (which handles cascade.log / llmist.log).
		const llmCallLogger = createLLMCallLogger(os.tmpdir(), `llmist-${agentType}-${Date.now()}`);

		// Point llmist SDK at the workspace directory llmist log path (provided by the outer
		// pipeline's fileLogger). This ensures the structured llmist log is included in run
		// records and log bundles (read from fileLogger.llmistLogPath during finalization).
		if (llmistLogPath) {
			process.env.LLMIST_LOG_FILE = llmistLogPath;
			process.env.LLMIST_LOG_TEE = 'true';
		}

		// Get gadget instances from the agent profile, filtered by integration availability.
		// This ensures optional capabilities only provide gadgets if the integration is configured.
		const integrationChecker = await createIntegrationChecker(input.project.id);
		const gadgets = profile.getLlmistGadgets(integrationChecker);

		// Build the configured agent builder with all llmist-specific features:
		// rate limiting, retry, compaction, iteration hints, observer hooks
		let builder: BuilderType = await createConfiguredBuilder({
			client,
			agentType,
			model,
			systemPrompt,
			maxIterations,
			llmistLogger,
			trackingContext,
			logWriter,
			llmCallLogger,
			repoDir,
			gadgets: gadgets as Parameters<typeof createConfiguredBuilder>[0]['gadgets'],
			remainingBudgetUsd: budgetUsd,
			llmCallAccumulator,
			runId,
			baseBranch: input.project.baseBranch,
			projectId: input.project.id,
			cardId: agentInput.cardId,
			// Pass resolved hook flags for finish validation (hook-driven instead of agent-type checks)
			hooks: profile.finishHooks,
			// Pass the progress monitor from the adapter so createObserverHooks can call
			// onIteration/onToolCall/onText — enables progress updates to Trello/GitHub
			progressMonitor: progressReporter as Parameters<
				typeof createConfiguredBuilder
			>[0]['progressMonitor'],
		});

		// Convert ContextInjection[] from the unified adapter into synthetic gadget calls.
		// This is the llmist-native way to inject pre-fetched context: each injection
		// appears in the conversation as if the agent called the gadget itself.
		for (let idx = 0; idx < contextInjections.length; idx++) {
			const injection = contextInjections[idx];
			const invocationId = `gc_${injection.toolName.toLowerCase()}_${idx}`;
			builder = injectSyntheticCall(
				builder,
				trackingContext,
				injection.toolName,
				injection.params,
				injection.result,
				invocationId,
			);
		}

		// Create agent logger that writes to the shared logWriter from the outer pipeline
		const log = createAgentLogger({ write: logWriter } as Parameters<typeof createAgentLogger>[0]);

		log.info('Starting llmist agent', {
			model,
			maxIterations,
			promptLength: taskPrompt.length,
			contextInjections: contextInjections.length,
			runId,
		});

		// Run the agent event loop (includes loop detection, session notices, etc.)
		const agent = builder.ask(taskPrompt);
		const result = await runAgentLoop(
			agent,
			log,
			trackingContext,
			agentInput.interactive === true,
			agentInput.autoAccept === true,
		);

		log.info('Agent completed', {
			iterations: result.iterations,
			gadgetCalls: result.gadgetCalls,
			cost: result.cost,
			loopTerminated: result.loopTerminated ?? false,
		});

		return {
			success: !result.loopTerminated,
			output: result.output,
			prUrl: extractPRUrl(result.output) ?? undefined,
			error: result.loopTerminated ? 'Agent terminated due to persistent loop' : undefined,
			cost: result.cost,
		};
	}
}
