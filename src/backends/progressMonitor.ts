/**
 * Time-based progress monitor for CASCADE agents.
 *
 * Replaces iteration-based progress reporting with a timer that fires
 * every N minutes. On each tick, it gathers accumulated state, calls
 * a lightweight "progress model" to generate a natural-language summary,
 * and posts the result to Trello and/or GitHub.
 *
 * Falls back to the existing template-based formatStatusMessage() if
 * the progress model call fails.
 */

import type { ModelSpec } from 'llmist';

import { syncCompletedTodosToChecklist } from '../agents/utils/checklistSync.js';
import { formatGitHubProgressComment, formatStatusMessage } from '../config/statusUpdateConfig.js';
import { getSessionState } from '../gadgets/sessionState.js';
import { loadTodos } from '../gadgets/todo/storage.js';
import { githubClient } from '../github/client.js';
import { getPMProviderOrNull } from '../pm/index.js';
import { type ProgressContext, callProgressModel } from './progressModel.js';
import type { LogWriter, ProgressReporter } from './types.js';

export interface ProgressMonitorConfig {
	agentType: string;
	taskDescription: string;
	intervalMinutes: number;
	progressModel: string;
	customModels: ModelSpec[];
	logWriter: LogWriter;
	trello?: { cardId: string };
	github?: { owner: string; repo: string; headerMessage: string };
}

const RING_BUFFER_MAX = 20;
const TEXT_SNIPPETS_MAX = 10;
const COMPLETED_TASKS_MAX = 5;

/**
 * Extract a meaningful detail string from tool call params.
 * Returns file paths, commands, or search patterns — the most useful
 * context for progress reporting.
 */
function summarizeToolParams(_toolName: string, params?: Record<string, unknown>): string {
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

export class ProgressMonitor implements ProgressReporter {
	private recentToolCalls: { name: string; detail?: string; timestamp: number }[] = [];
	private recentTextSnippets: { text: string; timestamp: number }[] = [];
	private completedTasks: { subject: string; summary: string; timestamp: number }[] = [];
	private currentIteration = 0;
	private maxIterations = 0;
	private startTime = Date.now();
	private timer: ReturnType<typeof setInterval> | null = null;
	private isGenerating = false;

	constructor(private readonly config: ProgressMonitorConfig) {}

	// ── ProgressReporter interface (accumulate only, no posting) ──

	async onIteration(iteration: number, maxIterations: number): Promise<void> {
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
		this.config.logWriter('INFO', 'Tool call', { toolName, params });
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
		this.config.logWriter('INFO', 'Agent text output', { length: content.length });
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
		this.config.logWriter('INFO', 'Task completed', { taskId, subject });
	}

	// ── Lifecycle ──

	start(): void {
		if (this.timer) return;
		this.startTime = Date.now();
		const intervalMs = this.config.intervalMinutes * 60 * 1000;
		this.timer = setInterval(() => {
			void this.tick();
		}, intervalMs);
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	// ── Internal ──

	private async tick(): Promise<void> {
		if (this.isGenerating) return;
		this.isGenerating = true;

		try {
			const todos = loadTodos();
			const elapsedMinutes = (Date.now() - this.startTime) / 60_000;

			const progressContext: ProgressContext = {
				agentType: this.config.agentType,
				taskDescription: this.config.taskDescription,
				elapsedMinutes,
				iteration: this.currentIteration,
				maxIterations: this.maxIterations,
				todos,
				recentToolCalls: [...this.recentToolCalls],
				recentTextSnippets: [...this.recentTextSnippets],
				completedTasks: [...this.completedTasks],
			};

			let summary: string;
			try {
				summary = await callProgressModel(
					this.config.progressModel,
					progressContext,
					this.config.customModels,
				);
				this.config.logWriter('INFO', 'Progress model generated summary', {
					elapsedMinutes: Math.round(elapsedMinutes),
					summaryLength: summary.length,
				});
			} catch (err) {
				this.config.logWriter('WARN', 'Progress model failed, falling back to template', {
					error: String(err),
				});
				summary = formatStatusMessage(
					this.currentIteration,
					this.maxIterations,
					this.config.agentType,
				);
			}

			await this.postProgress(summary);

			// Sync checklist items for implementation agents
			if (this.config.agentType === 'implementation' && this.config.trello) {
				await syncCompletedTodosToChecklist(this.config.trello.cardId);
			}
		} catch (err) {
			this.config.logWriter('WARN', 'Progress tick failed', { error: String(err) });
		} finally {
			this.isGenerating = false;
		}
	}

	private async postProgress(summary: string): Promise<void> {
		// Post to PM provider (Trello/JIRA)
		if (this.config.trello) {
			try {
				const provider = getPMProviderOrNull();
				if (provider) {
					await provider.addComment(this.config.trello.cardId, summary);
					this.config.logWriter('INFO', 'Posted progress update to work item', {
						cardId: this.config.trello.cardId,
					});
				}
			} catch (err) {
				this.config.logWriter('WARN', 'Failed to post progress to work item', {
					error: String(err),
				});
			}
		}

		// Post to GitHub (update the initial PR comment)
		if (this.config.github) {
			const { initialCommentId } = getSessionState();
			if (initialCommentId) {
				try {
					const body = formatGitHubProgressComment(
						this.config.github.headerMessage,
						this.currentIteration,
						this.maxIterations,
						this.config.agentType,
					);
					// Replace the todo section with the AI-generated summary
					const bodyWithSummary = body.replace(/\n\n📋[\s\S]*?\n\n/, `\n\n${summary}\n\n`);
					await githubClient.updatePRComment(
						this.config.github.owner,
						this.config.github.repo,
						initialCommentId,
						bodyWithSummary,
					);
					this.config.logWriter('INFO', 'Updated GitHub PR comment with progress', {
						commentId: initialCommentId,
					});
				} catch (err) {
					this.config.logWriter('WARN', 'Failed to update GitHub PR comment', {
						error: String(err),
					});
				}
			}
		}
	}
}
