/**
 * PM (Project Management) progress comment poster.
 *
 * Manages the create-once/update-in-place/fallback-to-new lifecycle
 * for progress comments on Trello/JIRA work items. Handles state file
 * coordination with the PostComment gadget subprocess.
 */

import { INITIAL_MESSAGES } from '../../config/agentMessages.js';
import { getPMProviderOrNull } from '../../pm/index.js';
import { readProgressCommentId, writeProgressCommentId } from '../progressState.js';
import type { LogWriter } from '../types.js';

export interface PMProgressPosterConfig {
	agentType: string;
	cardId: string;
	repoDir?: string;
	logWriter: LogWriter;
}

export class PMProgressPoster {
	private progressCommentId: string | null = null;

	constructor(private readonly config: PMProgressPosterConfig) {}

	getCommentId(): string | null {
		return this.progressCommentId;
	}

	setCommentId(commentId: string): void {
		this.progressCommentId = commentId;
	}

	private formatInitialMessage(): string {
		return (
			INITIAL_MESSAGES[this.config.agentType] ??
			`**🚀 Starting** (${this.config.agentType})\n\nWorking on this now. Progress updates will follow...`
		);
	}

	private maybeWriteStateFile(commentId: string | null): void {
		if (this.config.repoDir && commentId) {
			writeProgressCommentId(this.config.repoDir, this.config.cardId, commentId);
		}
	}

	async postInitial(): Promise<void> {
		const provider = getPMProviderOrNull();
		if (!provider) return;

		const message = this.formatInitialMessage();
		this.progressCommentId = await provider.addComment(this.config.cardId, message);
		this.config.logWriter('INFO', 'Posted initial progress comment to work item', {
			cardId: this.config.cardId,
			commentId: this.progressCommentId,
		});

		// Write state file so PostComment gadget can update this comment
		this.maybeWriteStateFile(this.progressCommentId);
	}

	async update(summary: string): Promise<void> {
		const provider = getPMProviderOrNull();
		if (!provider) return;

		const { cardId } = this.config;

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
				this.maybeWriteStateFile(this.progressCommentId);
			}
		} else {
			// First tick: create the comment and store its ID.
			// This branch is reached when postInitial() failed (transient API error)
			// and the first tick creates the comment instead.
			this.progressCommentId = await provider.addComment(cardId, summary);
			this.config.logWriter('INFO', 'Posted progress update to work item', {
				cardId,
				commentId: this.progressCommentId,
			});
			// Write state file so PostComment gadget can find this comment
			this.maybeWriteStateFile(this.progressCommentId);
		}
	}
}
