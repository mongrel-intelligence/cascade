/**
 * Tests for `formatSentryIssueLifecycleCardBody`, the format helper for the
 * `Sentry-Hook-Resource: issue` webhook surface (Internal Integration default).
 *
 * Mirrors the shape of `formatSentryCardBody` (event_alert) but pulls fields
 * from `data.issue.{id, title, web_url, level, shortId, culprit, metadata}`
 * instead of `data.event.{...}`. Captured shape from prod webhook id
 * `fbdc6d87-b962-444c-8a2a-a9452a74ff71` (2026-05-09 13:18:51 UTC).
 */

import { describe, expect, it } from 'vitest';

import { formatSentryIssueLifecycleCardBody } from '../../../../src/integrations/alerting/_shared/format.js';
import type { SentryAugmentedPayload, SentryIssuePayload } from '../../../../src/sentry/types.js';

function makeAugmented(
	overrides: Partial<SentryIssuePayload['data']['issue']> = {},
): SentryAugmentedPayload {
	const issue: SentryIssuePayload['data']['issue'] = {
		id: '118723355',
		title:
			'Error: wedged work-item lock: projectId=ucho workItemId=MNG-598 agentType=backlog-manager',
		culprit: 'POST /github/webhook',
		shortId: 'CASCADE-2T',
		level: 'error',
		issueType: 'error',
		web_url: 'https://mongrel.sentry.io/issues/118723355/',
		permalink: 'https://mongrel.sentry.io/issues/118723355/',
		metadata: {
			type: 'Error',
			value: 'wedged work-item lock: projectId=ucho workItemId=MNG-598 agentType=backlog-manager',
			filename: '/app/dist/router/webhook-dispatch-locks.js',
			function: 'checkDispatchLocks',
		},
		platform: 'node',
		priority: 'high',
		firstSeen: '2026-05-09T13:18:37.078000+00:00',
		...overrides,
	};
	return {
		resource: 'issue',
		cascadeProjectId: 'cascade',
		payload: {
			action: 'created',
			actor: { id: 'sentry', name: 'Sentry', type: 'application' },
			data: { issue },
		} as SentryIssuePayload,
	};
}

describe('formatSentryIssueLifecycleCardBody', () => {
	it('returns the prod-fixture title prefixed with [Sentry]', () => {
		const hints = formatSentryIssueLifecycleCardBody(makeAugmented());
		expect(hints.title.startsWith('[Sentry] ')).toBe(true);
		expect(hints.title).toContain('wedged work-item lock');
	});

	it('includes the web_url, level, short ID, and culprit in the description', () => {
		const hints = formatSentryIssueLifecycleCardBody(makeAugmented());
		expect(hints.descriptionMarkdown).toContain('https://mongrel.sentry.io/issues/118723355/');
		expect(hints.descriptionMarkdown).toContain('error'); // level
		expect(hints.descriptionMarkdown).toContain('CASCADE-2T'); // shortId
		expect(hints.descriptionMarkdown).toContain('POST /github/webhook'); // culprit
	});

	it('includes the top frame from metadata (filename:function)', () => {
		const hints = formatSentryIssueLifecycleCardBody(makeAugmented());
		expect(hints.descriptionMarkdown).toContain('/app/dist/router/webhook-dispatch-locks.js');
		expect(hints.descriptionMarkdown).toContain('checkDispatchLocks');
	});

	it('omits absent fields without leaving "undefined" placeholders', () => {
		const hints = formatSentryIssueLifecycleCardBody(
			makeAugmented({
				culprit: undefined,
				shortId: undefined,
				level: undefined,
				metadata: undefined,
			}),
		);
		expect(hints.descriptionMarkdown).not.toContain('undefined');
		expect(hints.descriptionMarkdown).not.toMatch(/Top frame:.*undefined/);
		expect(hints.descriptionMarkdown).not.toMatch(/Level:.*undefined/);
		expect(hints.descriptionMarkdown).not.toMatch(/Short ID:.*undefined/);
		expect(hints.descriptionMarkdown).not.toMatch(/Culprit:.*undefined/);
	});

	it('falls back to permalink when web_url is missing', () => {
		const hints = formatSentryIssueLifecycleCardBody(makeAugmented({ web_url: undefined }));
		expect(hints.descriptionMarkdown).toContain('https://mongrel.sentry.io/issues/118723355/');
	});

	it('uses a default title when the issue has none', () => {
		const hints = formatSentryIssueLifecycleCardBody(makeAugmented({ title: '' }));
		expect(hints.title).toBe('[Sentry] Sentry Issue');
	});

	it('returns a stable AlertHints shape', () => {
		const hints = formatSentryIssueLifecycleCardBody(makeAugmented());
		expect(Object.keys(hints).sort()).toEqual(['descriptionMarkdown', 'title']);
		expect(typeof hints.title).toBe('string');
		expect(typeof hints.descriptionMarkdown).toBe('string');
	});
});
