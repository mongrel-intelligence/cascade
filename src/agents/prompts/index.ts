import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Eta } from 'eta';

import { getKnownAgentTypes } from '../definitions/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(__dirname, 'templates');
const taskTemplatesDir = join(__dirname, 'task-templates');

// Initialize Eta with the templates directory
const eta = new Eta({ views: templatesDir, autoEscape: false });
const taskEta = new Eta({ views: taskTemplatesDir, autoEscape: false });

// Valid agent types — derived from YAML definition files
const validTypes = getKnownAgentTypes();

// Template context interface
export interface PromptContext {
	// Common
	cardId?: string;
	cardUrl?: string;
	projectId?: string;

	// PM vocabulary (computed from pmType)
	pmType?: 'trello' | 'jira';
	workItemNoun?: string; // "card" or "issue"
	workItemNounPlural?: string; // "cards" or "issues"
	workItemNounCap?: string; // "Card" or "Issue"
	workItemNounPluralCap?: string; // "Cards" or "Issues"
	pmName?: string; // "Trello" or "JIRA"

	// Splitting-specific
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

/**
 * Resolve `<%~ include("partials/...") %>` directives by looking up DB partials first,
 * falling back to disk. This pre-processing happens before Eta variable interpolation.
 */
export function resolveIncludes(template: string, dbPartials: Map<string, string>): string {
	return template.replace(
		/<%~\s*include\(\s*"partials\/([^"]+)"\s*\)\s*%>/g,
		(_match, name: string) => {
			const dbContent = dbPartials.get(name);
			if (dbContent !== undefined) return dbContent;
			// Fall back to disk
			const diskPath = join(templatesDir, 'partials', `${name}.eta`);
			try {
				return readFileSync(diskPath, 'utf-8');
			} catch {
				throw new Error(`Partial not found: partials/${name}`);
			}
		},
	);
}

/**
 * Render a DB-stored template with include resolution + Eta variable interpolation.
 */
export function renderCustomPrompt(
	templateSource: string,
	context: PromptContext = {},
	dbPartials?: Map<string, string>,
): string {
	const expanded = resolveIncludes(templateSource, dbPartials ?? new Map());
	return eta.renderString(expanded, context);
}

/**
 * Validate a template string for correct Eta syntax and resolvable includes.
 */
export function validateTemplate(
	templateSource: string,
	dbPartials?: Map<string, string>,
): { valid: true } | { valid: false; error: string } {
	try {
		const expanded = resolveIncludes(templateSource, dbPartials ?? new Map());
		eta.renderString(expanded, {});
		return { valid: true };
	} catch (err) {
		return { valid: false, error: err instanceof Error ? err.message : String(err) };
	}
}

export function getSystemPrompt(
	agentType: string,
	context: PromptContext = {},
	dbPartials?: Map<string, string>,
): string {
	if (!validTypes.includes(agentType)) {
		throw new Error(`Unknown agent type: ${agentType}`);
	}

	const template = loadTemplate(agentType);
	if (dbPartials && dbPartials.size > 0) {
		const expanded = resolveIncludes(template, dbPartials);
		return eta.renderString(expanded, context);
	}
	return eta.renderString(template, context);
}

// ============================================================================
// Task Prompt Templates
// ============================================================================

/** Context for task prompt Eta rendering */
export interface TaskPromptContext {
	cardId?: string;
	commentText?: string;
	commentAuthor?: string;
	prNumber?: number;
	prBranch?: string;
	commentBody?: string;
	commentPath?: string;
	// Email-joke agent fields
	senderEmail?: string;
	[key: string]: unknown;
}

const taskTemplateCache = new Map<string, string>();

function loadTaskTemplate(templateName: string): string {
	const cached = taskTemplateCache.get(templateName);
	if (cached) return cached;

	const templatePath = join(taskTemplatesDir, `${templateName}.eta`);
	const template = readFileSync(templatePath, 'utf-8');
	taskTemplateCache.set(templateName, template);
	return template;
}

/**
 * Render a task prompt from a named `.eta` template in `task-templates/`.
 * Supports DB partials via `include()` directives (same pattern as system prompts).
 */
export function renderTaskPrompt(
	templateName: string,
	context: TaskPromptContext = {},
	dbPartials?: Map<string, string>,
): string {
	const template = loadTaskTemplate(templateName);
	if (dbPartials && dbPartials.size > 0) {
		const expanded = resolveIncludes(template, dbPartials);
		return taskEta.renderString(expanded, context);
	}
	return taskEta.renderString(template, context);
}

/** Returns the raw .eta template source from disk (before rendering). */
export function getRawTemplate(agentType: string): string {
	if (!validTypes.includes(agentType)) {
		throw new Error(`Unknown agent type: ${agentType}`);
	}
	return loadTemplate(agentType);
}

/** Returns the raw partial source from disk. */
export function getRawPartial(name: string): string {
	const diskPath = join(templatesDir, 'partials', `${name}.eta`);
	return readFileSync(diskPath, 'utf-8');
}

/** Returns the list of valid agent types. */
export function getValidAgentTypes(): string[] {
	return [...validTypes];
}

/** Returns the list of available disk-based partial names. */
export function getAvailablePartialNames(): string[] {
	try {
		const entries = readdirSync(join(templatesDir, 'partials'));
		return entries
			.filter((f) => f.endsWith('.eta'))
			.map((f) => f.replace(/\.eta$/, ''))
			.sort();
	} catch {
		return [];
	}
}

/** Returns template variable info for documentation/reference. */
export function getTemplateVariables(): Array<{
	name: string;
	group: string;
	description: string;
}> {
	return [
		{ name: 'cardId', group: 'Common', description: 'Work item ID' },
		{ name: 'cardUrl', group: 'Common', description: 'Work item URL' },
		{ name: 'projectId', group: 'Common', description: 'Project identifier' },
		{ name: 'pmType', group: 'PM', description: 'PM type: trello or jira' },
		{ name: 'workItemNoun', group: 'PM', description: 'card or issue' },
		{ name: 'workItemNounPlural', group: 'PM', description: 'cards or issues' },
		{ name: 'workItemNounCap', group: 'PM', description: 'Card or Issue' },
		{ name: 'workItemNounPluralCap', group: 'PM', description: 'Cards or Issues' },
		{ name: 'pmName', group: 'PM', description: 'Trello or JIRA' },
		{ name: 'storiesListId', group: 'Splitting', description: 'Trello stories list ID' },
		{ name: 'processedLabelId', group: 'Splitting', description: 'Trello processed label ID' },
		{ name: 'prNumber', group: 'CI', description: 'Pull request number' },
		{ name: 'prBranch', group: 'CI', description: 'Pull request branch name' },
		{ name: 'repoFullName', group: 'CI', description: 'Repository full name (owner/repo)' },
		{ name: 'headSha', group: 'CI', description: 'HEAD commit SHA' },
		{ name: 'triggerType', group: 'CI', description: 'Trigger type identifier' },
		{ name: 'logDir', group: 'Debug', description: 'Debug log directory path' },
		{ name: 'originalCardId', group: 'Debug', description: 'Original card ID being debugged' },
		{ name: 'originalCardName', group: 'Debug', description: 'Original card name' },
		{ name: 'originalCardUrl', group: 'Debug', description: 'Original card URL' },
		{ name: 'detectedAgentType', group: 'Debug', description: 'Agent type from session log' },
		{ name: 'debugListId', group: 'Debug', description: 'Debug list ID for output cards' },
	];
}
