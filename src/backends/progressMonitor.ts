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
 *
 * This class is a thin orchestrator that delegates to:
 * - ProgressAccumulator  — ring buffers for tool calls, text, tasks
 * - ProgressScheduler    — progressive timer scheduling
 * - PMProgressPoster     — PM comment create/update/fallback lifecycle
 * - GitHubProgressPoster — GitHub PR comment updates
 */

import type { ModelSpec } from 'llmist';

import { syncCompletedTodosToChecklist } from '../agents/utils/checklistSync.js';
import { formatStatusMessage } from '../config/statusUpdateConfig.js';
import { captureException } from '../sentry.js';
import { buildRunLink, buildWorkItemRunsLink, getDashboardUrl } from '../utils/runLink.js';
import { callProgressModel } from './progressModel.js';
import { clearProgressCommentId, writeProgressCommentId } from './progressState.js';
import { ProgressAccumulator } from './progressState/accumulator.js';
import { GitHubProgressPoster } from './progressState/githubPoster.js';
import { PMProgressPoster } from './progressState/pmPoster.js';
import { DEFAULT_SCHEDULE_MINUTES, ProgressScheduler } from './progressState/scheduler.js';
import type { LogWriter, ProgressReporter } from './types.js';

export interface ProgressMonitorConfig {
	agentType: string;
	taskDescription: string;
	intervalMinutes: number;
	progressModel: string;
	customModels: ModelSpec[];
	logWriter: LogWriter;
	repoDir?: string;
	trello?: { workItemId: string };
	github?: { owner: string; repo: string };
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
	/** Run link config — when set, appends a dashboard link to progress comments */
	runLink?: {
		runId?: string;
		engineLabel: string;
		model: string;
		projectId: string;
		workItemId?: string;
	};
}

const PROGRESS_MODEL_TIMEOUT_MS = 20_000;

export class ProgressMonitor implements ProgressReporter {
	private readonly accumulator: ProgressAccumulator;
	private readonly scheduler: ProgressScheduler;
	private readonly pmPoster: PMProgressPoster | null;
	private readonly githubPoster: GitHubProgressPoster | null;

	private isGenerating = false;
	private initialCommentPromise: Promise<void> | null = null;
	private started = false;

	constructor(private readonly config: ProgressMonitorConfig) {
		const schedule = config.scheduleMinutes ?? DEFAULT_SCHEDULE_MINUTES;

		this.accumulator = new ProgressAccumulator(config.logWriter);
		this.scheduler = new ProgressScheduler(schedule, config.intervalMinutes);

		this.pmPoster = config.trello
			? new PMProgressPoster({
					agentType: config.agentType,
					workItemId: config.trello.workItemId,
					logWriter: config.logWriter,
				})
			: null;

		this.githubPoster = config.github
			? new GitHubProgressPoster({
					owner: config.github.owner,
					repo: config.github.repo,
					logWriter: config.logWriter,
				})
			: null;
	}

	// ── Public accessors ──

	getProgressCommentId(): string | null {
		return this.pmPoster?.getCommentId() ?? null;
	}

	/** Update the run ID (available after the run record is created). */
	setRunId(runId: string): void {
		if (this.config.runLink) {
			this.config.runLink.runId = runId;
		}
	}

	// ── ProgressReporter interface (accumulate only, no posting) ──

	async onIteration(iteration: number, maxIterations: number): Promise<void> {
		this.accumulator.onIteration(iteration, maxIterations);
	}

	onToolCall(toolName: string, params?: Record<string, unknown>): void {
		this.accumulator.onToolCall(toolName, params);
	}

	onText(content: string): void {
		this.accumulator.onText(content);
	}

	onTaskCompleted(taskId: string, subject: string, summary: string): void {
		this.accumulator.onTaskCompleted(taskId, subject, summary);
	}

	// ── Lifecycle ──

	start(): void {
		if (this.started) return;
		this.started = true;

		if (this.config.preSeededCommentId) {
			// Router already posted the ack comment — reuse its ID
			this.pmPoster?.setCommentId(this.config.preSeededCommentId);
			this.config.logWriter('INFO', 'Using pre-seeded ack comment ID from router', {
				commentId: this.config.preSeededCommentId,
			});

			// Write env var so PostComment gadget can find it
			if (this.config.trello) {
				writeProgressCommentId(this.config.trello.workItemId, this.config.preSeededCommentId);
			}
		} else if (this.pmPoster) {
			// Post initial comment immediately (fire-and-forget)
			this.initialCommentPromise = this.pmPoster.postInitial().catch((err) => {
				this.config.logWriter('WARN', 'Failed to post initial progress comment', {
					error: String(err),
				});
			});
		}

		// Start the progressive tick chain
		this.scheduler.start(() => this.tick());
	}

	stop(): void {
		this.scheduler.stop();
		// Clean up env var on stop (best-effort — stop() is called from finally blocks)
		try {
			clearProgressCommentId();
		} catch {
			// Env var cleanup is best-effort
		}
	}

	// ── Internal ──

	private buildRunLinkFooter(): string {
		const { runLink } = this.config;
		if (!runLink) return '';

		const dashboardUrl = getDashboardUrl();
		if (!dashboardUrl) return '';

		if (runLink.runId) {
			return buildRunLink({
				dashboardUrl,
				runId: runLink.runId,
				engineLabel: runLink.engineLabel,
				model: runLink.model,
			});
		}

		if (runLink.workItemId) {
			return buildWorkItemRunsLink({
				dashboardUrl,
				projectId: runLink.projectId,
				workItemId: runLink.workItemId,
				engineLabel: runLink.engineLabel,
				model: runLink.model,
			});
		}

		return '';
	}

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: progress reporting with multiple posting targets
	private async tick(): Promise<void> {
		// Wait for initial comment to complete before proceeding so the first
		// tick updates the same comment instead of creating a duplicate
		if (this.initialCommentPromise) {
			await this.initialCommentPromise;
		}
		if (this.isGenerating) return;
		this.isGenerating = true;

		try {
			const progressContext = this.accumulator.getSnapshot(
				this.config.agentType,
				this.config.taskDescription,
			);

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
					elapsedMinutes: Math.round(progressContext.elapsedMinutes),
					summaryLength: summary.length,
				});
			} catch (err) {
				this.config.logWriter('WARN', 'Progress model failed, falling back to template', {
					error: String(err),
				});
				captureException(err instanceof Error ? err : new Error(String(err)), {
					tags: { source: 'progress_model', agentType: this.config.agentType },
				});
				summary = formatStatusMessage(this.config.agentType);
			}

			// Append run link footer if configured
			const runLinkFooter = this.buildRunLinkFooter();
			if (runLinkFooter) summary += runLinkFooter;

			// Post to PM provider (Trello/JIRA)
			if (this.pmPoster) {
				try {
					await this.pmPoster.update(summary);
				} catch (err) {
					this.config.logWriter('WARN', 'Failed to post progress to work item', {
						error: String(err),
					});
				}
			}

			// Post to GitHub
			if (this.githubPoster) {
				try {
					await this.githubPoster.update(summary);
				} catch (err) {
					this.config.logWriter('WARN', 'Failed to update GitHub PR comment', {
						error: String(err),
					});
				}
			}

			// Sync checklist items for implementation agents
			if (this.config.agentType === 'implementation' && this.config.trello) {
				await syncCompletedTodosToChecklist(this.config.trello.workItemId);
			}
		} catch (err) {
			this.config.logWriter('WARN', 'Progress tick failed', { error: String(err) });
		} finally {
			this.isGenerating = false;
		}
	}
}
