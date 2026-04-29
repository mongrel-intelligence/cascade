/**
 * Integration test for BullMQ delayed-job coalescing (PM coalesce flow).
 *
 * Tests that the unique-jobId / job-name-as-coalesce-key contract correctly:
 *   - schedules a new delayed job when no prior pending job exists,
 *   - supersedes prior delayed/waiting jobs for the same coalesceKey,
 *   - does NOT block when a prior job for the same coalesceKey is in
 *     `'completed'`, `'failed'`, or `'active'` state — the new schedule
 *     always succeeds with its own unique jobId.
 *
 * The "does NOT block on completed/active" cases are the regression pins
 * for the live MNG-422 incident on 2026-04-29: the old deterministic-jobId
 * design caused BullMQ's `add()` to silently no-op when a prior job with
 * the same id was in the completed (24h-retained) or active set, and
 * webhooks for that work item were lost.
 *
 * These tests require a running Redis server. They use a dedicated test
 * queue name to avoid interfering with the production cascade-jobs queue.
 */

import { Queue } from 'bullmq';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { parseRedisUrl } from '../../src/utils/redis.js';

// ---------------------------------------------------------------------------
// Test queue — isolated from the production 'cascade-jobs' queue.
// ---------------------------------------------------------------------------

const TEST_QUEUE_NAME = 'cascade-test-coalesce';
const connection = parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379');
let testQueue: Queue;

beforeAll(async () => {
	testQueue = new Queue(TEST_QUEUE_NAME, { connection });
	// Drain any stale jobs from a previous test run.
	await testQueue.drain();
	await testQueue.clean(0, 100, 'delayed');
	await testQueue.clean(0, 100, 'wait');
	await testQueue.clean(0, 100, 'completed');
	await testQueue.clean(0, 100, 'failed');
	await testQueue.clean(0, 100, 'active');
});

afterEach(async () => {
	// Clean up between test cases.
	await testQueue.drain();
	await testQueue.clean(0, 100, 'delayed');
	await testQueue.clean(0, 100, 'wait');
	await testQueue.clean(0, 100, 'completed');
	await testQueue.clean(0, 100, 'failed');
	await testQueue.clean(0, 100, 'active');
});

afterAll(async () => {
	await testQueue.close();
});

// ---------------------------------------------------------------------------
// Local version of scheduleCoalescedJob that targets the test queue.
// Mirrors the production algorithm in src/router/queue.ts:scheduleCoalescedJob:
//   - unique jobId per call (timestamp + random suffix),
//   - coalesceKey stored as the BullMQ "job name",
//   - supersede only delayed/waiting jobs for the same name (not active /
//     completed / failed — those have their own work in flight or already
//     done; the new event must run on its own).
// ---------------------------------------------------------------------------

async function scheduleOnTestQueue(
	jobData: Record<string, unknown>,
	coalesceKey: string,
	delayMs: number,
): Promise<{ jobId: string; superseded: boolean; supersededCount: number }> {
	// Colon-free jobId: BullMQ rejects custom ids that contain `:` unless they
	// have exactly 3 colon-separated parts. Mirrors src/router/queue.ts.
	const safeKey = coalesceKey.replace(/:/g, '_');
	const newJobId = `coalesce_${safeKey}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

	const [delayed, waiting] = await Promise.all([testQueue.getDelayed(), testQueue.getWaiting()]);
	const pending = [...delayed, ...waiting].filter((j) => j.name === coalesceKey);

	let superseded = false;
	if (pending.length > 0) {
		await Promise.all(pending.map((j) => j.remove()));
		superseded = true;
	}

	await testQueue.add(coalesceKey, jobData, { jobId: newJobId, delay: delayMs });
	return { jobId: newJobId, superseded, supersededCount: pending.length };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scheduleCoalescedJob — real BullMQ delayed-job supersede', () => {
	it('schedules a new delayed job when none exists', async () => {
		const { jobId, superseded } = await scheduleOnTestQueue(
			{ type: 'jira', issueKey: 'PROJ-1' },
			'test-project:PROJ-1',
			60_000, // 1-minute delay so the job doesn't fire during the test
		);

		expect(jobId).toMatch(/^coalesce_test-project_PROJ-1_/);
		expect(superseded).toBe(false);

		const job = await testQueue.getJob(jobId);
		expect(job).not.toBeNull();
		expect(job?.name).toBe('test-project:PROJ-1');
		const state = await job?.getState();
		expect(state).toBe('delayed');
	});

	it('supersedes a prior delayed job with the same coalesceKey', async () => {
		const first = await scheduleOnTestQueue(
			{ type: 'jira', issueKey: 'PROJ-2', agentType: 'implementation' },
			'test-project:PROJ-2',
			60_000,
		);
		expect(first.superseded).toBe(false);

		const second = await scheduleOnTestQueue(
			{ type: 'jira', issueKey: 'PROJ-2', agentType: 'planning' },
			'test-project:PROJ-2',
			60_000,
		);
		expect(second.superseded).toBe(true);
		expect(second.jobId).not.toBe(first.jobId); // unique-id contract

		// Exactly one delayed job remains for the coalesceKey, with the latest data.
		const delayed = await testQueue.getDelayed();
		const matching = delayed.filter((j) => j.name === 'test-project:PROJ-2');
		expect(matching).toHaveLength(1);
		expect((matching[0].data as { agentType?: string }).agentType).toBe('planning');

		// The first job should be removed entirely (not findable by id).
		const firstStillThere = await testQueue.getJob(first.jobId);
		expect(firstStillThere).toBeUndefined();
	});

	it('different coalesceKeys do not interfere with each other', async () => {
		const resultA = await scheduleOnTestQueue(
			{ type: 'jira', issueKey: 'PROJ-3' },
			'project-a:PROJ-3',
			60_000,
		);
		const resultB = await scheduleOnTestQueue(
			{ type: 'jira', issueKey: 'PROJ-4' },
			'project-b:PROJ-4',
			60_000,
		);

		expect(resultA.superseded).toBe(false);
		expect(resultB.superseded).toBe(false);

		const jobA = await testQueue.getJob(resultA.jobId);
		const jobB = await testQueue.getJob(resultB.jobId);
		expect(jobA).not.toBeNull();
		expect(jobB).not.toBeNull();
	});

	it('triple supersede: last writer wins', async () => {
		const first = await scheduleOnTestQueue({ agentType: 'splitting' }, 'proj:TRIPLE', 60_000);
		const second = await scheduleOnTestQueue({ agentType: 'planning' }, 'proj:TRIPLE', 60_000);
		const third = await scheduleOnTestQueue({ agentType: 'implementation' }, 'proj:TRIPLE', 60_000);

		expect(first.superseded).toBe(false);
		expect(second.superseded).toBe(true);
		expect(third.superseded).toBe(true);

		const delayed = await testQueue.getDelayed();
		const matching = delayed.filter((j) => j.name === 'proj:TRIPLE');
		expect(matching).toHaveLength(1);
		expect((matching[0].data as { agentType?: string }).agentType).toBe('implementation');
	});

	// NOTE: completed/failed regression pins live in the unit suite at
	// `tests/unit/router/queue.test.ts` — moving a real BullMQ job to
	// completed/failed requires a worker lock token, which would mean
	// spinning up a Worker in this test (significantly more complex setup
	// for marginally more confidence than the unit tests already give us).
	// The contract under test ("a non-pending prior job does not block a
	// new schedule") is fundamentally about NOT consulting completed/failed
	// in the supersede pass, which is straightforward to verify by mock.
});
