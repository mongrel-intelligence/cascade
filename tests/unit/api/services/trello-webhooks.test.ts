import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TrelloWebhookManager } from '../../../../src/api/services/trello-webhooks.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const baseCtx = {
	trelloApiKey: 'test-api-key',
	trelloToken: 'test-token',
	boardId: 'board-123',
	projectId: 'my-project',
};

describe('TrelloWebhookManager', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('list', () => {
		it('returns webhooks filtered by boardId', async () => {
			const webhooks = [
				{ id: 'w1', idModel: 'board-123', callbackURL: 'http://a', active: true, description: '' },
				{
					id: 'w2',
					idModel: 'other-board',
					callbackURL: 'http://b',
					active: true,
					description: '',
				},
			];
			mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(webhooks) });

			const mgr = new TrelloWebhookManager(baseCtx);
			const result = await mgr.list();

			expect(result).toHaveLength(1);
			expect(result[0].id).toBe('w1');
			expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('test-token'));
		});

		it('returns empty array when credentials are missing', async () => {
			const mgr = new TrelloWebhookManager({
				...baseCtx,
				trelloApiKey: '',
			});
			const result = await mgr.list();
			expect(result).toEqual([]);
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('returns empty array when boardId is missing', async () => {
			const mgr = new TrelloWebhookManager({ ...baseCtx, boardId: undefined });
			const result = await mgr.list();
			expect(result).toEqual([]);
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('throws TRPCError when fetch fails', async () => {
			mockFetch.mockResolvedValue({ ok: false, status: 401 });

			const mgr = new TrelloWebhookManager(baseCtx);
			await expect(mgr.list()).rejects.toMatchObject({
				code: 'INTERNAL_SERVER_ERROR',
				message: expect.stringContaining('401'),
			});
		});
	});

	describe('create', () => {
		it('creates a webhook with projectId in description', async () => {
			const created = {
				id: 'w-new',
				callbackURL: 'http://example.com/trello/webhook',
				idModel: 'board-123',
				active: true,
				description: 'CASCADE webhook for project my-project',
			};
			mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(created) });

			const mgr = new TrelloWebhookManager(baseCtx);
			const result = await mgr.create('http://example.com/trello/webhook');

			expect(result.id).toBe('w-new');
			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining('test-api-key'),
				expect.objectContaining({ method: 'POST' }),
			);
		});

		it('throws TRPCError when fetch fails', async () => {
			mockFetch.mockResolvedValue({ ok: false, status: 422 });

			const mgr = new TrelloWebhookManager(baseCtx);
			await expect(mgr.create('http://example.com/trello/webhook')).rejects.toMatchObject({
				code: 'INTERNAL_SERVER_ERROR',
				message: expect.stringContaining('422'),
			});
		});
	});

	describe('delete', () => {
		it('deletes a webhook by id', async () => {
			mockFetch.mockResolvedValue({ ok: true });

			const mgr = new TrelloWebhookManager(baseCtx);
			await expect(mgr.delete('w-1')).resolves.toBeUndefined();

			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining('w-1'),
				expect.objectContaining({ method: 'DELETE' }),
			);
		});

		it('throws TRPCError when fetch fails', async () => {
			mockFetch.mockResolvedValue({ ok: false, status: 404 });

			const mgr = new TrelloWebhookManager(baseCtx);
			await expect(mgr.delete('w-1')).rejects.toMatchObject({
				code: 'INTERNAL_SERVER_ERROR',
				message: expect.stringContaining('w-1'),
			});
		});
	});
});
