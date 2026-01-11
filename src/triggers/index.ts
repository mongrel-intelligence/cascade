import { CheckSuiteFailureTrigger } from './github/check-suite-failure.js';
// import { PROpenedTrigger } from './github/pr-opened.js';
import { PRReadyToMergeTrigger } from './github/pr-ready-to-merge.js';
import { PRReviewCommentTrigger } from './github/pr-review-comment.js';
import { PRReviewSubmittedTrigger } from './github/pr-review-submitted.js';
import type { TriggerRegistry } from './registry.js';
import { AttachmentAddedTrigger } from './trello/attachment-added.js';
import {
	CardMovedToBriefingTrigger,
	CardMovedToPlanningTrigger,
	CardMovedToTodoTrigger,
} from './trello/card-moved.js';
import { ReadyToProcessLabelTrigger } from './trello/label-added.js';

export { type TriggerRegistry, createTriggerRegistry } from './registry.js';
export type {
	TriggerContext,
	TriggerHandler,
	TriggerResult,
	TrelloWebhookPayload,
} from './types.js';
export { isTrelloWebhookPayload } from './types.js';
export { processTrelloWebhook } from './trello/webhook-handler.js';
export { processGitHubWebhook } from './github/webhook-handler.js';

export function registerBuiltInTriggers(registry: TriggerRegistry): void {
	// Trello: Card moved triggers (factory-created objects)
	registry.register(CardMovedToBriefingTrigger);
	registry.register(CardMovedToPlanningTrigger);
	registry.register(CardMovedToTodoTrigger);

	// Trello: Label triggers
	registry.register(new ReadyToProcessLabelTrigger());

	// Trello: Attachment triggers
	registry.register(new AttachmentAddedTrigger());

	// GitHub: PR opened trigger (initial review on new PRs)
	// DISABLED: Triggers respond-to-review which has EditFile - needs review
	// registry.register(new PROpenedTrigger());

	// GitHub: PR review comment trigger
	registry.register(new PRReviewCommentTrigger());

	// GitHub: PR review submission trigger (when someone submits a review)
	registry.register(new PRReviewSubmittedTrigger());

	// GitHub: Check suite failure trigger (runs review agent to fix)
	registry.register(new CheckSuiteFailureTrigger());

	// GitHub: PR ready to merge trigger (auto-moves card to DONE)
	registry.register(new PRReadyToMergeTrigger());
}
