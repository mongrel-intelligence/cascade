import { loadPartials } from '../../db/repositories/partialsRepository.js';
import { readWorkItem } from '../../gadgets/pm/core/readWorkItem.js';
import { getPMProvider } from '../../pm/index.js';
import type { CascadeConfig, ProjectConfig } from '../../types/index.js';
import { type ModelConfig, resolveModelConfig } from './modelResolution.js';
import { buildPromptContext } from './promptContext.js';
import {
	buildCheckFailurePrompt,
	buildCommentResponsePrompt,
	buildDebugPrompt,
	buildWorkItemPrompt,
} from './taskPrompts.js';

// ============================================================================
// Types
// ============================================================================

export interface AgentContextData {
	systemPrompt: string;
	model: string;
	maxIterations: number;
	contextFiles: ModelConfig['contextFiles'];
	cardData: string;
	prompt: string;
	implementationSteps?: string[];
}

// ============================================================================
// Helpers
// ============================================================================

export async function fetchImplementationSteps(cardId: string): Promise<string[] | undefined> {
	try {
		const provider = getPMProvider();
		const checklists = await provider.getChecklists(cardId);
		const implChecklist = checklists.find((cl) => cl.name.includes('Implementation Steps'));
		if (!implChecklist || implChecklist.items.length === 0) return undefined;
		const incompleteItems = implChecklist.items.filter((item) => !item.complete);
		return incompleteItems.length > 0 ? incompleteItems.map((item) => item.name) : undefined;
	} catch {
		return undefined;
	}
}

async function loadDbPartials(orgId: string): Promise<Map<string, string> | undefined> {
	try {
		return await loadPartials(orgId);
	} catch {
		// DB not available — fall back to disk-only partials
		return undefined;
	}
}

function selectPrompt(
	cardId: string | undefined,
	commentContext?: { text: string; author: string },
	prContext?: { prNumber: number; prBranch: string; repoFullName: string; headSha: string },
	debugContext?: {
		logDir: string;
		originalCardName: string;
		originalCardUrl: string;
		detectedAgentType: string;
	},
): string {
	if (commentContext) {
		return buildCommentResponsePrompt(cardId ?? '', commentContext.text, commentContext.author);
	}
	if (prContext) return buildCheckFailurePrompt(prContext);
	if (debugContext) return buildDebugPrompt(debugContext);
	return buildWorkItemPrompt(cardId ?? '');
}

// ============================================================================
// Main Context Builder
// ============================================================================

export async function buildAgentContext(
	agentType: string,
	cardId: string | undefined,
	repoDir: string,
	project: ProjectConfig,
	config: CascadeConfig,
	log: { info: (msg: string, ctx?: Record<string, unknown>) => void },
	triggerType?: string,
	prContext?: { prNumber: number; prBranch: string; repoFullName: string; headSha: string },
	debugContext?: {
		logDir: string;
		originalCardId: string;
		originalCardName: string;
		originalCardUrl: string;
		detectedAgentType: string;
	},
	modelOverride?: string,
	commentContext?: { text: string; author: string },
): Promise<AgentContextData> {
	const promptContext = buildPromptContext(cardId, project, triggerType, prContext, debugContext);
	const dbPartials = await loadDbPartials(project.orgId);

	// Some agents share model/iteration config with another agent type
	const configKeyOverrides: Record<string, string> = {
		'respond-to-planning-comment': 'planning',
	};

	const { systemPrompt, model, maxIterations, contextFiles } = await resolveModelConfig({
		agentType,
		project,
		config,
		repoDir,
		modelOverride,
		promptContext,
		configKey: configKeyOverrides[agentType],
		dbPartials,
	});

	// Pre-fetch work item data for synthetic gadget call (only if cardId exists and not debug flow)
	let cardData = '';
	if (cardId && !debugContext) {
		log.info('Fetching work item data for context', { cardId });
		cardData = await readWorkItem(cardId, true);
	}

	// Pre-fetch implementation steps for synthetic todo injection
	let implementationSteps: string[] | undefined;
	if (agentType === 'implementation' && cardId && !debugContext) {
		implementationSteps = await fetchImplementationSteps(cardId);
	}

	const prompt = selectPrompt(cardId, commentContext, prContext, debugContext);

	return {
		systemPrompt,
		model,
		maxIterations,
		contextFiles,
		cardData,
		prompt,
		implementationSteps,
	};
}
