import { beforeEach, describe, expect, it } from 'vitest';
import {
	getWebhookLogById,
	getWebhookLogStats,
	insertWebhookLog,
	listWebhookLogs,
	pruneWebhookLogs,
} from '../../../src/db/repositories/webhookLogsRepository.js';
import { truncateAll } from '../helpers/db.js';
import { seedOrg, seedProject, seedWebhookLog } from '../helpers/seed.js';

describe('webhookLogsRepository (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
		await seedProject();
	});

	// =========================================================================
	// insertWebhookLog / getWebhookLogById
	// =========================================================================

	describe('insertWebhookLog', () => {
		it('inserts a webhook log and returns the ID', async () => {
			const id = await insertWebhookLog({
				source: 'trello',
				method: 'POST',
				path: '/webhooks/trello',
			});
			expect(id).toBeTruthy();
			expect(typeof id).toBe('string');
		});

		it('stores all fields including JSONB headers and body', async () => {
			const id = await insertWebhookLog({
				source: 'github',
				method: 'POST',
				path: '/webhooks/github',
				headers: { 'x-github-event': 'push', 'content-type': 'application/json' },
				body: { ref: 'refs/heads/main', repository: { full_name: 'owner/repo' } },
				bodyRaw: '{"ref":"refs/heads/main"}',
				statusCode: 200,
				projectId: 'test-project',
				eventType: 'push',
				processed: true,
			});

			const log = await getWebhookLogById(id);
			expect(log).toBeDefined();
			expect(log?.source).toBe('github');
			expect(log?.method).toBe('POST');
			expect(log?.path).toBe('/webhooks/github');
			expect((log?.headers as Record<string, unknown>)['x-github-event']).toBe('push');
			expect((log?.body as Record<string, unknown>).ref).toBe('refs/heads/main');
			expect(log?.bodyRaw).toBe('{"ref":"refs/heads/main"}');
			expect(log?.statusCode).toBe(200);
			expect(log?.projectId).toBe('test-project');
			expect(log?.eventType).toBe('push');
			expect(log?.processed).toBe(true);
		});

		it('defaults processed to false', async () => {
			const id = await insertWebhookLog({
				source: 'trello',
				method: 'POST',
				path: '/webhooks/trello',
			});
			const log = await getWebhookLogById(id);
			expect(log?.processed).toBe(false);
		});
	});

	describe('getWebhookLogById', () => {
		it('returns null for non-existent ID', async () => {
			const log = await getWebhookLogById('00000000-0000-0000-0000-000000000000');
			expect(log).toBeNull();
		});
	});

	// =========================================================================
	// listWebhookLogs
	// =========================================================================

	describe('listWebhookLogs', () => {
		it('returns all logs with total count', async () => {
			await seedWebhookLog({ source: 'trello' });
			await seedWebhookLog({ source: 'github' });
			await seedWebhookLog({ source: 'trello' });

			const result = await listWebhookLogs({ limit: 10, offset: 0 });
			expect(result.data).toHaveLength(3);
			expect(result.total).toBe(3);
		});

		it('filters by source', async () => {
			await seedWebhookLog({ source: 'trello' });
			await seedWebhookLog({ source: 'github' });
			await seedWebhookLog({ source: 'trello' });

			const result = await listWebhookLogs({ source: 'trello', limit: 10, offset: 0 });
			expect(result.data).toHaveLength(2);
			expect(result.data.every((l) => l.source === 'trello')).toBe(true);
		});

		it('filters by eventType', async () => {
			await seedWebhookLog({ source: 'trello', eventType: 'updateCard' });
			await seedWebhookLog({ source: 'trello', eventType: 'createCard' });
			await seedWebhookLog({ source: 'github', eventType: 'push' });

			const result = await listWebhookLogs({ eventType: 'updateCard', limit: 10, offset: 0 });
			expect(result.data).toHaveLength(1);
			expect(result.data[0].eventType).toBe('updateCard');
		});

		it('respects limit and offset for pagination', async () => {
			for (let i = 0; i < 5; i++) {
				await seedWebhookLog({ source: 'trello' });
			}

			const page1 = await listWebhookLogs({ limit: 2, offset: 0 });
			expect(page1.data).toHaveLength(2);
			expect(page1.total).toBe(5);

			const page2 = await listWebhookLogs({ limit: 2, offset: 2 });
			expect(page2.data).toHaveLength(2);
			expect(page2.total).toBe(5);
		});

		it('returns logs ordered by receivedAt descending', async () => {
			await seedWebhookLog({ source: 'trello', eventType: 'first' });
			await seedWebhookLog({ source: 'trello', eventType: 'second' });
			await seedWebhookLog({ source: 'trello', eventType: 'third' });

			const result = await listWebhookLogs({ limit: 10, offset: 0 });
			// Most recent first
			expect(result.data[0].eventType).toBe('third');
			expect(result.data[2].eventType).toBe('first');
		});

		it('filters by receivedAfter date', async () => {
			const before = new Date();
			before.setMinutes(before.getMinutes() - 10);
			const after = new Date();
			after.setMinutes(after.getMinutes() + 10);

			await seedWebhookLog({ source: 'trello' });

			const result = await listWebhookLogs({ receivedAfter: after, limit: 10, offset: 0 });
			expect(result.data).toHaveLength(0);
			expect(result.total).toBe(0);
		});
	});

	// =========================================================================
	// pruneWebhookLogs
	// =========================================================================

	describe('pruneWebhookLogs', () => {
		it('retains only the most recent N logs', async () => {
			for (let i = 0; i < 5; i++) {
				await seedWebhookLog({ source: 'trello', eventType: `event-${i}` });
			}

			await pruneWebhookLogs(3);

			const result = await listWebhookLogs({ limit: 100, offset: 0 });
			expect(result.data).toHaveLength(3);
			expect(result.total).toBe(3);
		});

		it('does nothing when count is already below retention limit', async () => {
			await seedWebhookLog({ source: 'trello' });
			await seedWebhookLog({ source: 'github' });

			await pruneWebhookLogs(10);

			const result = await listWebhookLogs({ limit: 100, offset: 0 });
			expect(result.total).toBe(2);
		});
	});

	// =========================================================================
	// getWebhookLogStats
	// =========================================================================

	describe('getWebhookLogStats', () => {
		it('returns count grouped by source', async () => {
			await seedWebhookLog({ source: 'trello' });
			await seedWebhookLog({ source: 'trello' });
			await seedWebhookLog({ source: 'github' });
			await seedWebhookLog({ source: 'jira' });

			const stats = await getWebhookLogStats();
			expect(stats.length).toBeGreaterThanOrEqual(3);

			const trelloStat = stats.find((s) => s.source === 'trello');
			const githubStat = stats.find((s) => s.source === 'github');
			const jiraStat = stats.find((s) => s.source === 'jira');

			expect(trelloStat?.count).toBe(2);
			expect(githubStat?.count).toBe(1);
			expect(jiraStat?.count).toBe(1);
		});

		it('returns empty array when no logs exist', async () => {
			const stats = await getWebhookLogStats();
			expect(stats).toEqual([]);
		});
	});
});
