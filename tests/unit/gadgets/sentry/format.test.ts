import { describe, expect, it } from 'vitest';

import {
	formatSentryEvent,
	formatSentryEventList,
} from '../../../../src/gadgets/sentry/core/format.js';
import type { SentryEvent } from '../../../../src/sentry/types.js';

function makeRestEvent(): SentryEvent {
	return {
		id: 'numeric-event-id',
		eventID: 'abcdef1234567890',
		title: 'TypeError: object is not iterable',
		dateCreated: '2026-05-11T12:00:00Z',
		environment: 'production',
		release: { version: 'api@1.2.3' },
		platform: 'javascript',
		transaction: '/api/items',
		level: 'error',
		tags: [
			{ key: 'environment', value: 'production' },
			{ key: 'runtime', value: 'node' },
			{ key: undefined, value: 'skipped' },
		],
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
										colNo: 7,
										inApp: true,
										absPath: '/app/src/worker.ts',
										context: [
											[40, 'const tags = event.tags;'],
											[41, 'for (const tag of tags) {'],
											[42, '  const [key, value] = tag;'],
											[43, '  render(key, value);'],
										],
										vars: { issueId: '119054737' },
									},
								],
							},
						},
					],
				},
			},
			{
				type: 'breadcrumbs',
				data: {
					values: [
						{
							timestamp: '2026-05-11T11:59:59Z',
							level: 'info',
							category: 'http',
							message: 'GET /api/items',
						},
					],
				},
			},
			{
				type: 'request',
				data: {
					method: 'POST',
					url: 'https://example.com/api/items',
					queryString: 'debug=true',
					data: { filter: 'open' },
				},
			},
		],
		context: {
			runtime: { name: 'node', version: '20.0.0' },
		},
		contexts: {
			os: { name: 'Linux' },
			trace: { trace_id: 'trace-1' },
		},
	};
}

describe('formatSentryEvent', () => {
	it('formats Sentry REST issue-event responses without throwing', () => {
		const result = formatSentryEvent(makeRestEvent());

		expect(result).toContain('Event ID: abcdef1234567890');
		expect(result).toContain('Timestamp: 2026-05-11T12:00:00Z');
		expect(result).toContain('Release: api@1.2.3');
		expect(result).toContain('Tags: environment=production, runtime=node');
		expect(result).toContain('## Exception');
		expect(result).toContain('Exception: TypeError: object is not iterable');
		expect(result).toContain('Stacktrace');
		expect(result).toContain('Frame 0: runWorker [in_app]');
		expect(result).toContain('at src/worker.ts:42');
		expect(result).toContain('const [key, value] = tag;');
		expect(result).toContain('error here');
		expect(result).toContain('## Breadcrumbs');
		expect(result).toContain('GET /api/items');
		expect(result).toContain('## Request');
		expect(result).toContain('POST https://example.com/api/items');
		expect(result).toContain('Query: debug=true');
		expect(result).toContain('## Context');
		expect(result).toContain('runtime: {"name":"node","version":"20.0.0"}');
		expect(result).toContain('os: {"name":"Linux"}');
	});

	it('formats tuple-array tags', () => {
		const result = formatSentryEvent({
			title: 'Tuple tags',
			tags: [
				['environment', 'staging'],
				['release', 'abc123'],
			],
		});

		expect(result).toContain('Tags: environment=staging, release=abc123');
	});

	it('formats object-map tags', () => {
		const result = formatSentryEvent({
			title: 'Object tags',
			tags: {
				environment: 'production',
				handled: false,
			},
		});

		expect(result).toContain('Tags: environment=production, handled=false');
	});

	it('formats REST request query as tuple pairs', () => {
		const result = formatSentryEvent({
			title: 'REST query tuples',
			entries: [
				{
					type: 'request',
					data: {
						method: 'GET',
						url: 'https://example.com/api/items',
						query: [
							['page', '2'],
							['limit', '50'],
						],
					},
				},
			],
		});

		expect(result).toContain('## Request');
		expect(result).toContain('GET https://example.com/api/items');
		expect(result).toContain('Query: page=2&limit=50');
	});

	it('formats REST request query as a record', () => {
		const result = formatSentryEvent({
			title: 'REST query record',
			entries: [
				{
					type: 'request',
					data: {
						method: 'GET',
						url: 'https://example.com/api/search',
						query: { q: 'TypeError', sort: 'newest' },
					},
				},
			],
		});

		expect(result).toContain('Query: q=TypeError&sort=newest');
	});

	it('prefers query_string over query tuple pairs', () => {
		const result = formatSentryEvent({
			title: 'query_string wins',
			request: {
				method: 'GET',
				url: 'https://example.com/api',
				query_string: 'already=serialized',
				query: [['should', 'be-ignored']],
			},
		});

		expect(result).toContain('Query: already=serialized');
		expect(result).not.toContain('be-ignored');
	});
});

describe('formatSentryEventList', () => {
	it('uses event ID aliases', () => {
		const result = formatSentryEventList([
			{ eventID: 'eventid-alias', dateCreated: '2026-05-11T12:00:00Z' },
			{ event_id: 'event_id-alias', timestamp: '2026-05-11T12:01:00Z' },
			{ id: 'id-alias', received: '2026-05-11T12:02:00Z' },
		]);

		expect(result).toContain('[eventid-] 2026-05-11T12:00:00Z');
		expect(result).toContain('[event_id] 2026-05-11T12:01:00Z');
		expect(result).toContain('[id-alias] 2026-05-11T12:02:00Z');
	});
});
