/**
 * Trigger handler registration — safe to import from the router.
 *
 * This module only imports the trigger handler classes (pure logic, no API
 * clients). It does NOT import webhook handlers, which transitively pull in
 * the full agent execution pipeline (including .eta template files that
 * aren't present in the router Docker image).
 *
 * The barrel `./index.ts` re-exports both trigger handlers AND webhook
 * handlers, so importing from it at module scope in the router would cause
 * the router to crash with ENOENT on template files.
 */

import { CheckSuiteFailureTrigger } from './github/check-suite-failure.js';
import { CheckSuiteSuccessTrigger } from './github/check-suite-success.js';
import { PRCommentMentionTrigger } from './github/pr-comment-mention.js';
import { PRMergedTrigger } from './github/pr-merged.js';
import { PROpenedTrigger } from './github/pr-opened.js';
import { PRReadyToMergeTrigger } from './github/pr-ready-to-merge.js';
import { PRReviewSubmittedTrigger } from './github/pr-review-submitted.js';
import { ReviewRequestedTrigger } from './github/review-requested.js';
import { JiraCommentMentionTrigger } from './jira/comment-mention.js';
import { JiraIssueTransitionedTrigger } from './jira/issue-transitioned.js';
import { JiraReadyToProcessLabelTrigger } from './jira/label-added.js';
import type { TriggerRegistry } from './registry.js';
import {
	CardMovedToBriefingTrigger,
	CardMovedToPlanningTrigger,
	CardMovedToTodoTrigger,
} from './trello/card-moved.js';
import { TrelloCommentMentionTrigger } from './trello/comment-mention.js';
import { ReadyToProcessLabelTrigger } from './trello/label-added.js';

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

	// JIRA: Comment @mention trigger (runs respond-to-planning-comment when bot is @mentioned)
	// Must be registered before issue transition trigger so it gets first crack at comment events
	registry.register(new JiraCommentMentionTrigger());

	// JIRA: Issue transitioned trigger (runs briefing/planning/implementation based on status)
	registry.register(new JiraIssueTransitionedTrigger());

	// JIRA: Label trigger (runs agent based on current status when cascade-ready label is added)
	registry.register(new JiraReadyToProcessLabelTrigger());

	// GitHub: PR opened trigger (initial review on new PRs)
	// Opt-in: disabled by default via trigger config (github.triggers.prOpened = false)
	registry.register(new PROpenedTrigger());

	// GitHub: PR comment @mention trigger (runs respond-to-pr-comment when reviewer is @mentioned)
	// Must be registered before other comment triggers so it can intercept mentions and fall through otherwise
	registry.register(new PRCommentMentionTrigger());

	// GitHub: PR review submission trigger (when someone submits a review)
	registry.register(new PRReviewSubmittedTrigger());

	// GitHub: Review requested trigger (runs review agent when review is requested from CASCADE persona)
	// Opt-in: disabled by default via trigger config (github.triggers.reviewRequested = false)
	// Registered before CheckSuiteSuccessTrigger so both can independently trigger review
	registry.register(new ReviewRequestedTrigger());

	// GitHub: Check suite failure trigger (runs implementation agent to fix)
	registry.register(new CheckSuiteFailureTrigger());

	// GitHub: Check suite success trigger (runs review agent when CI passes)
	registry.register(new CheckSuiteSuccessTrigger());

	// GitHub: PR ready to merge trigger (auto-moves card to DONE)
	registry.register(new PRReadyToMergeTrigger());

	// GitHub: PR merged trigger (auto-moves card to MERGED)
	registry.register(new PRMergedTrigger());
}
