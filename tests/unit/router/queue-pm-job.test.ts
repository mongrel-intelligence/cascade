/**
 * Tests for the unified PMJob type in router/queue.ts
 *
 * Verifies that PMJob is correctly typed and included in CascadeJob,
 * and that the type discriminator works as expected.
 */
import { describe, expect, it } from 'vitest';
import type { CascadeJob, PMJob } from '../../../src/router/queue.js';

describe('PMJob type', () => {
	it('creates a valid PMJob with all required fields', () => {
		const job: PMJob = {
			type: 'pm',
			source: 'trello',
			payload: { action: { type: 'commentCard' } },
			projectId: 'proj-123',
			workItemId: 'card-456',
			eventType: 'commentCard',
			receivedAt: new Date().toISOString(),
		};

		expect(job.type).toBe('pm');
		expect(job.source).toBe('trello');
		expect(job.projectId).toBe('proj-123');
		expect(job.workItemId).toBe('card-456');
		expect(job.eventType).toBe('commentCard');
	});

	it('creates a PMJob without optional fields', () => {
		const job: PMJob = {
			type: 'pm',
			source: 'jira',
			payload: {},
			projectId: 'proj-jira',
			eventType: 'jira:issue_updated',
			receivedAt: new Date().toISOString(),
		};

		expect(job.type).toBe('pm');
		expect(job.workItemId).toBeUndefined();
		expect(job.ackCommentId).toBeUndefined();
		expect(job.triggerResult).toBeUndefined();
	});

	it('accepts any PM provider in the source field', () => {
		const providers = ['trello', 'jira', 'linear', 'future-provider'];
		for (const source of providers) {
			const job: PMJob = {
				type: 'pm',
				source,
				payload: {},
				projectId: 'proj1',
				eventType: 'test',
				receivedAt: new Date().toISOString(),
			};
			expect(job.source).toBe(source);
		}
	});

	it('is assignable to CascadeJob via type discriminator', () => {
		const pmJob: PMJob = {
			type: 'pm',
			source: 'linear',
			payload: {},
			projectId: 'proj1',
			eventType: 'create/Issue',
			receivedAt: new Date().toISOString(),
		};

		// PMJob should be assignable to CascadeJob
		const cascadeJob: CascadeJob = pmJob;
		expect(cascadeJob.type).toBe('pm');
	});

	it('discriminates correctly as type pm in switch/narrowing', () => {
		const job: CascadeJob = {
			type: 'pm',
			source: 'trello',
			payload: { data: true },
			projectId: 'proj-abc',
			workItemId: 'card-xyz',
			eventType: 'commentCard',
			receivedAt: '2026-01-01T00:00:00Z',
			ackCommentId: 'comment-id-123',
		};

		if (job.type === 'pm') {
			// TypeScript should narrow this to PMJob in this branch
			expect(job.source).toBe('trello');
			expect(job.projectId).toBe('proj-abc');
			expect(job.ackCommentId).toBe('comment-id-123');
		} else {
			throw new Error('Should not reach here');
		}
	});
});
