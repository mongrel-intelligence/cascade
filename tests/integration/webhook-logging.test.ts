/**
 * Integration tests: Webhook Logging End-to-End
 *
 * Tests audit trail creation, project resolution recording, error logging, and
 * query/filter capabilities for webhook_logs.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
	getWebhookLogById,
	getWebhookLogStats,
	insertWebhookLog,
	listWebhookLogs,
	pruneWebhookLogs,
} from '../../src/db/repositories/webhookLogsRepository.js';
import { truncateAll } from './helpers/db.js';
import { seedOrg, seedProject, seedWebhookLog } from './helpers/seed.js';

describe('Webhook Logging (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
		await seedProject();
	});

	// =========================================================================
	// Log Creation
	// =========================================================================

	describe('insertWebhookLog', () => {
		it('creates a webhook log row and returns an ID', async () => {
			const id = await insertWebhookLog({
				source: 'trello',
				method: 'POST',
				path: '/webhooks/trello',
				eventType: 'updateCard',
			});

			expect(id).toBeTruthy();
			expect(typeof id).toBe('string');
		});

		it('stores all provided fields', async () => {
			const headers = { 'x-trello-webhook': 'abc123', 'content-type': 'application/json' };
			const body = { action: { type: 'updateCard', data: { card: { id: 'card-1' } } } };

			const id = await insertWebhookLog({
				source: 'trello',
				method: 'POST',
				path: '/webhooks/trello',
				headers,
				body,
				statusCode: 200,
				projectId: 'test-project',
				eventType: 'updateCard',
				processed: true,
			});

			const log = await getWebhookLogById(id);
			expect(log).toBeDefined();
			expect(log?.source).toBe('trello');
			expect(log?.method).toBe('POST');
			expect(log?.path).toBe('/webhooks/trello');
			expect(log?.eventType).toBe('updateCard');
			expect(log?.projectId).toBe('test-project');
			expect(log?.statusCode).toBe(200);
			expect(log?.processed).toBe(true);
			expect(log?.headers).toMatchObject({ 'x-trello-webhook': 'abc123' });
			expect(log?.body).toMatchObject({ action: { type: 'updateCard' } });
		});

		it('stores GitHub webhook logs', async () => {
			const id = await insertWebhookLog({
				source: 'github',
				method: 'POST',
				path: '/webhooks/github',
				eventType: 'check_suite',
				projectId: 'test-project',
				headers: { 'x-github-event': 'check_suite' },
				body: { action: 'completed', check_suite: { conclusion: 'success' } },
			});

			const log = await getWebhookLogById(id);
			expect(log?.source).toBe('github');
			expect(log?.eventType).toBe('check_suite');
		});

		it('stores JIRA webhook logs', async () => {
			const id = await insertWebhookLog({
				source: 'jira',
				method: 'POST',
				path: '/webhooks/jira',
				eventType: 'jira:issue_updated',
				body: { webhookEvent: 'jira:issue_updated', issue: { key: 'PROJ-123' } },
			});

			const log = await getWebhookLogById(id);
			expect(log?.source).toBe('jira');
			expect(log?.eventType).toBe('jira:issue_updated');
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

		it('stores raw body string', async () => {
			const rawBody = '{"action":{"type":"updateCard"}}';
			const id = await insertWebhookLog({
				source: 'trello',
				method: 'POST',
				path: '/webhooks/trello',
				bodyRaw: rawBody,
			});

			const log = await getWebhookLogById(id);
			expect(log?.bodyRaw).toBe(rawBody);
		});
	});

	// =========================================================================
	// Project Resolution Recording
	// =========================================================================

	describe('project resolution in logs', () => {
		it('records projectId when resolved', async () => {
			const id = await insertWebhookLog({
				source: 'trello',
				method: 'POST',
				path: '/webhooks/trello',
				eventType: 'updateCard',
				projectId: 'test-project',
			});

			const log = await getWebhookLogById(id);
			expect(log?.projectId).toBe('test-project');
		});

		it('records null projectId when project not identified', async () => {
			const id = await insertWebhookLog({
				source: 'trello',
				method: 'POST',
				path: '/webhooks/trello',
				eventType: 'updateCard',
				// No projectId
			});

			const log = await getWebhookLogById(id);
			expect(log?.projectId).toBeNull();
		});
	});

	// =========================================================================
	// Query and Filtering
	// =========================================================================

	describe('listWebhookLogs', () => {
		it('returns paginated logs sorted by receivedAt desc', async () => {
			await insertWebhookLog({ source: 'trello', method: 'POST', path: '/webhooks/trello' });
			await insertWebhookLog({ source: 'github', method: 'POST', path: '/webhooks/github' });
			await insertWebhookLog({ source: 'jira', method: 'POST', path: '/webhooks/jira' });

			const result = await listWebhookLogs({ limit: 10, offset: 0 });
			expect(result.data).toHaveLength(3);
			expect(result.total).toBe(3);
		});

		it('filters by source', async () => {
			await insertWebhookLog({
				source: 'trello',
				method: 'POST',
				path: '/webhooks/trello',
				eventType: 'updateCard',
			});
			await insertWebhookLog({
				source: 'github',
				method: 'POST',
				path: '/webhooks/github',
				eventType: 'check_suite',
			});

			const result = await listWebhookLogs({ source: 'github', limit: 10, offset: 0 });
			expect(result.data).toHaveLength(1);
			expect(result.data[0].source).toBe('github');
			expect(result.total).toBe(1);
		});

		it('filters by eventType', async () => {
			await insertWebhookLog({
				source: 'trello',
				method: 'POST',
				path: '/webhooks/trello',
				eventType: 'updateCard',
			});
			await insertWebhookLog({
				source: 'trello',
				method: 'POST',
				path: '/webhooks/trello',
				eventType: 'addLabelToCard',
			});

			const result = await listWebhookLogs({ eventType: 'addLabelToCard', limit: 10, offset: 0 });
			expect(result.data).toHaveLength(1);
			expect(result.data[0].eventType).toBe('addLabelToCard');
		});

		it('filters by receivedAfter', async () => {
			const past = new Date(Date.now() - 10_000);
			const future = new Date(Date.now() + 10_000);

			await insertWebhookLog({ source: 'trello', method: 'POST', path: '/test' });

			const result = await listWebhookLogs({ receivedAfter: past, limit: 10, offset: 0 });
			expect(result.data.length).toBeGreaterThanOrEqual(1);

			const futureResult = await listWebhookLogs({ receivedAfter: future, limit: 10, offset: 0 });
			expect(futureResult.data).toHaveLength(0);
		});

		it('respects limit and offset for pagination', async () => {
			for (let i = 0; i < 5; i++) {
				await insertWebhookLog({ source: 'trello', method: 'POST', path: '/webhooks/trello' });
			}

			const page1 = await listWebhookLogs({ limit: 2, offset: 0 });
			expect(page1.data).toHaveLength(2);
			expect(page1.total).toBe(5);

			const page2 = await listWebhookLogs({ limit: 2, offset: 2 });
			expect(page2.data).toHaveLength(2);
		});

		it('returns empty data with total=0 when no logs exist', async () => {
			const result = await listWebhookLogs({ limit: 10, offset: 0 });
			expect(result.data).toHaveLength(0);
			expect(result.total).toBe(0);
		});
	});

	// =========================================================================
	// getWebhookLogById
	// =========================================================================

	describe('getWebhookLogById', () => {
		it('returns the log by ID', async () => {
			const id = await insertWebhookLog({
				source: 'trello',
				method: 'POST',
				path: '/webhooks/trello',
				eventType: 'updateCard',
			});

			const log = await getWebhookLogById(id);
			expect(log).toBeDefined();
			expect(log?.id).toBe(id);
			expect(log?.source).toBe('trello');
		});

		it('returns null for non-existent ID', async () => {
			const log = await getWebhookLogById('00000000-0000-0000-0000-000000000000');
			expect(log).toBeNull();
		});
	});

	// =========================================================================
	// getWebhookLogStats
	// =========================================================================

	describe('getWebhookLogStats', () => {
		it('returns count grouped by source', async () => {
			await insertWebhookLog({ source: 'trello', method: 'POST', path: '/test' });
			await insertWebhookLog({ source: 'trello', method: 'POST', path: '/test' });
			await insertWebhookLog({ source: 'github', method: 'POST', path: '/test' });

			const stats = await getWebhookLogStats();
			const trelloStat = stats.find((s) => s.source === 'trello');
			const githubStat = stats.find((s) => s.source === 'github');

			expect(trelloStat?.count).toBe(2);
			expect(githubStat?.count).toBe(1);
		});

		it('returns empty array when no logs', async () => {
			const stats = await getWebhookLogStats();
			expect(stats).toHaveLength(0);
		});
	});

	// =========================================================================
	// pruneWebhookLogs
	// =========================================================================

	describe('pruneWebhookLogs', () => {
		it('keeps only the N most recent logs', async () => {
			for (let i = 0; i < 5; i++) {
				await insertWebhookLog({ source: 'trello', method: 'POST', path: '/webhooks/trello' });
			}

			let result = await listWebhookLogs({ limit: 100, offset: 0 });
			expect(result.total).toBe(5);

			await pruneWebhookLogs(3);

			result = await listWebhookLogs({ limit: 100, offset: 0 });
			expect(result.total).toBe(3);
		});

		it('keeps all logs when retention count exceeds total', async () => {
			await insertWebhookLog({ source: 'trello', method: 'POST', path: '/test' });
			await insertWebhookLog({ source: 'github', method: 'POST', path: '/test' });

			await pruneWebhookLogs(100);

			const result = await listWebhookLogs({ limit: 100, offset: 0 });
			expect(result.total).toBe(2);
		});
	});

	// =========================================================================
	// Seed Helper
	// =========================================================================

	describe('seedWebhookLog helper', () => {
		it('creates logs via seed helper', async () => {
			const log = await seedWebhookLog({
				source: 'github',
				eventType: 'pull_request',
				projectId: 'test-project',
				body: { action: 'opened' },
			});

			expect(log.id).toBeTruthy();
			expect(log.source).toBe('github');
			expect(log.eventType).toBe('pull_request');
			expect(log.projectId).toBe('test-project');
		});
	});
});
