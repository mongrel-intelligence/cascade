import { CheckSuiteFailureTrigger } from './github/check-suite-failure.js';
import { CheckSuiteSuccessTrigger } from './github/check-suite-success.js';
import { PRCommentMentionTrigger } from './github/pr-comment-mention.js';
// import { PROpenedTrigger } from './github/pr-opened.js';
import { PRMergedTrigger } from './github/pr-merged.js';
import { PRReadyToMergeTrigger } from './github/pr-ready-to-merge.js';
import { PRReviewSubmittedTrigger } from './github/pr-review-submitted.js';
import type { TriggerRegistry } from './registry.js';
import { AttachmentAddedTrigger } from './trello/attachment-added.js';
import {
	CardMovedToBriefingTrigger,
	CardMovedToPlanningTrigger,
	CardMovedToTodoTrigger,
} from './trello/card-moved.js';
import { TrelloCommentMentionTrigger } from './trello/comment-mention.js';
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
	// Trello: Comment @mention trigger (runs respond-to-planning-comment when bot is @mentioned)
	// Must be registered before card-moved triggers so it gets first crack at comment events
	registry.register(new TrelloCommentMentionTrigger());

	// Trello: Card moved triggers (factory-created objects)
	registry.register(CardMovedToBriefingTrigger);
	registry.register(CardMovedToPlanningTrigger);
	registry.register(CardMovedToTodoTrigger);

	// Trello: Label triggers
	registry.register(new ReadyToProcessLabelTrigger());

	// Trello: Attachment triggers
	registry.register(new AttachmentAddedTrigger());

	// GitHub: PR opened trigger (initial review on new PRs)
	// DISABLED: Triggers respond-to-review which has file editing gadgets - needs review
	// registry.register(new PROpenedTrigger());

	// GitHub: PR comment @mention trigger (runs respond-to-pr-comment when reviewer is @mentioned)
	// Must be registered before other comment triggers so it can intercept mentions and fall through otherwise
	registry.register(new PRCommentMentionTrigger());

	// GitHub: PR review submission trigger (when someone submits a review)
	registry.register(new PRReviewSubmittedTrigger());

	// GitHub: Check suite failure trigger (runs implementation agent to fix)
	registry.register(new CheckSuiteFailureTrigger());

	// GitHub: Check suite success trigger (runs review agent when CI passes)
	registry.register(new CheckSuiteSuccessTrigger());

	// GitHub: PR ready to merge trigger (auto-moves card to DONE)
	registry.register(new PRReadyToMergeTrigger());

	// GitHub: PR merged trigger (auto-moves card to MERGED)
	registry.register(new PRMergedTrigger());
}
