import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Eta } from 'eta';

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(__dirname, 'templates');

// Initialize Eta with the templates directory
const eta = new Eta({ views: templatesDir, autoEscape: false });

// Template context interface
export interface PromptContext {
	// Common
	cardId?: string;
	cardUrl?: string;
	projectId?: string;
	baseBranch?: string;

	// PM vocabulary (computed from pmType)
	pmType?: 'trello' | 'jira';
	workItemNoun?: string; // "card" or "issue"
	workItemNounPlural?: string; // "cards" or "issues"
	workItemNounCap?: string; // "Card" or "Issue"
	workItemNounPluralCap?: string; // "Cards" or "Issues"
	pmName?: string; // "Trello" or "JIRA"

	// Briefing-specific
	storiesListId?: string;
	processedLabelId?: string;

	// Check-failure specific
	prNumber?: number;
	prBranch?: string;
	repoFullName?: string;
	headSha?: string;
	triggerType?: string;

	// Debug-specific
	logDir?: string;
	originalCardId?: string;
	originalCardName?: string;
	originalCardUrl?: string;
	detectedAgentType?: string;
	debugListId?: string;

	// Future extensibility
	[key: string]: unknown;
}

// Cache for loaded templates
const templateCache = new Map<string, string>();

function loadTemplate(agentType: string): string {
	const cached = templateCache.get(agentType);
	if (cached) {
		return cached;
	}

	const templatePath = join(templatesDir, `${agentType}.eta`);
	const template = readFileSync(templatePath, 'utf-8');
	templateCache.set(agentType, template);
	return template;
}

export function getSystemPrompt(agentType: string, context: PromptContext = {}): string {
	const validTypes = [
		'briefing',
		'planning',
		'implementation',
		'debug',
		'respond-to-review',
		'respond-to-ci',
		'respond-to-pr-comment',
		'respond-to-planning-comment',
		'review',
	];
	if (!validTypes.includes(agentType)) {
		throw new Error(`Unknown agent type: ${agentType}`);
	}

	const template = loadTemplate(agentType);
	return eta.renderString(template, context);
}

// Export individual prompts for backwards compatibility (rendered without context)
export const BRIEFING_SYSTEM_PROMPT = loadTemplate('briefing');
export const PLANNING_SYSTEM_PROMPT = loadTemplate('planning');
export const IMPLEMENTATION_SYSTEM_PROMPT = loadTemplate('implementation');
export const DEBUG_SYSTEM_PROMPT = loadTemplate('debug');
export const RESPOND_TO_REVIEW_SYSTEM_PROMPT = loadTemplate('respond-to-review');
export const RESPOND_TO_CI_SYSTEM_PROMPT = loadTemplate('respond-to-ci');
export const RESPOND_TO_PR_COMMENT_SYSTEM_PROMPT = loadTemplate('respond-to-pr-comment');
export const RESPOND_TO_PLANNING_COMMENT_SYSTEM_PROMPT = loadTemplate(
	'respond-to-planning-comment',
);
export const REVIEW_SYSTEM_PROMPT = loadTemplate('review');
