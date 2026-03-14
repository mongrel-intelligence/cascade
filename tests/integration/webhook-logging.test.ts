/**
 * Integration tests: Webhook Logging — Provider-Specific Cases
 *
 * Tests per-source webhook logging (GitHub, JIRA), bodyRaw storage, and
 * project resolution recording. Core CRUD, filtering, pagination, stats, and
 * pruning are covered in tests/integration/db/webhookLogsRepository.test.ts.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
	getWebhookLogById,
	insertWebhookLog,
} from '../../src/db/repositories/webhookLogsRepository.js';
import { truncateAll } from './helpers/db.js';
import { seedOrg, seedProject, seedWebhookLog } from './helpers/seed.js';

beforeAll(async () => {
	await truncateAll();
});

describe('Webhook Logging — Provider-Specific (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
		await seedProject();
	});

	// =========================================================================
	// Per-Source Log Creation (GitHub, JIRA)
	// =========================================================================

	describe('per-source webhook logs', () => {
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
