/**
 * Progress state accumulator for CASCADE agents.
 *
 * Accumulates tool calls, text snippets, completed tasks, and iteration
 * counts using ring buffers. Provides a snapshot of current progress
 * context for use by the progress model and posting layers.
 */

import { loadTodos } from '../../gadgets/todo/storage.js';
import type { ProgressContext } from '../progressModel.js';
import type { LogWriter } from '../types.js';

export const RING_BUFFER_MAX = 20;
export const TEXT_SNIPPETS_MAX = 10;
export const COMPLETED_TASKS_MAX = 5;

/**
 * Extract a meaningful detail string from tool call params.
 * Returns file paths, commands, or search patterns — the most useful
 * context for progress reporting.
 */
export function summarizeToolParams(_toolName: string, params?: Record<string, unknown>): string {
	if (!params) return '';
	if (params.file_path) return String(params.file_path);
	if (params.filePath) return String(params.filePath);
	if (params.command) return String(params.command).slice(0, 100);
	if (params.pattern) {
		const detail = String(params.pattern);
		return params.path ? `${detail} in ${params.path}` : detail;
	}
	return '';
}

export class ProgressAccumulator {
	private recentToolCalls: { name: string; detail?: string; timestamp: number }[] = [];
	private recentTextSnippets: { text: string; timestamp: number }[] = [];
	private completedTasks: { subject: string; summary: string; timestamp: number }[] = [];
	private currentIteration = 0;
	private maxIterations = 0;
	private readonly startTime = Date.now();

	constructor(private readonly logWriter: LogWriter) {}

	onIteration(iteration: number, maxIterations: number): void {
		this.currentIteration = iteration;
		this.maxIterations = maxIterations;
	}

	onToolCall(toolName: string, params?: Record<string, unknown>): void {
		const detail = summarizeToolParams(toolName, params);
		this.recentToolCalls.push({
			name: toolName,
			detail: detail || undefined,
			timestamp: Date.now(),
		});
		if (this.recentToolCalls.length > RING_BUFFER_MAX) {
			this.recentToolCalls.shift();
		}
		this.logWriter('INFO', 'Tool call', { toolName, params });
	}

	onText(content: string): void {
		if (content.trim()) {
			this.recentTextSnippets.push({
				text: content.slice(0, 200),
				timestamp: Date.now(),
			});
			if (this.recentTextSnippets.length > TEXT_SNIPPETS_MAX) {
				this.recentTextSnippets.shift();
			}
		}
		this.logWriter('INFO', 'Agent text output', { length: content.length });
	}

	onTaskCompleted(taskId: string, subject: string, summary: string): void {
		this.completedTasks.push({
			subject,
			summary: summary.slice(0, 300),
			timestamp: Date.now(),
		});
		if (this.completedTasks.length > COMPLETED_TASKS_MAX) {
			this.completedTasks.shift();
		}
		this.logWriter('INFO', 'Task completed', { taskId, subject });
	}

	getSnapshot(agentType: string, taskDescription: string): ProgressContext {
		const todos = loadTodos();
		const elapsedMinutes = (Date.now() - this.startTime) / 60_000;

		return {
			agentType,
			taskDescription,
			elapsedMinutes,
			iteration: this.currentIteration,
			maxIterations: this.maxIterations,
			todos,
			recentToolCalls: [...this.recentToolCalls],
			recentTextSnippets: [...this.recentTextSnippets],
			completedTasks: [...this.completedTasks],
		};
	}
}
