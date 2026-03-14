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
import { getSessionState } from '../../gadgets/sessionState.js';
import { createLLMCallLogger } from '../../utils/llmLogging.js';
import { LLMIST_ENGINE_DEFINITION } from '../catalog.js';
import type { AgentEngine, AgentEngineResult, AgentExecutionPlan } from '../types.js';

/**
 * LLMist engine adapter — executes agents using the llmist SDK.
 *
 * Receives a fully pre-resolved AgentExecutionPlan from the shared adapter
 * (adapter.ts → executeWithEngine → buildExecutionPlan), which provides:
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
export class LlmistEngine implements AgentEngine {
	readonly definition = LLMIST_ENGINE_DEFINITION;

	supportsAgentType(): boolean {
		return true; // llmist supports all agent types
	}

	async execute(input: AgentExecutionPlan): Promise<AgentEngineResult> {
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
			engineLogPath,
			progressReporter,
		} = input;

		const profile = await getAgentProfile(agentType);

		// Create LLMist client with custom model definitions
		const client = new LLMist({ customModels: CUSTOM_MODELS as ModelSpec[] });

		// Create per-execution llmist logger and tracking state
		const llmistLogger = createLogger({ minLevel: getLogLevel() });
		const trackingContext = createTrackingContext(agentType);
		const llmCallAccumulator: AccumulatedLlmCall[] = [];

		// Create a LLM call logger for raw request/response file logging.
		// Lives in the system tmp dir, independent from the outer fileLogger
		// (which handles cascade.log / engine.log).
		const llmCallLogger = createLLMCallLogger(os.tmpdir(), `llmist-${agentType}-${Date.now()}`);

		// Point llmist SDK at the workspace directory engine log path (provided by the outer
		// pipeline's fileLogger). This ensures the structured engine log is included in run
		// records and log bundles during finalization.
		if (engineLogPath) {
			process.env.LLMIST_LOG_FILE = engineLogPath;
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
			workItemId: agentInput.workItemId,
			workItemUrl: agentInput.workItemUrl as string | undefined,
			workItemTitle: agentInput.workItemTitle as string | undefined,
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

		const prUrl = getSessionState().prUrl ?? undefined;
		return {
			success: !result.loopTerminated,
			output: result.output,
			prUrl,
			prEvidence: prUrl
				? {
						source: 'llmist-session',
						authoritative: true,
					}
				: undefined,
			error: result.loopTerminated ? 'Agent terminated due to persistent loop' : undefined,
			cost: result.cost,
		};
	}
}
