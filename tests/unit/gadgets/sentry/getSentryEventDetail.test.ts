import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SentryEvent } from '../../../../src/sentry/types.js';

const { mockGetIssueEvent, mockGetIssue } = vi.hoisted(() => ({
	mockGetIssueEvent: vi.fn(),
	mockGetIssue: vi.fn(),
}));

vi.mock('../../../../src/sentry/client.js', () => ({
	getSentryClient: vi.fn(() => ({
		getIssue: mockGetIssue,
		getIssueEvent: mockGetIssueEvent,
	})),
}));

import { getSentryEventDetail } from '../../../../src/gadgets/sentry/core/getSentryEventDetail.js';

function makeRestEvent(): SentryEvent {
	return {
		eventID: 'abcdef1234567890',
		title: 'TypeError: object is not iterable',
		dateCreated: '2026-05-11T12:00:00Z',
		tags: [{ key: 'environment', value: 'production' }],
		entries: [
			{
				type: 'exception',
				data: {
					values: [
						{
							type: 'TypeError',
							value: 'object is not iterable',
							stacktrace: {
								frames: [
									{
										filename: 'src/worker.ts',
										function: 'runWorker',
										lineNo: 42,
										inApp: true,
										context: [
											[41, 'for (const tag of tags) {'],
											[42, '  const [key, value] = tag;'],
										],
									},
								],
							},
						},
					],
				},
			},
		],
		contexts: {
			runtime: { name: 'node' },
		},
	};
}

describe('getSentryEventDetail', () => {
	beforeEach(() => {
		mockGetIssueEvent.mockReset();
		mockGetIssue.mockReset();
	});

	it('formats REST-shaped issue-event responses', async () => {
		mockGetIssueEvent.mockResolvedValueOnce(makeRestEvent());
		mockGetIssue.mockResolvedValueOnce({
			id: '119054737',
			title: 'TypeError group',
			permalink: 'https://sentry.io/organizations/mongrel/issues/119054737/',
			shortId: 'CASCADE-1',
		});

		const result = await getSentryEventDetail('mongrel', '119054737', 'latest');

		expect(mockGetIssueEvent).toHaveBeenCalledWith('mongrel', '119054737', 'latest');
		expect(mockGetIssue).toHaveBeenCalledWith('mongrel', '119054737');
		expect(result).toContain(
			'Sentry issue: https://sentry.io/organizations/mongrel/issues/119054737/',
		);
		expect(result).toContain('Issue ID: 119054737');
		expect(result).toContain('Short ID: CASCADE-1');
		expect(result).toContain('Event ID: abcdef1234567890');
		expect(result).toContain('Tags: environment=production');
		expect(result).toContain('## Exception');
		expect(result).toContain('Stacktrace');
		expect(result).toContain('## Context');
	});

	it('defaults eventId to latest', async () => {
		mockGetIssueEvent.mockResolvedValueOnce(makeRestEvent());
		mockGetIssue.mockResolvedValueOnce({ id: '119054737', title: 'TypeError group' });

		await getSentryEventDetail('mongrel', '119054737');

		expect(mockGetIssueEvent).toHaveBeenCalledWith('mongrel', '119054737', 'latest');
	});

	it('returns event details when issue metadata fetch fails', async () => {
		mockGetIssueEvent.mockResolvedValueOnce(makeRestEvent());
		mockGetIssue.mockRejectedValueOnce(new Error('Sentry issue metadata unavailable'));

		const result = await getSentryEventDetail('mongrel', '119054737', 'latest');

		expect(result).toContain('Event ID: abcdef1234567890');
		expect(result).not.toContain('Sentry issue:');
	});
});
