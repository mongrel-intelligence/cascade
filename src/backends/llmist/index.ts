import os from 'node:os';

import { createLogger, LLMist, type ModelSpec } from 'llmist';

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
import { filterPostingGadgetNames, resolveUpdateChannel } from '../../config/updateChannel.js';
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
		const trackingContext = createTrackingContext(
			agentType,
			profile.finishHooks.requiresReview ? 'review' : 'default',
		);
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
		const allGadgets = profile.getLlmistGadgets(integrationChecker) as Array<{ name: string }>;

		// Drop the communication-only PM/SCM posting gadgets the resolved update
		// channel disables, mirroring the native-tool path in buildExecutionPlan() so
		// an agent cannot post on a disabled channel via either engine family. Layers
		// on top of getLlmistGadgets' integration-availability filtering: an enabled
		// channel against an absent gadget simply has nothing to drop.
		const updateChannel = resolveUpdateChannel(input.project, agentType);
		const allowedGadgetNames = new Set(
			filterPostingGadgetNames(
				allGadgets.map((gadget) => gadget.name),
				updateChannel,
			),
		);
		const gadgets = allGadgets.filter((gadget) => allowedGadgetNames.has(gadget.name));

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
			prBranch: agentInput.prBranch as string | undefined,
			projectId: input.project.id,
			workItemId: agentInput.workItemId,
			workItemUrl: agentInput.workItemUrl as string | undefined,
			workItemTitle: agentInput.workItemTitle as string | undefined,
			frictionSidecarPath: input.frictionSidecarPath,
			// Pass PR metadata so in-process gadgets (e.g. ReportFriction) can read it
			// from SessionState as a fallback when CASCADE_PR_* env vars are not exported
			// into process.env (which is the case for all in-process LLMist gadgets).
			prNumber: agentInput.prNumber,
			prUrl: agentInput.prUrl as string | undefined,
			prTitle: agentInput.prTitle as string | undefined,
			// Pass full project config so in-process gadgets (e.g. ReportFriction) can
			// build accurate reports. In LLMist, projectSecrets are NOT exported into
			// process.env, so projectFromEnv() would return 'unknown-project'/empty PM config.
			project: input.project,
			// Pass engine/model identifiers so ReportFriction context.agent is accurate
			// for in-process runs (CASCADE_ENGINE_LABEL / CASCADE_MODEL are not exported).
			engineLabel: this.definition.id,
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
		// If the injection has images, they are added as follow-up multimodal user messages.
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
				injection.images,
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

		// Only return the prUrl as authoritative "PR created" evidence when CreatePR was actually
		// called (prCreated === true). The prUrl field is also populated on init from incoming
		// PR context (e.g. for review/respond-to-ci runs), so without this gate a PR-triggered
		// run that never calls CreatePR would falsely report a "PR created" result.
		const sessionState = getSessionState();
		const prUrl = sessionState.prCreated ? (sessionState.prUrl ?? undefined) : undefined;
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
