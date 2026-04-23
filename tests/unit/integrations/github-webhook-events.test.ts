/**
 * GitHub webhook event-list consistency guard.
 *
 * The router processes events enumerated in `PROCESSABLE_EVENTS`
 * (`src/router/adapters/github.ts`). For CASCADE to receive those events from
 * GitHub, every processable event type must also appear in the
 * `GITHUB_WEBHOOK_EVENTS` array used when programmatically creating webhooks
 * (`src/api/routers/webhooks/github.ts`).
 *
 * This test prevents drift between the two lists. If a new event type is
 * added to `PROCESSABLE_EVENTS` but forgotten in `GITHUB_WEBHOOK_EVENTS`,
 * GitHub will never send that event payload to CASCADE — the trigger will
 * silently never fire, which is the root cause this guard catches.
 *
 * Root-cause example: `pull_request_review_comment` was processed by
 * `PRCommentMentionTrigger` but missing from the webhook creation list, so
 * inline review comments were silently ignored.
 */

import { describe, expect, it } from 'vitest';
import { GITHUB_WEBHOOK_EVENTS } from '../../../src/api/routers/webhooks/github.js';
import { PROCESSABLE_EVENTS } from '../../../src/router/adapters/github.js';

describe('GitHub webhook event-list consistency', () => {
	it('GITHUB_WEBHOOK_EVENTS contains every event in PROCESSABLE_EVENTS', () => {
		const missing = PROCESSABLE_EVENTS.filter((event) => !GITHUB_WEBHOOK_EVENTS.includes(event));

		expect(
			missing,
			`GITHUB_WEBHOOK_EVENTS is missing event(s) that are in PROCESSABLE_EVENTS: ${missing.join(', ')}. ` +
				`GitHub will never deliver these events to CASCADE unless they are included in the ` +
				`webhook creation payload. Add the missing events to GITHUB_WEBHOOK_EVENTS in ` +
				`src/api/routers/webhooks/github.ts.`,
		).toEqual([]);
	});

	it('GITHUB_WEBHOOK_EVENTS is a non-empty array', () => {
		expect(GITHUB_WEBHOOK_EVENTS.length).toBeGreaterThan(0);
	});

	it('PROCESSABLE_EVENTS is a non-empty array', () => {
		expect(PROCESSABLE_EVENTS.length).toBeGreaterThan(0);
	});
});
