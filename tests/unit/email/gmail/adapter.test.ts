import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

const { mockLock, mockClient } = vi.hoisted(() => {
	const mockLock = { release: vi.fn() };
	const mockClient = {
		connect: vi.fn(),
		logout: vi.fn(),
		getMailboxLock: vi.fn().mockResolvedValue(mockLock),
		search: vi.fn(),
		fetch: vi.fn(),
		fetchOne: vi.fn(),
		messageFlagsAdd: vi.fn(),
	};
	return { mockLock, mockClient };
});

vi.mock('imapflow', () => ({
	ImapFlow: vi.fn().mockImplementation(() => mockClient),
}));

vi.mock('../../../../src/email/gmail/send.js', () => ({
	sendViaGmailApi: vi.fn(),
	replyViaGmailApi: vi.fn(),
}));

import { GmailEmailProvider } from '../../../../src/email/gmail/adapter.js';
import { replyViaGmailApi, sendViaGmailApi } from '../../../../src/email/gmail/send.js';
import type { OAuthEmailCredentials } from '../../../../src/email/types.js';

const testCreds: OAuthEmailCredentials = {
	authMethod: 'oauth',
	imapHost: 'imap.gmail.com',
	imapPort: 993,
	smtpHost: 'smtp.gmail.com',
	smtpPort: 465,
	email: 'user@gmail.com',
	accessToken: 'access-token-123',
};

describe('GmailEmailProvider', () => {
	let provider: GmailEmailProvider;

	beforeEach(() => {
		vi.clearAllMocks();
		provider = new GmailEmailProvider(testCreds);
		mockClient.connect.mockResolvedValue(undefined);
		mockClient.logout.mockResolvedValue(undefined);
		mockClient.getMailboxLock.mockResolvedValue(mockLock);
		mockLock.release.mockReturnValue(undefined);
	});

	it('has type "gmail"', () => {
		expect(provider.type).toBe('gmail');
	});

	describe('searchEmails', () => {
		it('returns summaries when messages are found', async () => {
			mockClient.search.mockResolvedValue([1, 2]);

			const mockMessages = [
				{
					uid: 2,
					envelope: {
						date: new Date('2024-01-15'),
						from: [{ address: 'sender@example.com' }],
						to: [{ address: 'user@gmail.com' }],
						subject: 'Hello',
					},
					source: Buffer.from('Hello body'),
				},
			];

			async function* asyncGen() {
				for (const msg of mockMessages) yield msg;
			}
			mockClient.fetch.mockReturnValue(asyncGen());

			const result = await provider.searchEmails('INBOX', {}, 10);

			expect(result).toHaveLength(1);
			expect(result[0].uid).toBe(2);
			expect(result[0].subject).toBe('Hello');
		});

		it('returns empty array when no messages match', async () => {
			mockClient.search.mockResolvedValue([]);

			const result = await provider.searchEmails('INBOX', {}, 10);

			expect(result).toEqual([]);
		});
	});

	describe('readEmail', () => {
		it('returns EmailMessage fields on success', async () => {
			const mockDate = new Date('2024-03-01');
			mockClient.fetchOne.mockResolvedValue({
				uid: 7,
				envelope: {
					date: mockDate,
					from: [{ address: 'sender@example.com' }],
					to: [{ address: 'user@gmail.com' }],
					cc: [],
					subject: 'Gmail Subject',
				},
				source: Buffer.from('Message-ID: <gmail-id>\r\n\r\nGmail body'),
				bodyStructure: {},
			});

			const result = await provider.readEmail('INBOX', 7);

			expect(result.uid).toBe(7);
			expect(result.from).toBe('sender@example.com');
			expect(result.subject).toBe('Gmail Subject');
			expect(result.messageId).toBe('gmail-id');
			expect(mockLock.release).toHaveBeenCalled();
			expect(mockClient.logout).toHaveBeenCalled();
		});

		it('throws when email not found', async () => {
			mockClient.fetchOne.mockResolvedValue(undefined);

			await expect(provider.readEmail('INBOX', 42)).rejects.toThrow('Email with UID 42 not found');
			expect(mockLock.release).toHaveBeenCalled();
		});
	});

	describe('sendEmail', () => {
		it('delegates to sendViaGmailApi with the OAuth credentials', async () => {
			vi.mocked(sendViaGmailApi).mockResolvedValue({
				messageId: '<gmail-msg-id@mail.gmail.com>',
				accepted: ['to@example.com'],
				rejected: [],
			});

			const result = await provider.sendEmail({
				to: ['to@example.com'],
				subject: 'Hello',
				body: 'World',
			});

			expect(sendViaGmailApi).toHaveBeenCalledWith(
				expect.objectContaining({ to: ['to@example.com'], subject: 'Hello' }),
				'access-token-123',
				'user@gmail.com',
			);
			expect(result.messageId).toBe('<gmail-msg-id@mail.gmail.com>');
		});
	});

	describe('replyToEmail', () => {
		it('reads original via IMAP then delegates to replyViaGmailApi', async () => {
			const originalMessage = {
				uid: 10,
				messageId: 'orig-msg-id',
				date: new Date(),
				from: 'sender@example.com',
				to: ['user@gmail.com'],
				cc: [],
				subject: 'Original',
				textBody: 'Original body',
				attachments: [],
				references: [],
			};

			mockClient.fetchOne.mockResolvedValue({
				uid: 10,
				envelope: {
					date: originalMessage.date,
					from: [{ address: 'sender@example.com' }],
					to: [{ address: 'user@gmail.com' }],
					cc: [],
					subject: 'Original',
				},
				source: Buffer.from('Message-ID: <orig-msg-id>\r\n\r\nOriginal body'),
				bodyStructure: {},
			});

			vi.mocked(replyViaGmailApi).mockResolvedValue({
				messageId: '<reply-id@mail.gmail.com>',
				accepted: ['sender@example.com'],
				rejected: [],
			});

			const result = await provider.replyToEmail({
				folder: 'INBOX',
				uid: 10,
				body: 'Reply body',
				replyAll: false,
			});

			expect(replyViaGmailApi).toHaveBeenCalledWith(
				expect.objectContaining({ uid: 10, body: 'Reply body', replyAll: false }),
				expect.objectContaining({ uid: 10 }),
				'access-token-123',
				'user@gmail.com',
			);
			expect(result.messageId).toBe('<reply-id@mail.gmail.com>');
		});
	});

	describe('markEmailAsSeen', () => {
		it('calls messageFlagsAdd via IMAP', async () => {
			mockClient.messageFlagsAdd.mockResolvedValue(undefined);

			await provider.markEmailAsSeen('INBOX', 5);

			expect(mockClient.messageFlagsAdd).toHaveBeenCalledWith(5, ['\\Seen'], { uid: true });
			expect(mockClient.logout).toHaveBeenCalled();
		});
	});
});
