/**
 * Progress model utility for generating natural-language progress summaries.
 *
 * Makes a one-shot LLM call to a lightweight model (e.g., Gemini 2.5 Flash Lite)
 * to produce a concise progress update based on accumulated agent state.
 */

import { AgentBuilder, LLMist, type ModelSpec } from 'llmist';

import type { Todo } from '../gadgets/todo/storage.js';

export interface ProgressContext {
	agentType: string;
	taskDescription: string;
	elapsedMinutes: number;
	iteration: number;
	maxIterations: number;
	todos: Todo[];
	recentToolCalls: { name: string; detail?: string; timestamp: number }[];
	recentTextSnippets?: { text: string; timestamp: number }[];
	completedTasks?: { subject: string; summary: string; timestamp: number }[];
}

const PROGRESS_SYSTEM_PROMPT = `You are a progress reporter for an AI coding agent called CASCADE. Write a brief, informative progress update based on the agent's current state. Be concise (3-5 sentences max). Focus on what has been accomplished, what's currently in progress, and what remains. Synthesize the agent's own commentary, tool call details (file paths, commands), and completed task summaries into a coherent narrative — do not just list tool names. Use markdown formatting. Write in first person (e.g. "I'm implementing...", "I've completed...", "I'm currently working on..."). Start with a bold header like "**Progress update** (X min)". Do not include a progress bar — the system adds that separately.`;

function formatProgressUserPrompt(context: ProgressContext): string {
	const {
		agentType,
		taskDescription,
		elapsedMinutes,
		iteration,
		todos,
		recentToolCalls,
		recentTextSnippets,
		completedTasks,
	} = context;

	const sections: string[] = [
		`Agent: ${agentType}`,
		`Task: ${taskDescription.slice(0, 500)}`,
		`Time elapsed: ${Math.round(elapsedMinutes)} minutes`,
		`Iterations: ${iteration}`,
	];

	// Todos — only include if there are any (avoids noise for claude-code backend)
	if (todos.length > 0) {
		const todoLines = todos
			.map((t) => {
				const icon = t.status === 'done' ? '✅' : t.status === 'in_progress' ? '🔄' : '⬜';
				return `${icon} ${t.content}`;
			})
			.join('\n');
		sections.push(`\n## Todo List\n${todoLines}`);
	}

	// Recent activity with tool details (file paths, commands)
	if (recentToolCalls.length > 0) {
		const activityLines = recentToolCalls
			.slice(-10)
			.map((tc) => (tc.detail ? `${tc.name}: ${tc.detail}` : tc.name))
			.join('\n');
		sections.push(`\n## Recent Activity\n${activityLines}`);
	}

	// Agent commentary — what the LLM said it's doing
	if (recentTextSnippets && recentTextSnippets.length > 0) {
		const commentaryLines = recentTextSnippets
			.slice(-5)
			.map((s) => s.text)
			.join('\n---\n');
		sections.push(`\n## My Recent Commentary\n${commentaryLines}`);
	}

	// Completed tasks — subagent task summaries
	if (completedTasks && completedTasks.length > 0) {
		const taskLines = completedTasks
			.map((t) => {
				const label = t.subject ? `**${t.subject}**: ` : '';
				return `- ${label}${t.summary}`;
			})
			.join('\n');
		sections.push(`\n## Completed Tasks\n${taskLines}`);
	}

	return sections.join('\n');
}

/**
 * Call a lightweight LLM to generate a natural-language progress summary.
 *
 * @param model - Model identifier (e.g., 'openrouter:google/gemini-2.5-flash-lite')
 * @param context - Current agent progress state
 * @param customModels - Custom model specs for llmist
 * @returns The generated progress summary text
 * @throws On any failure (caller handles fallback)
 */
export async function callProgressModel(
	model: string,
	context: ProgressContext,
	customModels: ModelSpec[],
): Promise<string> {
	const client = new LLMist({ customModels });

	const builder = new AgentBuilder(client)
		.withModel(model)
		.withTemperature(0)
		.withSystem(PROGRESS_SYSTEM_PROMPT)
		.withMaxIterations(1)
		.withGadgets();

	const agent = builder.ask(formatProgressUserPrompt(context));

	const outputLines: string[] = [];
	for await (const event of agent.run()) {
		if (event.type === 'text' && event.content) {
			outputLines.push(event.content);
		}
	}

	const output = outputLines.join('\n').trim();
	if (!output) {
		throw new Error('Progress model returned empty output');
	}

	return output;
}
