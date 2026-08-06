/**
 * GitLab acknowledgment comment helpers.
 *
 * Stub module for posting, updating, and deleting MR notes that acknowledge
 * incoming webhook events and report agent status.
 *
 * These operations require a GitLab API client (not yet implemented). The
 * functions are structured to match the GitHub ack-comments pattern so they
 * can be wired in once a GitLab client is available.
 */

import type { AgentResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import type { TriggerResult } from '../types.js';

/**
 * Post an acknowledgment note on a GitLab MR.
 *
 * Returns the note ID if successful, null otherwise.
 * Currently a no-op stub — requires GitLab API client.
 */
export async function postAcknowledgmentNote(
	_projectPath: string,
	_mrIid: number,
	_message: string,
): Promise<number | null> {
	logger.debug('GitLab ack note posting not yet implemented');
	return null;
}

/**
 * Update an existing MR note with an error message when the agent fails.
 * Currently a no-op stub — requires GitLab API client.
 */
export async function updateNoteWithError(
	_projectPath: string,
	_mrIid: number,
	_noteId: number,
	_error: string,
): Promise<void> {
	logger.debug('GitLab note update not yet implemented');
}

/**
 * Delete the progress note after a successful agent run.
 * Currently a no-op stub — requires GitLab API client.
 */
export async function deleteProgressNoteOnSuccess(
	_result: TriggerResult,
	_agentResult: AgentResult,
): Promise<void> {
	logger.debug('GitLab progress note deletion not yet implemented');
}

/**
 * Update the initial MR note with an error message when the agent fails.
 * Currently a no-op stub — requires GitLab API client.
 */
export async function updateInitialNoteWithError(
	_result: TriggerResult,
	_agentResult: { success: boolean; error?: string },
): Promise<void> {
	logger.debug('GitLab initial note error update not yet implemented');
}
