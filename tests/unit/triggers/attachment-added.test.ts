import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttachmentAddedTrigger } from '../../../src/triggers/trello/attachment-added.js';
import type { TriggerContext } from '../../../src/triggers/types.js';

vi.mock('../../../src/trello/client.js', () => ({
	trelloClient: {
		getMe: vi.fn(),
		getCard: vi.fn(),
	},
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock AdmZip
vi.mock('adm-zip', () => ({
	default: vi.fn().mockImplementation(() => ({
		extractAllTo: vi.fn(),
		getEntries: vi.fn(() => [{ entryName: 'session.log' }]),
	})),
}));

import { trelloClient } from '../../../src/trello/client.js';

describe('AttachmentAddedTrigger', () => {
	const trigger = new AttachmentAddedTrigger();

	const mockProject = {
		id: 'test',
		name: 'Test',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		githubTokenEnv: 'GITHUB_TOKEN',
		trello: {
			boardId: 'board123',
			lists: {
				briefing: 'briefing-list-id',
				planning: 'planning-list-id',
				todo: 'todo-list-id',
				debug: 'debug-list-id',
			},
			labels: {},
		},
	};

	const makeTrelloPayload = (overrides: Record<string, unknown> = {}) => ({
		model: { id: 'board123', name: 'Test Board' },
		action: {
			id: 'action123',
			idMemberCreator: 'member123',
			type: 'addAttachmentToCard',
			date: '2024-01-01',
			data: {
				card: { id: 'card123', name: 'Test Card', idShort: 1, shortLink: 'abc' },
				attachment: {
					id: 'att123',
					name: 'implementation-2026-01-02T12-34-56-789Z.zip',
					url: 'https://trello.com/attachments/att123.zip',
					mimeType: 'application/zip',
				},
				board: { id: 'board123', name: 'Test Board', shortLink: 'xyz' },
			},
		},
		...overrides,
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('matches', () => {
		it('matches attachment added with agent log zip pattern', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: makeTrelloPayload(),
			};

			expect(trigger.matches(ctx)).toBe(true);
		});

		it('does not match github source', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {},
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match non-attachment actions', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: {
					model: { id: 'board123', name: 'Test Board' },
					action: {
						id: 'action123',
						idMemberCreator: 'member123',
						type: 'updateCard',
						date: '2024-01-01',
						data: { card: { id: 'card123', name: 'Card', idShort: 1, shortLink: 'abc' } },
					},
				},
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match non-zip attachments', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: {
					model: { id: 'board123', name: 'Test Board' },
					action: {
						id: 'action123',
						idMemberCreator: 'member123',
						type: 'addAttachmentToCard',
						date: '2024-01-01',
						data: {
							card: { id: 'card123', name: 'Card', idShort: 1, shortLink: 'abc' },
							attachment: {
								id: 'att123',
								name: 'image.png',
								url: 'https://trello.com/attachments/image.png',
								mimeType: 'image/png',
							},
						},
					},
				},
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match zip files that do not match agent log pattern', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: {
					model: { id: 'board123', name: 'Test Board' },
					action: {
						id: 'action123',
						idMemberCreator: 'member123',
						type: 'addAttachmentToCard',
						date: '2024-01-01',
						data: {
							card: { id: 'card123', name: 'Card', idShort: 1, shortLink: 'abc' },
							attachment: {
								id: 'att123',
								name: 'random-file.zip',
								url: 'https://trello.com/attachments/random.zip',
								mimeType: 'application/zip',
							},
						},
					},
				},
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match debug agent logs (prevent infinite loop)', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: {
					model: { id: 'board123', name: 'Test Board' },
					action: {
						id: 'action123',
						idMemberCreator: 'member123',
						type: 'addAttachmentToCard',
						date: '2024-01-01',
						data: {
							card: { id: 'card123', name: 'Card', idShort: 1, shortLink: 'abc' },
							attachment: {
								id: 'att123',
								name: 'debug-2026-01-02T12-34-56-789Z.zip',
								url: 'https://trello.com/attachments/debug.zip',
								mimeType: 'application/zip',
							},
						},
					},
				},
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match when debug list is not configured', () => {
			const projectWithoutDebug = {
				...mockProject,
				trello: {
					...mockProject.trello,
					lists: {
						briefing: 'briefing-list-id',
						planning: 'planning-list-id',
						todo: 'todo-list-id',
						// no debug list
					},
				},
			};

			const ctx: TriggerContext = {
				project: projectWithoutDebug,
				source: 'trello',
				payload: makeTrelloPayload(),
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('matches timeout log filenames', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: {
					model: { id: 'board123', name: 'Test Board' },
					action: {
						id: 'action123',
						idMemberCreator: 'member123',
						type: 'addAttachmentToCard',
						date: '2024-01-01',
						data: {
							card: { id: 'card123', name: 'Card', idShort: 1, shortLink: 'abc' },
							attachment: {
								id: 'att123',
								name: 'briefing-timeout-2026-01-02T12-34-56-789Z.zip',
								url: 'https://trello.com/attachments/briefing-timeout.zip',
								mimeType: 'application/zip',
							},
						},
					},
				},
			};

			expect(trigger.matches(ctx)).toBe(true);
		});
	});

	describe('handle', () => {
		it('returns debug agent result for valid attachment from authenticated user', async () => {
			vi.mocked(trelloClient.getMe).mockResolvedValue({
				id: 'member123',
				fullName: 'Cascade Bot',
				username: 'cascadebot',
			});
			vi.mocked(trelloClient.getCard).mockResolvedValue({
				id: 'card123',
				name: 'Test Card',
				shortUrl: 'https://trello.com/c/abc',
				desc: '',
				idList: 'todo-list-id',
				labels: [],
			});

			mockFetch.mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: makeTrelloPayload(),
			};

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('debug');
			expect(result?.agentInput.originalCardId).toBe('card123');
			expect(result?.agentInput.originalCardName).toBe('Test Card');
			expect(result?.agentInput.detectedAgentType).toBe('implementation');
			expect(result?.cardId).toBe('card123');
		});

		it('returns null when attachment uploaded by different user', async () => {
			vi.mocked(trelloClient.getMe).mockResolvedValue({
				id: 'member123',
				fullName: 'Cascade Bot',
				username: 'cascadebot',
			});

			// Use a payload with a different uploader
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: {
					model: { id: 'board123', name: 'Test Board' },
					action: {
						id: 'action123',
						idMemberCreator: 'other-member-456',
						type: 'addAttachmentToCard',
						date: '2024-01-01',
						data: {
							card: { id: 'card123', name: 'Test Card', idShort: 1, shortLink: 'abc' },
							attachment: {
								id: 'att123',
								name: 'implementation-2026-01-02T12-34-56-789Z.zip',
								url: 'https://trello.com/attachments/att123.zip',
								mimeType: 'application/zip',
							},
							board: { id: 'board123', name: 'Test Board', shortLink: 'xyz' },
						},
					},
				},
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});

		it('throws when download fails', async () => {
			vi.mocked(trelloClient.getMe).mockResolvedValue({
				id: 'member123',
				fullName: 'Cascade Bot',
				username: 'cascadebot',
			});

			mockFetch.mockResolvedValue({
				ok: false,
				status: 500,
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: makeTrelloPayload(),
			};

			await expect(trigger.handle(ctx)).rejects.toThrow('Failed to download attachment');
		});

		it('throws when card or attachment data is missing', async () => {
			vi.mocked(trelloClient.getMe).mockResolvedValue({
				id: 'member123',
				fullName: 'Cascade Bot',
				username: 'cascadebot',
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: {
					model: { id: 'board123', name: 'Test Board' },
					action: {
						id: 'action123',
						idMemberCreator: 'member123',
						type: 'addAttachmentToCard',
						date: '2024-01-01',
						data: {
							// missing card and attachment
						},
					},
				},
			};

			await expect(trigger.handle(ctx)).rejects.toThrow('Missing card or attachment data');
		});
	});
});
