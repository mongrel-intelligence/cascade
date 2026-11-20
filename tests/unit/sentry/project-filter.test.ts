import { describe, expect, it } from 'vitest';
import {
	extractSentryPayloadProjects,
	matchSentryPayloadProject,
} from '../../../src/sentry/project-filter.js';
import type {
	SentryAugmentedPayload,
	SentryIssueAlertPayload,
	SentryIssuePayload,
	SentryMetricAlertPayload,
} from '../../../src/sentry/types.js';

function makeEventAlertPayload(
	eventOverrides: Partial<SentryIssueAlertPayload['data']['event']> = {},
): SentryAugmentedPayload {
	return {
		resource: 'event_alert',
		cascadeProjectId: 'cascade-project',
		payload: {
			action: 'triggered',
			data: {
				event: {
					id: 'event-1',
					issue_id: 'issue-1',
					project: 'api',
					...eventOverrides,
				},
			},
		},
	};
}

function makeMetricAlertPayload(
	projects: SentryMetricAlertPayload['data']['metric_alert']['projects'] = ['api'],
): SentryAugmentedPayload {
	return {
		resource: 'metric_alert',
		cascadeProjectId: 'cascade-project',
		payload: {
			action: 'critical',
			data: {
				metric_alert: {
					projects,
				},
			},
		},
	};
}

function makeIssuePayload(
	project?: SentryIssuePayload['data']['issue']['project'],
): SentryAugmentedPayload {
	const issueProject = project ?? {
		id: '4501',
		slug: 'api',
		name: 'API',
	};

	return {
		resource: 'issue',
		cascadeProjectId: 'cascade-project',
		payload: {
			action: 'created',
			data: {
				issue: {
					id: 'issue-1',
					title: 'Sentry Issue',
					project: issueProject,
				},
			},
		},
	};
}

function makeIssuePayloadWithoutProject(): SentryAugmentedPayload {
	return {
		resource: 'issue',
		cascadeProjectId: 'cascade-project',
		payload: {
			action: 'created',
			data: {
				issue: {
					id: 'issue-1',
					title: 'Sentry Issue',
				},
			},
		},
	};
}

describe('sentry/project-filter', () => {
	describe('extractSentryPayloadProjects', () => {
		it('extracts event_alert projects from event.project and slug variants', () => {
			const result = extractSentryPayloadProjects(
				makeEventAlertPayload({
					project: { id: '4501', slug: ' API ', name: 'Backend API' },
					project_slug: 'api-worker',
				}),
			);

			expect(result).toEqual([
				{
					id: '4501',
					slug: 'API',
					name: 'Backend API',
					source: 'data.event.project',
				},
				{
					slug: 'api-worker',
					source: 'data.event.project_slug',
				},
			]);
		});

		it('extracts a numeric event.project as an id and the slug from event.url', () => {
			const result = extractSentryPayloadProjects(
				makeEventAlertPayload({
					project: 6903,
					url: 'https://sentry.io/api/0/projects/my-org/api/events/7a2b9ed11efd4339a1d9dc3851915ab3/',
				}),
			);

			expect(result).toEqual([
				{ id: '6903', source: 'data.event.project' },
				{ slug: 'api', source: 'data.event.url' },
			]);
		});

		it('ignores an event.url that does not embed a project slug', () => {
			const result = extractSentryPayloadProjects(
				makeEventAlertPayload({ project: 6903, url: 'https://sentry.io/organizations/my-org/' }),
			);

			expect(result).toEqual([{ id: '6903', source: 'data.event.project' }]);
		});

		it('extracts metric_alert projects from every metric_alert.projects entry', () => {
			const result = extractSentryPayloadProjects(
				makeMetricAlertPayload([
					'web',
					{ id: '4501', slug: ' api ', name: 'Backend API' },
					{ project_slug: 'worker' },
				]),
			);

			expect(result).toEqual([
				{ slug: 'web', source: 'data.metric_alert.projects[0]' },
				{
					id: '4501',
					slug: 'api',
					name: 'Backend API',
					source: 'data.metric_alert.projects[1]',
				},
				{ slug: 'worker', source: 'data.metric_alert.projects[2]' },
			]);
		});

		it('extracts issue lifecycle project slug, id, and name', () => {
			const result = extractSentryPayloadProjects(
				makeIssuePayload({ id: '4501', slug: ' api ', name: 'Backend API' }),
			);

			expect(result).toEqual([
				{
					id: '4501',
					slug: 'api',
					name: 'Backend API',
					source: 'data.issue.project',
				},
			]);
		});
	});

	describe.each([
		{
			resource: 'event_alert',
			makePayload: () =>
				makeEventAlertPayload({
					project: { id: '4501', slug: ' API ', name: 'Backend API' },
				}),
			makeMissingPayloadProject: () =>
				makeEventAlertPayload({ project: undefined, project_slug: undefined }),
		},
		{
			resource: 'metric_alert',
			makePayload: () =>
				makeMetricAlertPayload(['web', { id: '4501', slug: ' API ', name: 'Backend API' }]),
			makeMissingPayloadProject: () => makeMetricAlertPayload([]),
		},
		{
			resource: 'issue',
			makePayload: () => makeIssuePayload({ id: '4501', slug: ' API ', name: 'Backend API' }),
			makeMissingPayloadProject: () => makeIssuePayloadWithoutProject(),
		},
	])('matchSentryPayloadProject for $resource', ({ makePayload, makeMissingPayloadProject }) => {
		it('allows a matching configured project slug case-insensitively', () => {
			const result = matchSentryPayloadProject(makePayload(), 'api');

			expect(result).toMatchObject({
				allowed: true,
				reason: 'matched',
				configuredProjectSlug: 'api',
			});
			expect(result.payloadProjects.length).toBeGreaterThan(0);
		});

		it('allows a matching configured project name case-insensitively', () => {
			const result = matchSentryPayloadProject(makePayload(), 'backend api');

			expect(result).toMatchObject({
				allowed: true,
				reason: 'matched',
				configuredProjectSlug: 'backend api',
			});
		});

		it('allows an exact project ID match when the payload includes an ID', () => {
			const result = matchSentryPayloadProject(makePayload(), '4501');

			expect(result).toMatchObject({
				allowed: true,
				reason: 'matched',
				configuredProjectSlug: '4501',
			});
		});

		it('returns a structured mismatch result when payload projects do not match', () => {
			const result = matchSentryPayloadProject(makePayload(), 'mobile');

			expect(result).toMatchObject({
				allowed: false,
				reason: 'project_mismatch',
				configuredProjectSlug: 'mobile',
			});
			expect(result.payloadProjects.length).toBeGreaterThan(0);
		});

		it('returns a structured result when configured project is missing', () => {
			const result = matchSentryPayloadProject(makePayload(), '  ');

			expect(result).toMatchObject({
				allowed: false,
				reason: 'missing_configured_project',
				configuredProjectSlug: null,
			});
			expect(result.payloadProjects.length).toBeGreaterThan(0);
		});

		it('allows an event_alert with a numeric project id when the event.url slug matches', () => {
			const result = matchSentryPayloadProject(
				makeEventAlertPayload({
					project: 6903,
					url: 'https://sentry.io/api/0/projects/my-org/api/events/abc/',
				}),
				'api',
			);

			expect(result).toMatchObject({ allowed: true, reason: 'matched' });
		});

		it('allows an event_alert with a numeric project id when it equals the configured value', () => {
			const result = matchSentryPayloadProject(makeEventAlertPayload({ project: 6903 }), '6903');

			expect(result).toMatchObject({ allowed: true, reason: 'matched' });
		});

		it('rejects an event_alert with a numeric project id from another project', () => {
			const result = matchSentryPayloadProject(
				makeEventAlertPayload({
					project: 7,
					url: 'https://sentry.io/api/0/projects/my-org/other/events/abc/',
				}),
				'api',
			);

			expect(result).toMatchObject({ allowed: false, reason: 'project_mismatch' });
		});

		it('returns a structured result when payload project is missing', () => {
			const result = matchSentryPayloadProject(makeMissingPayloadProject(), 'api');

			expect(result).toEqual({
				allowed: false,
				reason: 'missing_payload_project',
				configuredProjectSlug: 'api',
				payloadProjects: [],
			});
		});
	});
});
