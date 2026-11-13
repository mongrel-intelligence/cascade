import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../../src/db/client.js';
import {
	createSubscription,
	deleteSubscription,
	getEarliestEligibleAt,
	getSubscriptionProjectId,
	hasEnabledSubscription,
	listSubscriptions,
	recordSubscriptionUsage,
	selectBestSubscription,
	selectLeastExhaustedSubscription,
	setSubscriptionEnabled,
} from '../../../src/db/repositories/subscriptionsRepository.js';
import { projectSubscriptions } from '../../../src/db/schema/index.js';
import { truncateAll } from '../helpers/db.js';
import { seedOrg, seedProject, seedSubscription } from '../helpers/seed.js';

const HOUR = 60 * 60 * 1000;
const future = (ms = HOUR) => new Date(Date.now() + ms);
const past = (ms = HOUR) => new Date(Date.now() - ms);

async function getRow(id: number) {
	const [row] = await getDb()
		.select()
		.from(projectSubscriptions)
		.where(eq(projectSubscriptions.id, id));
	return row;
}

describe('subscriptionsRepository (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
		await seedProject();
	});

	describe('CRUD', () => {
		it('creates and lists subscriptions without exposing the token', async () => {
			const id = await createSubscription('test-project', 'Sub A', 'tok-a');
			const list = await listSubscriptions('test-project');
			expect(list).toHaveLength(1);
			expect(list[0]).toMatchObject({ id, name: 'Sub A', enabled: true, fiveHourPct: 0 });
			expect(list[0]).not.toHaveProperty('value');
			expect(list[0]).not.toHaveProperty('token');
		});

		it('round-trips the token through encryption', async () => {
			vi.stubEnv('CREDENTIAL_MASTER_KEY', 'a'.repeat(64));
			const id = await createSubscription('test-project', 'Sub A', 'tok-secret');
			expect((await getRow(id)).value).not.toBe('tok-secret');
			const selected = await selectBestSubscription('test-project');
			expect(selected).toEqual({ id, name: 'Sub A', token: 'tok-secret' });
			vi.unstubAllEnvs();
		});

		it('toggles, resolves project and deletes', async () => {
			const { id } = await seedSubscription();
			expect(await getSubscriptionProjectId(id)).toBe('test-project');
			expect(await getSubscriptionProjectId(999999)).toBeNull();
			await setSubscriptionEnabled(id, false);
			expect((await listSubscriptions('test-project'))[0].enabled).toBe(false);
			await deleteSubscription(id);
			expect(await listSubscriptions('test-project')).toEqual([]);
		});
	});

	describe('selectBestSubscription', () => {
		it('returns the lowest effective pct', async () => {
			await seedSubscription({ name: 'A', fiveHourPct: 50, fiveHourResetAt: future() });
			const b = await seedSubscription({ name: 'B', fiveHourPct: 10, fiveHourResetAt: future() });
			expect((await selectBestSubscription('test-project'))?.id).toBe(b.id);
		});

		it('breaks ties by lowest id', async () => {
			const a = await seedSubscription({ name: 'A' });
			await seedSubscription({ name: 'B' });
			expect((await selectBestSubscription('test-project'))?.id).toBe(a.id);
		});

		it('skips subscriptions at or above 95% in either window', async () => {
			await seedSubscription({ name: 'A', fiveHourPct: 95, fiveHourResetAt: future() });
			await seedSubscription({ name: 'B', sevenDayPct: 99, sevenDayResetAt: future() });
			const c = await seedSubscription({ name: 'C', fiveHourPct: 90, fiveHourResetAt: future() });
			expect((await selectBestSubscription('test-project'))?.id).toBe(c.id);
		});

		it('treats a window whose reset time has passed as 0%', async () => {
			const a = await seedSubscription({ name: 'A', fiveHourPct: 100, fiveHourResetAt: past() });
			await seedSubscription({ name: 'B', fiveHourPct: 20, fiveHourResetAt: future() });
			expect((await selectBestSubscription('test-project'))?.id).toBe(a.id);
		});

		it('honours excludeIds and skips disabled rows', async () => {
			const a = await seedSubscription({ name: 'A' });
			await seedSubscription({ name: 'B', enabled: false });
			const c = await seedSubscription({ name: 'C' });
			expect((await selectBestSubscription('test-project', [a.id]))?.id).toBe(c.id);
			expect(await selectBestSubscription('test-project', [a.id, c.id])).toBeNull();
		});

		it('returns null when no subscription exists', async () => {
			expect(await selectBestSubscription('test-project')).toBeNull();
		});
	});

	describe('selectLeastExhaustedSubscription', () => {
		it('returns the least exhausted row when all are above the threshold', async () => {
			await seedSubscription({ name: 'A', fiveHourPct: 100, fiveHourResetAt: future() });
			const b = await seedSubscription({ name: 'B', sevenDayPct: 96, sevenDayResetAt: future() });
			expect(await selectBestSubscription('test-project')).toBeNull();
			expect((await selectLeastExhaustedSubscription('test-project'))?.id).toBe(b.id);
		});

		it('skips disabled rows and returns null with no rows', async () => {
			expect(await selectLeastExhaustedSubscription('test-project')).toBeNull();
			await seedSubscription({ name: 'A', enabled: false });
			expect(await selectLeastExhaustedSubscription('test-project')).toBeNull();
		});
	});

	describe('hasEnabledSubscription', () => {
		it('is false with zero rows or only disabled rows, true with an enabled row', async () => {
			expect(await hasEnabledSubscription('test-project')).toBe(false);
			await seedSubscription({ name: 'A', enabled: false });
			expect(await hasEnabledSubscription('test-project')).toBe(false);
			await seedSubscription({ name: 'B' });
			expect(await hasEnabledSubscription('test-project')).toBe(true);
		});

		it('is scoped to the project', async () => {
			await seedProject({ id: 'other-project', repo: 'owner/other' });
			await seedSubscription({ projectId: 'other-project' });
			expect(await hasEnabledSubscription('test-project')).toBe(false);
		});
	});

	describe('recordSubscriptionUsage', () => {
		it('keeps the higher pct within the same reset window', async () => {
			const { id } = await seedSubscription();
			const reset = future();
			await recordSubscriptionUsage(id, 'five_hour', 80, reset);
			await recordSubscriptionUsage(id, 'five_hour', 60, reset);
			const row = await getRow(id);
			expect(row.fiveHourPct).toBe(80);
			expect(row.fiveHourResetAt?.getTime()).toBe(reset.getTime());
		});

		it('replaces the pct when the reset time changes', async () => {
			const { id } = await seedSubscription();
			await recordSubscriptionUsage(id, 'seven_day', 90, future());
			const next = future(2 * HOUR);
			await recordSubscriptionUsage(id, 'seven_day', 10, next);
			const row = await getRow(id);
			expect(row.sevenDayPct).toBe(10);
			expect(row.sevenDayResetAt?.getTime()).toBe(next.getTime());
		});

		it('clamps to 0-100 and rounds', async () => {
			const { id } = await seedSubscription();
			await recordSubscriptionUsage(id, 'five_hour', 150, future());
			expect((await getRow(id)).fiveHourPct).toBe(100);
			await recordSubscriptionUsage(id, 'seven_day', 42.6, future());
			expect((await getRow(id)).sevenDayPct).toBe(43);
		});
	});

	describe('getEarliestEligibleAt', () => {
		it('returns null when nothing is blocked', async () => {
			await seedSubscription({ name: 'A', fiveHourPct: 50, fiveHourResetAt: future() });
			expect(await getEarliestEligibleAt('test-project')).toBeNull();
		});

		it('uses the later of both blocking windows per row, earliest across rows', async () => {
			const a5 = future(HOUR);
			const a7 = future(5 * HOUR);
			await seedSubscription({
				name: 'A',
				fiveHourPct: 100,
				fiveHourResetAt: a5,
				sevenDayPct: 100,
				sevenDayResetAt: a7,
			});
			const b5 = future(3 * HOUR);
			await seedSubscription({ name: 'B', fiveHourPct: 100, fiveHourResetAt: b5 });
			expect((await getEarliestEligibleAt('test-project'))?.getTime()).toBe(b5.getTime());
		});
	});
});
