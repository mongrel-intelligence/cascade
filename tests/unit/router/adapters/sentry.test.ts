import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockLogger } from '../../../helpers/sharedMocks.js';

vi.mock('../../../../src/utils/logging.js', () => ({ logger: mockLogger }));

vi.mock('../../../../src/router/config.js', () => ({
	loadProjectConfig: vi.fn(),
}));

import { SentryRouterAdapter } from '../../../../src/router/adapters/sentry.js';
import { loadProjectConfig } from '../../../../src/router/config.js';
import type { RouterProjectConfig } from '../../../../src/router/config.js';
import type { SentryJob } from '../../../../src/router/queue.js';
import type { TriggerRegistry } from '../../../../src/triggers/registry.js';

// ============================================================================
// Test fixtures
// ============================================================================

const mockProject: RouterProjectConfig = {
	id: 'p1',
	repo: 'owner/repo',
	pmType: 'trello',
};

const mockFullProject = { id: 'p1', repo: 'owner/repo' };

const mockTriggerRegistry = {
	dispatch: vi.fn().mockResolvedValue({
		agentType: 'implementation',
		workItemId: undefined,
		prNumber: undefined,
	}),
} as unknown as TriggerRegistry;

const validEventAlertPayload = {
	resource: 'event_alert',
	payload: { action: 'triggered', data: { event: {} } },
	cascadeProjectId: 'p1',
};

const validMetricAlertPayload = {
	resource: 'metric_alert',
	payload: { action: 'critical', data: {} },
	cascadeProjectId: 'p1',
};

beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(loadProjectConfig).mockResolvedValue({
		projects: [mockProject],
		fullProjects: [mockFullProject as never],
	});
});

describe('SentryRouterAdapter', () => {
	let adapter: SentryRouterAdapter;

	beforeEach(() => {
		adapter = new SentryRouterAdapter();
	});

	describe('type', () => {
		it('has type "sentry"', () => {
			expect(adapter.type).toBe('sentry');
		});
	});

	describe('parseWebhook', () => {
		it('returns parsed event for event_alert resource', async () => {
			const result = await adapter.parseWebhook(validEventAlertPayload);

			expect(result).not.toBeNull();
			expect(result?.eventType).toBe('event_alert');
			expect(result?.projectIdentifier).toBe('p1');
			expect(result?.isCommentEvent).toBe(false);
			expect(result?.workItemId).toBeUndefined();
		});

		it('returns parsed event for metric_alert resource', async () => {
			const result = await adapter.parseWebhook(validMetricAlertPayload);

			expect(result).not.toBeNull();
			expect(result?.eventType).toBe('metric_alert');
			expect(result?.projectIdentifier).toBe('p1');
		});

		it('returns null when cascadeProjectId is missing', async () => {
			const payload = {
				resource: 'event_alert',
				payload: {},
				// cascadeProjectId missing
			};

			const result = await adapter.parseWebhook(payload);

			expect(result).toBeNull();
			expect(mockLogger.warn).toHaveBeenCalled();
		});

		it('returns null when resource is missing', async () => {
			const payload = {
				cascadeProjectId: 'p1',
				payload: {},
				// resource missing
			};

			const result = await adapter.parseWebhook(payload);

			expect(result).toBeNull();
			expect(mockLogger.warn).toHaveBeenCalled();
		});

		it('returns null when payload is missing', async () => {
			const payload = {
				resource: 'event_alert',
				cascadeProjectId: 'p1',
				// payload missing
			};

			const result = await adapter.parseWebhook(payload);

			expect(result).toBeNull();
			expect(mockLogger.warn).toHaveBeenCalled();
		});

		it('returns null for non-processable resource type "issue"', async () => {
			const payload = {
				resource: 'issue',
				payload: { action: 'created', data: {} },
				cascadeProjectId: 'p1',
			};

			const result = await adapter.parseWebhook(payload);

			expect(result).toBeNull();
			expect(mockLogger.debug).toHaveBeenCalled();
		});

		it('returns null for non-processable resource type "error"', async () => {
			const payload = {
				resource: 'error',
				payload: { data: {} },
				cascadeProjectId: 'p1',
			};

			const result = await adapter.parseWebhook(payload);

			expect(result).toBeNull();
		});
	});

	describe('isProcessableEvent', () => {
		it('returns true for event_alert', () => {
			const event = {
				projectIdentifier: 'p1',
				eventType: 'event_alert',
				isCommentEvent: false,
			};

			expect(adapter.isProcessableEvent(event)).toBe(true);
		});

		it('returns true for metric_alert', () => {
			const event = {
				projectIdentifier: 'p1',
				eventType: 'metric_alert',
				isCommentEvent: false,
			};

			expect(adapter.isProcessableEvent(event)).toBe(true);
		});

		it('returns false for "issue" resource', () => {
			const event = {
				projectIdentifier: 'p1',
				eventType: 'issue',
				isCommentEvent: false,
			};

			expect(adapter.isProcessableEvent(event)).toBe(false);
		});

		it('returns false for unknown event type', () => {
			const event = {
				projectIdentifier: 'p1',
				eventType: 'unknown_type',
				isCommentEvent: false,
			};

			expect(adapter.isProcessableEvent(event)).toBe(false);
		});
	});

	describe('isSelfAuthored', () => {
		it('always returns false (Sentry has no CASCADE bot)', async () => {
			const event = {
				projectIdentifier: 'p1',
				eventType: 'event_alert',
				isCommentEvent: false,
			};

			const result = await adapter.isSelfAuthored(event, {});

			expect(result).toBe(false);
		});
	});

	describe('sendReaction', () => {
		it('is a no-op (does not throw)', () => {
			const event = {
				projectIdentifier: 'p1',
				eventType: 'event_alert',
				isCommentEvent: false,
			};

			expect(() => adapter.sendReaction(event, {})).not.toThrow();
		});
	});

	describe('resolveProject', () => {
		it('returns project config when cascadeProjectId matches', async () => {
			vi.mocked(loadProjectConfig).mockResolvedValueOnce({
				projects: [mockProject, { id: 'p2', repo: 'other/repo', pmType: 'trello' }],
				fullProjects: [],
			});

			const result = await adapter.resolveProject({
				projectIdentifier: 'p1',
				eventType: 'event_alert',
				isCommentEvent: false,
				cascadeProjectId: 'p1',
			} as never);

			expect(result).toEqual(mockProject);
		});

		it('returns null when no project matches cascadeProjectId', async () => {
			vi.mocked(loadProjectConfig).mockResolvedValueOnce({
				projects: [mockProject],
				fullProjects: [],
			});

			const result = await adapter.resolveProject({
				projectIdentifier: 'nonexistent',
				eventType: 'event_alert',
				isCommentEvent: false,
				cascadeProjectId: 'nonexistent',
			} as never);

			expect(result).toBeNull();
		});
	});

	describe('dispatchWithCredentials', () => {
		it('dispatches to trigger registry when full project found', async () => {
			const mockTriggerResult = {
				agentType: 'implementation',
				workItemId: undefined,
				prNumber: undefined,
			};
			vi.mocked(mockTriggerRegistry.dispatch).mockResolvedValueOnce(mockTriggerResult);

			const event = {
				projectIdentifier: 'p1',
				eventType: 'event_alert',
				isCommentEvent: false,
			};

			const result = await adapter.dispatchWithCredentials(
				event,
				validEventAlertPayload,
				mockProject,
				mockTriggerRegistry,
			);

			expect(mockTriggerRegistry.dispatch).toHaveBeenCalledWith(
				expect.objectContaining({
					source: 'sentry',
					project: mockFullProject,
					payload: validEventAlertPayload,
				}),
			);
			expect(result).toEqual(mockTriggerResult);
		});

		it('returns null when full project is not found', async () => {
			vi.mocked(loadProjectConfig).mockResolvedValueOnce({
				projects: [mockProject],
				fullProjects: [], // no full project
			});

			const event = {
				projectIdentifier: 'p1',
				eventType: 'event_alert',
				isCommentEvent: false,
			};

			const result = await adapter.dispatchWithCredentials(
				event,
				validEventAlertPayload,
				mockProject,
				mockTriggerRegistry,
			);

			expect(result).toBeNull();
			expect(mockLogger.info).toHaveBeenCalledWith(
				'SentryRouterAdapter: no full project config found',
				expect.objectContaining({ projectId: 'p1' }),
			);
		});
	});

	describe('postAck', () => {
		it('returns undefined (no ack mechanism for Sentry)', async () => {
			const event = {
				projectIdentifier: 'p1',
				eventType: 'event_alert',
				isCommentEvent: false,
			};

			const result = await adapter.postAck(event, {}, mockProject, 'implementation');

			expect(result).toBeUndefined();
		});
	});

	describe('buildJob', () => {
		it('builds a SentryJob with all required fields', () => {
			const event = {
				projectIdentifier: 'p1',
				eventType: 'event_alert',
				isCommentEvent: false,
			};
			const triggerResult = {
				agentType: 'implementation',
				workItemId: undefined,
				prNumber: undefined,
			};

			const job = adapter.buildJob(
				event,
				validEventAlertPayload,
				mockProject,
				triggerResult,
			) as SentryJob;

			expect(job.type).toBe('sentry');
			expect(job.source).toBe('sentry');
			expect(job.projectId).toBe('p1');
			expect(job.eventType).toBe('event_alert');
			expect(job.payload).toEqual(validEventAlertPayload);
			expect(job.triggerResult).toEqual(triggerResult);
			expect(typeof job.receivedAt).toBe('string');
		});

		it('sets receivedAt to a valid ISO string', () => {
			const event = {
				projectIdentifier: 'p1',
				eventType: 'metric_alert',
				isCommentEvent: false,
			};
			const triggerResult = { agentType: 'implementation' };

			const job = adapter.buildJob(
				event,
				validMetricAlertPayload,
				mockProject,
				triggerResult as never,
			) as SentryJob;

			expect(() => new Date(job.receivedAt)).not.toThrow();
			expect(new Date(job.receivedAt).getFullYear()).toBeGreaterThan(2020);
		});

		it('uses event.eventType in the job', () => {
			const event = {
				projectIdentifier: 'p1',
				eventType: 'metric_alert',
				isCommentEvent: false,
			};

			const job = adapter.buildJob(event, validMetricAlertPayload, mockProject, {
				agentType: 'implementation',
			} as never) as SentryJob;

			expect(job.eventType).toBe('metric_alert');
		});
	});
});
