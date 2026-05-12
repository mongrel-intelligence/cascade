import { describe, expect, it } from 'vitest';
import { formatSentryCardBody } from '../../../../src/integrations/alerting/_shared/format.js';
import type { SentryAugmentedPayload } from '../../../../src/sentry/types.js';

const fixturePayload: SentryAugmentedPayload = {
	resource: 'event_alert',
	cascadeProjectId: 'test-project',
	payload: {
		action: 'triggered',
		data: {
			event: {
				issue_id: '117972276',
				web_url: 'https://sentry.io/organizations/acme/issues/117972276/',
				title: 'TypeError: Cannot read properties of undefined',
				timestamp: '2026-05-06T21:03:39Z',
				exception: {
					values: [
						{
							type: 'TypeError',
							value: "Cannot read properties of undefined (reading 'x')",
							stacktrace: {
								frames: [
									{
										filename: 'src/router/index.ts',
										function: 'processWebhook',
										lineno: 142,
										in_app: true,
									},
									{
										filename: 'node_modules/express/lib/router/index.js',
										function: 'Layer.handle',
										lineno: 95,
										in_app: false,
									},
								],
							},
						},
					],
				},
			},
			triggered_rule: 'My Alert Rule',
			issue_alert: {
				title: 'My Alert Rule',
			},
		},
	},
};

describe('formatSentryCardBody', () => {
	it('produces a title prefixed with [Sentry]', () => {
		const result = formatSentryCardBody(fixturePayload);
		expect(result.title).toMatch(/^\[Sentry\]/);
	});

	it('includes the Sentry issue permalink in the description', () => {
		const result = formatSentryCardBody(fixturePayload);
		expect(result.descriptionMarkdown).toContain('sentry.io');
	});

	it('includes the alert rule / title in the title or description', () => {
		const result = formatSentryCardBody(fixturePayload);
		const combined = result.title + result.descriptionMarkdown;
		expect(combined).toContain('My Alert Rule');
	});

	it('includes the timestamp (first-seen) in the description', () => {
		const result = formatSentryCardBody(fixturePayload);
		// Flexible check — the timestamp might be formatted differently
		expect(result.descriptionMarkdown).toMatch(/2026/);
	});

	it('includes the top in-app stack frame in the description', () => {
		const result = formatSentryCardBody(fixturePayload);
		expect(result.descriptionMarkdown).toContain('processWebhook');
	});

	it('does not use non-useful title candidates', () => {
		const result = formatSentryCardBody({
			...fixturePayload,
			payload: {
				...fixturePayload.payload,
				data: {
					...fixturePayload.payload.data,
					issue_alert: { title: 'undefined' },
					triggered_rule: '   ',
					event: { ...fixturePayload.payload.data.event, title: 'Real event title' },
				},
			},
		});

		expect(result.title).toBe('[Sentry] Real event title');
		expect(result.title).not.toContain('undefined');
	});
});
