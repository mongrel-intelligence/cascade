import { buildInlineContextSection, offloadLargeContext } from './contextFiles.js';
import type { ContextInjection, ToolManifest } from './types.js';

/**
 * Format a single CLI parameter for tool guidance documentation.
 */
function formatParam(
	key: string,
	schema: { type: string; required?: boolean; default?: unknown; description?: string },
): string {
	let result: string;
	if (schema.type === 'array') {
		const singular = key.replace(/s$/, '');
		result = schema.required
			? ` --${singular} <string> (repeatable)`
			: ` [--${singular} <string> (repeatable)]`;
	} else if (schema.type === 'boolean') {
		result = schema.default === true ? ` [--no-${key}]` : ` [--${key}]`;
	} else {
		result = schema.required ? ` --${key} <${schema.type}>` : ` [--${key} <${schema.type}>]`;
	}
	if (schema.description) {
		result += ` # ${schema.description}`;
	}
	return result;
}

/**
 * Build prompt guidance for CASCADE-specific CLI tools.
 * Native-tool engines invoke these via shell commands.
 */
export function buildToolGuidance(tools: ToolManifest[]): string {
	if (tools.length === 0) return '';

	let guidance = '## CASCADE Tools\n\n';
	guidance += 'Use the shell tool to invoke these CASCADE-specific commands.\n';
	guidance += 'All commands output JSON. Parse the output to extract results.\n\n';
	guidance +=
		'**CRITICAL**: You MUST use these cascade-tools commands for all PM (Trello/JIRA), SCM (GitHub), and session operations. ' +
		'Do NOT use `gh` CLI or other tools directly — native-tool engine runs block `gh`, and cascade-tools handle authentication, push, and ' +
		'state tracking that raw CLI tools do not. For example, `cascade-tools scm create-pr` pushes ' +
		'the branch AND creates the PR atomically.\n\n';

	for (const tool of tools) {
		guidance += `### ${tool.name}\n`;
		guidance += `${tool.description}\n`;
		guidance += `\`\`\`bash\n${tool.cliCommand}`;

		for (const [key, schema] of Object.entries(tool.parameters)) {
			guidance += formatParam(key, schema as { type: string; required?: boolean });
		}

		guidance += '\n```\n\n';
	}

	return guidance;
}

export interface BuildTaskPromptResult {
	prompt: string;
	hasOffloadedContext: boolean;
}

/**
 * Build the task prompt with pre-fetched context injections.
 * Large context is offloaded to files that the engine can read on demand.
 */
export async function buildTaskPrompt(
	taskPrompt: string,
	contextInjections: ContextInjection[],
	repoDir: string,
): Promise<BuildTaskPromptResult> {
	let prompt = taskPrompt;

	if (contextInjections.length === 0) {
		return { prompt, hasOffloadedContext: false };
	}

	const { inlineInjections, offloadedFiles, instructions } = await offloadLargeContext(
		repoDir,
		contextInjections,
	);

	prompt += buildInlineContextSection(inlineInjections);

	if (instructions) {
		prompt += `\n\n${instructions}`;
	}

	return {
		prompt,
		hasOffloadedContext: offloadedFiles.length > 0,
	};
}

/**
 * Build the system prompt by combining CASCADE's agent prompt with tool guidance.
 */
export function buildSystemPrompt(systemPrompt: string, tools: ToolManifest[]): string {
	const toolGuidance = buildToolGuidance(tools);
	return toolGuidance ? `${systemPrompt}\n\n${toolGuidance}` : systemPrompt;
}
