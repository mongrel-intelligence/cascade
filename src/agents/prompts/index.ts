import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Eta } from 'eta';

import { resolveKnownAgentTypes } from '../definitions/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(__dirname, 'templates');

// Initialize Eta with the templates directory
const eta = new Eta({ views: templatesDir, autoEscape: false });

// Standalone Eta instance for inline task prompts (no views directory needed)
const taskEta = new Eta({ autoEscape: false });

// Valid agent types — lazily resolved from DB (with YAML fallback), populated by initPrompts()
let validTypes: string[] = [];
let initialized = false;

function requireInitialized(name: string): void {
	if (!initialized) {
		throw new Error(
			`prompts: '${name}' was accessed before initPrompts() completed. Call initPrompts() at startup before using getSystemPrompt() or getRawTemplate().`,
		);
	}
}

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

	// PM list/column IDs
	backlogListId?: string;
	todoListId?: string;
	inProgressListId?: string;
	inReviewListId?: string;
	mergedListId?: string;
	processedLabelId?: string;
	autoLabelId?: string;

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

/**
 * Initialize the valid agent types list from the database (with YAML fallback).
 *
 * Must be called at startup before getSystemPrompt() or getRawTemplate() are used.
 * Safe to call multiple times (idempotent — overwrites with latest resolved list).
 */
export async function initPrompts(): Promise<void> {
	validTypes = await resolveKnownAgentTypes();
	initialized = true;
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
	requireInitialized('getSystemPrompt');
	if (!validTypes.includes(agentType)) {
		throw new Error(`Unknown agent type: ${agentType}`);
	}

	const template = loadTemplate(agentType);
	// Always resolve includes - resolveIncludes handles empty maps gracefully
	const expanded = resolveIncludes(template, dbPartials ?? new Map());
	return eta.renderString(expanded, context);
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

/**
 * Input interface for buildTaskPromptContext - accepts both AgentInput fields
 * and PromptContext fields for maximum flexibility.
 */
export interface TaskPromptInput {
	// Common fields
	cardId?: string;
	prNumber?: number;
	prBranch?: string;
	// PM comment trigger fields
	triggerCommentText?: string;
	triggerCommentAuthor?: string;
	// PR comment trigger fields
	triggerCommentBody?: string;
	triggerCommentPath?: string;
	// Email agent fields
	senderEmail?: string;
	// Allow extra fields for future extensibility
	[key: string]: unknown;
}

/**
 * Build a TaskPromptContext from AgentInput or combined PromptContext + AgentInput.
 * This is the canonical builder used by both profile.buildTaskPrompt() and resolveModelConfig().
 *
 * Null handling: all optional fields remain undefined when not present (no 'unknown' defaults).
 */
export function buildTaskPromptContext(input: TaskPromptInput): TaskPromptContext {
	return {
		cardId: input.cardId,
		prNumber: input.prNumber,
		prBranch: input.prBranch,
		commentText: input.triggerCommentText,
		commentAuthor: input.triggerCommentAuthor,
		commentBody: input.triggerCommentBody,
		commentPath: input.triggerCommentPath,
		senderEmail: input.senderEmail,
	};
}

/**
 * Render an inline task prompt template with Eta variable interpolation.
 * Used for task prompts stored directly in agent definitions (prompts.taskPrompt).
 */
export function renderInlineTaskPrompt(
	template: string,
	context: TaskPromptContext = {},
	dbPartials?: Map<string, string>,
): string {
	// Always resolve includes - resolveIncludes handles empty maps gracefully
	const expanded = resolveIncludes(template, dbPartials ?? new Map());
	return taskEta.renderString(expanded, context);
}

/** Returns the raw .eta template source from disk (before rendering). */
export function getRawTemplate(agentType: string): string {
	requireInitialized('getRawTemplate');
	if (!validTypes.includes(agentType)) {
		throw new Error(`Unknown agent type: ${agentType}`);
	}
	return loadTemplate(agentType);
}

/**
 * Read the raw .eta template file for an agent type without requiring initPrompts().
 * Safe to call during startup seeding or before the prompt system is initialized.
 * Returns undefined if the file does not exist.
 */
export function readTemplateFileSync(agentType: string): string | undefined {
	try {
		return readFileSync(join(templatesDir, `${agentType}.eta`), 'utf-8');
	} catch {
		return undefined;
	}
}

/** Returns the raw partial source from disk. */
export function getRawPartial(name: string): string {
	const diskPath = join(templatesDir, 'partials', `${name}.eta`);
	return readFileSync(diskPath, 'utf-8');
}

/**
 * Returns the list of valid agent types.
 *
 * Returns a snapshot of the current list; call initPrompts() at startup
 * to ensure DB-backed definitions are included.
 */
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

/** Returns template variable info for system prompts documentation/reference. */
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
		{ name: 'backlogListId', group: 'PM Lists', description: 'Backlog list/column ID' },
		{ name: 'todoListId', group: 'PM Lists', description: 'TODO list/column ID' },
		{ name: 'inProgressListId', group: 'PM Lists', description: 'In Progress list/column ID' },
		{ name: 'inReviewListId', group: 'PM Lists', description: 'In Review list/column ID' },
		{ name: 'mergedListId', group: 'PM Lists', description: 'Merged list/column ID' },
		{ name: 'processedLabelId', group: 'PM Labels', description: 'Processed label ID' },
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

/** Returns task prompt variable info for documentation/reference. */
export function getTaskTemplateVariables(): Array<{
	name: string;
	group: string;
	description: string;
}> {
	return [
		{ name: 'cardId', group: 'Work Item', description: 'Work item ID (card or issue)' },
		{ name: 'commentText', group: 'Comment', description: 'Comment text content (PM comments)' },
		{ name: 'commentAuthor', group: 'Comment', description: 'Comment author username' },
		{ name: 'prNumber', group: 'PR', description: 'Pull request number' },
		{ name: 'prBranch', group: 'PR', description: 'Pull request branch name' },
		{ name: 'commentBody', group: 'PR Comment', description: 'PR comment body text' },
		{ name: 'commentPath', group: 'PR Comment', description: 'File path for inline PR comments' },
		{ name: 'senderEmail', group: 'Email', description: 'Email sender address (email-joke agent)' },
	];
}
