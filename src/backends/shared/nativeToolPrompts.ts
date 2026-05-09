import type { ContextInjection, ToolManifest } from '../types.js';
import { buildInlineContextSection, offloadLargeContext } from './contextFiles.js';

const NATIVE_TOOL_EXECUTION_RULES = `## Native Tool Execution Rules

You are operating in a native-tool environment, not a gadget/function-call environment.

- Never write pseudo tool calls such as \`[tool_call: ...]\`, \`ReadFile(...)\`, \`RipGrep(...)\`, \`Tmux(...)\`, \`CreatePR(...)\`, or similar function-call text in your assistant response.
- Use your built-in tools instead:
  - use built-in file/search tools or the shell tool for repository exploration
  - use the edit tool for file modifications
  - use the shell tool for all \`cascade-tools ...\`, \`git ...\`, \`rg ...\`, \`fd ...\`, test, lint, and build commands
- When the task instructions mention gadget names like \`CreatePR\`, \`PostComment\`, \`UpdateChecklistItem\`, \`Finish\`, \`ReadWorkItem\`, \`TodoUpsert\`, or \`TodoUpdateStatus\`, treat that as a request to run the equivalent real command or tool action, not to print the gadget name.
- If you catch yourself composing a pseudo tool call in plain text, stop and use the real tool instead.
- Trello, JIRA, and GitHub attachment URLs require backend authentication. NEVER curl, wget, or HTTP-fetch them — they return an authorization error. Work item images are pre-fetched and available either as images in your conversation context or as files under \`.cascade/context/images/\` — use whichever is present; never fetch the original URLs.`;

/**
 * Format a single CLI parameter for tool guidance documentation.
 *
 * Spec 014: the array branch previously stripped a trailing `s` and hard-coded
 * `<string> (repeatable)` for every array type regardless of item shape. That
 * was the root cause of prod run 5d993b04 — an agent sent `--comment` because
 * the prompt told it to. Now:
 *
 * - `items: 'object'` → renders `--<key> '<json>'` (single JSON blob, not
 *   repeatable), with aliases appended via `|` and one example line indented
 *   beneath the flag when the manifest provides `example`.
 * - `items: 'string'` or items missing → keeps the repeatable semantics but
 *   uses the actual key (no `s`-strip).
 * - `type: 'object'` → renders as a single `'<json>'` blob.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: parameter-type taxonomy
function formatParam(
	key: string,
	schema: {
		type: string;
		required?: boolean;
		default?: unknown;
		description?: string;
		items?: string;
		aliases?: readonly string[];
		example?: unknown;
	},
): string {
	const aliasSuffix = (schema.aliases ?? []).map((a) => `|--${a}`).join('');
	const flagHead = `--${key}${aliasSuffix}`;

	let result: string;
	if (schema.type === 'array' && schema.items === 'object') {
		result = schema.required ? ` ${flagHead} '<json>'` : ` [${flagHead} '<json>']`;
	} else if (schema.type === 'array') {
		// Primitive arrays (items: 'string' or unspecified) — repeatable.
		result = schema.required
			? ` ${flagHead} <string> (repeatable)`
			: ` [${flagHead} <string> (repeatable)]`;
	} else if (schema.type === 'object') {
		result = schema.required ? ` ${flagHead} '<json>'` : ` [${flagHead} '<json>']`;
	} else if (schema.type === 'boolean') {
		result = schema.default === true ? ` [--no-${key}]` : ` [${flagHead}]`;
	} else {
		result = schema.required ? ` ${flagHead} <${schema.type}>` : ` [${flagHead} <${schema.type}>]`;
	}

	if (schema.description) {
		result += ` # ${schema.description}`;
	}

	// Spec 014: surface a concrete shape beneath the flag so agents see a
	// copy/paste-ready JSON payload without having to run --help.
	//
	// Booleans are special: oclif's `Flags.boolean({ allowNo: true })` rejects
	// `--key 'true'` at parse time, so the example must mirror the canonical
	// CLI grammar (`--key` / `--no-key`) — never a quoted value. Prod regression
	// (2026-05-09): 9/14 codex runs hit `--includeComments true` because the
	// per-flag example said exactly that. The synopsis renders the toggle form;
	// the example reinforces it concretely.
	if (schema.example !== undefined) {
		if (schema.type === 'boolean') {
			result += schema.example ? `\n  # example: --${key}` : `\n  # example: --no-${key}`;
		} else {
			try {
				result += `\n  # example: --${key} '${JSON.stringify(schema.example)}'`;
			} catch {
				// JSON.stringify throws on cyclic refs — never in our tool definitions,
				// but be defensive so a malformed example never crashes prompt building.
			}
		}
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

	const { inlineInjections, offloadedFiles, offloadedImages, instructions } =
		await offloadLargeContext(repoDir, contextInjections);

	prompt += buildInlineContextSection(inlineInjections);

	if (instructions) {
		prompt += `\n\n${instructions}`;
	}

	return {
		prompt,
		hasOffloadedContext: offloadedFiles.length > 0 || offloadedImages.length > 0,
	};
}

/**
 * Build the system prompt by combining CASCADE's agent prompt with tool guidance.
 */
export function buildSystemPrompt(systemPrompt: string, tools: ToolManifest[]): string {
	const toolGuidance = buildToolGuidance(tools);
	const promptWithRules = `${NATIVE_TOOL_EXECUTION_RULES}\n\n${systemPrompt}`;
	return toolGuidance ? `${promptWithRules}\n\n${toolGuidance}` : promptWithRules;
}
