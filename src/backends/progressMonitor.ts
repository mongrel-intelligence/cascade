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
import { INITIAL_MESSAGES } from '../config/agentMessages.js';
import { formatGitHubProgressComment, formatStatusMessage } from '../config/statusUpdateConfig.js';
import { getSessionState } from '../gadgets/sessionState.js';
import { loadTodos } from '../gadgets/todo/storage.js';
import { githubClient } from '../github/client.js';
import { getPMProviderOrNull } from '../pm/index.js';
import { captureException } from '../sentry.js';
import { type ProgressContext, callProgressModel } from './progressModel.js';
import {
	clearProgressCommentId,
	readProgressCommentId,
	writeProgressCommentId,
} from './progressState.js';
import type { LogWriter, ProgressReporter } from './types.js';

export interface ProgressMonitorConfig {
	agentType: string;
	taskDescription: string;
	intervalMinutes: number;
	progressModel: string;
	customModels: ModelSpec[];
	logWriter: LogWriter;
	repoDir?: string;
	trello?: { cardId: string };
	github?: { owner: string; repo: string; headerMessage: string };
	/** Pre-seeded comment ID from router ack — skip initial comment posting */
	preSeededCommentId?: string;
	/**
	 * Progressive schedule of delays (in minutes) before falling back to
	 * `intervalMinutes` for steady-state ticks.
	 * Example: [1, 3, 5] means first tick at 1min, second at 3min, third at 5min,
	 * then every `intervalMinutes` thereafter.
	 * Defaults to DEFAULT_SCHEDULE_MINUTES = [1, 3, 5].
	 */
	scheduleMinutes?: number[];
}

/** Default progressive schedule: 1min, 3min, 5min, then every intervalMinutes */
const DEFAULT_SCHEDULE_MINUTES = [1, 3, 5];

const PROGRESS_MODEL_TIMEOUT_MS = 20_000;
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
	private timer: ReturnType<typeof setTimeout> | null = null;
	private isGenerating = false;
	private progressCommentId: string | null = null;
	private initialCommentPromise: Promise<void> | null = null;
	private tickIndex = 0;
	private stopped = false;
	private started = false;
	private readonly schedule: number[];

	constructor(private readonly config: ProgressMonitorConfig) {
		this.schedule = config.scheduleMinutes ?? DEFAULT_SCHEDULE_MINUTES;
	}

	// ── Public accessors ──

	getProgressCommentId(): string | null {
		return this.progressCommentId;
	}

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
		if (this.started) return;
		this.started = true;
		this.startTime = Date.now();

		if (this.config.preSeededCommentId) {
			// Router already posted the ack comment — reuse its ID
			this.progressCommentId = this.config.preSeededCommentId;
			this.config.logWriter('INFO', 'Using pre-seeded ack comment ID from router', {
				commentId: this.progressCommentId,
			});

			// Write state file so PostComment gadget can find it
			if (this.config.repoDir && this.config.trello) {
				writeProgressCommentId(
					this.config.repoDir,
					this.config.trello.cardId,
					this.progressCommentId,
				);
			}
		} else {
			// Post initial comment immediately (fire-and-forget)
			this.initialCommentPromise = this.postInitialComment().catch((err) => {
				this.config.logWriter('WARN', 'Failed to post initial progress comment', {
					error: String(err),
				});
			});
		}

		// Start the progressive tick chain
		this.scheduleNextTick();
	}

	stop(): void {
		this.stopped = true;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		// Clean up state file on stop (best-effort — stop() is called from finally
		// blocks, so an rmSync failure must not mask the actual agent result)
		try {
			clearProgressCommentId(this.config.repoDir);
		} catch {
			// State file cleanup is best-effort
		}
	}

	// ── Internal ──

	/**
	 * Schedules the next tick using the progressive schedule.
	 * Uses schedule[tickIndex] if available, otherwise falls back to intervalMinutes.
	 */
	private scheduleNextTick(): void {
		const delayMinutes =
			this.tickIndex < this.schedule.length
				? this.schedule[this.tickIndex]
				: this.config.intervalMinutes;
		const delayMs = delayMinutes * 60 * 1000;
		this.timer = setTimeout(() => {
			void this.tickAndScheduleNext();
		}, delayMs);
	}

	/** Fires a tick, increments the counter, then schedules the next one. */
	private async tickAndScheduleNext(): Promise<void> {
		await this.tick();
		this.tickIndex++;
		// Only schedule next tick if stop() hasn't been called
		if (!this.stopped) {
			this.scheduleNextTick();
		}
	}

	private formatInitialMessage(): string {
		return (
			INITIAL_MESSAGES[this.config.agentType] ??
			`**🚀 Starting** (${this.config.agentType})\n\nWorking on this now. Progress updates will follow...`
		);
	}

	private async postInitialComment(): Promise<void> {
		if (!this.config.trello) return;

		const provider = getPMProviderOrNull();
		if (!provider) return;

		const message = this.formatInitialMessage();
		this.progressCommentId = await provider.addComment(this.config.trello.cardId, message);
		this.config.logWriter('INFO', 'Posted initial progress comment to work item', {
			cardId: this.config.trello.cardId,
			commentId: this.progressCommentId,
		});

		// Write state file so PostComment gadget can update this comment
		if (this.config.repoDir && this.progressCommentId) {
			writeProgressCommentId(
				this.config.repoDir,
				this.config.trello.cardId,
				this.progressCommentId,
			);
		}
	}

	private async tick(): Promise<void> {
		// Wait for initial comment to complete before proceeding so the first
		// tick updates the same comment instead of creating a duplicate
		if (this.initialCommentPromise) {
			await this.initialCommentPromise;
		}
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
				summary = await Promise.race([
					callProgressModel(this.config.progressModel, progressContext, this.config.customModels),
					new Promise<never>((_, reject) =>
						setTimeout(
							() => reject(new Error('Progress model timed out')),
							PROGRESS_MODEL_TIMEOUT_MS,
						),
					),
				]);
				this.config.logWriter('INFO', 'Progress model generated summary', {
					elapsedMinutes: Math.round(elapsedMinutes),
					summaryLength: summary.length,
				});
			} catch (err) {
				this.config.logWriter('WARN', 'Progress model failed, falling back to template', {
					error: String(err),
				});
				captureException(err instanceof Error ? err : new Error(String(err)), {
					tags: { source: 'progress_model', agentType: this.config.agentType },
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

	private maybeWriteStateFile(cardId: string, commentId: string | null): void {
		if (this.config.repoDir && commentId) {
			writeProgressCommentId(this.config.repoDir, cardId, commentId);
		}
	}

	private async postProgressToPM(summary: string, cardId: string): Promise<void> {
		const provider = getPMProviderOrNull();
		if (!provider) return;

		if (this.progressCommentId) {
			// If the PostComment gadget (subprocess) cleared the state file,
			// the agent has posted its final comment to this ID — do not overwrite.
			const stateFile = readProgressCommentId(this.config.repoDir);
			if (!stateFile) {
				this.config.logWriter('DEBUG', 'State file cleared by agent — skipping progress update', {
					commentId: this.progressCommentId,
				});
				this.progressCommentId = null;
				return;
			}

			// Subsequent ticks: update the existing comment.
			// On success, the state file written by postInitialComment() remains
			// valid (same comment ID), so no need to rewrite it here.
			try {
				await provider.updateComment(cardId, this.progressCommentId, summary);
				this.config.logWriter('INFO', 'Updated progress comment on work item', {
					cardId,
					commentId: this.progressCommentId,
				});
			} catch (updateErr) {
				// Comment may have been deleted — fall back to creating a new one
				this.config.logWriter('WARN', 'Failed to update progress comment, creating new one', {
					error: String(updateErr),
				});
				this.progressCommentId = await provider.addComment(cardId, summary);
				this.config.logWriter('INFO', 'Posted new progress comment to work item', {
					cardId,
					commentId: this.progressCommentId,
				});
				// Update state file with new comment ID
				this.maybeWriteStateFile(cardId, this.progressCommentId);
			}
		} else {
			// First tick: create the comment and store its ID.
			// This branch is reached when postInitialComment() failed (transient API error)
			// and the first tick creates the comment instead.
			this.progressCommentId = await provider.addComment(cardId, summary);
			this.config.logWriter('INFO', 'Posted progress update to work item', {
				cardId,
				commentId: this.progressCommentId,
			});
			// Write state file so PostComment gadget can find this comment
			this.maybeWriteStateFile(cardId, this.progressCommentId);
		}
	}

	private async postProgress(summary: string): Promise<void> {
		// Post to PM provider (Trello/JIRA) — create once, update in place
		if (this.config.trello) {
			try {
				await this.postProgressToPM(summary, this.config.trello.cardId);
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
