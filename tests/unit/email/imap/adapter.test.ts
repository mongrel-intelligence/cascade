import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

const { mockLock, mockClient, mockTransport } = vi.hoisted(() => {
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
	const mockTransport = {
		sendMail: vi.fn(),
		close: vi.fn(),
	};
	return { mockLock, mockClient, mockTransport };
});

vi.mock('imapflow', () => ({
	ImapFlow: vi.fn().mockImplementation(() => mockClient),
}));

vi.mock('nodemailer', () => ({
	default: {
		createTransport: vi.fn().mockReturnValue(mockTransport),
	},
}));

import { ImapEmailProvider } from '../../../../src/email/imap/adapter.js';
import type { PasswordEmailCredentials } from '../../../../src/email/types.js';

const testCreds: PasswordEmailCredentials = {
	authMethod: 'password',
	imapHost: 'imap.example.com',
	imapPort: 993,
	smtpHost: 'smtp.example.com',
	smtpPort: 587,
	username: 'user@example.com',
	password: 'secret',
};

describe('ImapEmailProvider', () => {
	let provider: ImapEmailProvider;

	beforeEach(() => {
		vi.clearAllMocks();
		provider = new ImapEmailProvider(testCreds);
		mockClient.connect.mockResolvedValue(undefined);
		mockClient.logout.mockResolvedValue(undefined);
		mockClient.getMailboxLock.mockResolvedValue(mockLock);
		mockLock.release.mockReturnValue(undefined);
	});

	it('has type "imap"', () => {
		expect(provider.type).toBe('imap');
	});

	describe('searchEmails', () => {
		it('returns empty array when no messages found', async () => {
			mockClient.search.mockResolvedValue([]);

			const result = await provider.searchEmails('INBOX', {}, 10);

			expect(result).toEqual([]);
			expect(mockClient.connect).toHaveBeenCalled();
			expect(mockClient.logout).toHaveBeenCalled();
		});

		it('returns empty array when search returns false', async () => {
			mockClient.search.mockResolvedValue(false);

			const result = await provider.searchEmails('INBOX', {}, 10);
			expect(result).toEqual([]);
		});

		it('fetches messages and returns summaries', async () => {
			mockClient.search.mockResolvedValue([1, 2]);

			const mockMessages = [
				{
					uid: 2,
					envelope: {
						date: new Date('2024-01-15'),
						from: [{ address: 'sender@example.com' }],
						to: [{ address: 'recipient@example.com' }],
						subject: 'Test subject',
					},
					source: Buffer.from('header snippet'),
				},
			];

			async function* asyncGen() {
				for (const msg of mockMessages) yield msg;
			}
			mockClient.fetch.mockReturnValue(asyncGen());

			const result = await provider.searchEmails('INBOX', {}, 10);

			expect(result).toHaveLength(1);
			expect(result[0].uid).toBe(2);
			expect(result[0].subject).toBe('Test subject');
		});
	});

	describe('readEmail', () => {
		it('returns EmailMessage fields on success', async () => {
			const mockDate = new Date('2024-03-01');
			mockClient.fetchOne.mockResolvedValue({
				uid: 5,
				envelope: {
					date: mockDate,
					from: [{ address: 'sender@example.com' }],
					to: [{ address: 'recipient@example.com' }],
					cc: [],
					subject: 'Test Subject',
				},
				source: Buffer.from('Message-ID: <test-id>\r\n\r\nHello world'),
				bodyStructure: {},
			});

			const result = await provider.readEmail('INBOX', 5);

			expect(result.uid).toBe(5);
			expect(result.from).toBe('sender@example.com');
			expect(result.subject).toBe('Test Subject');
			expect(result.messageId).toBe('test-id');
			expect(mockLock.release).toHaveBeenCalled();
			expect(mockClient.logout).toHaveBeenCalled();
		});

		it('throws when email not found', async () => {
			mockClient.fetchOne.mockResolvedValue(undefined);

			await expect(provider.readEmail('INBOX', 99)).rejects.toThrow('Email with UID 99 not found');
			expect(mockLock.release).toHaveBeenCalled();
		});
	});

	describe('sendEmail', () => {
		it('sends via nodemailer SMTP and returns result', async () => {
			mockTransport.sendMail.mockResolvedValue({
				messageId: '<test@example.com>',
				accepted: ['to@example.com'],
				rejected: [],
			});
			mockTransport.close.mockResolvedValue(undefined);

			const result = await provider.sendEmail({
				to: ['to@example.com'],
				subject: 'Hello',
				body: 'World',
			});

			expect(result.messageId).toBe('<test@example.com>');
			expect(result.accepted).toEqual(['to@example.com']);
			expect(mockTransport.sendMail).toHaveBeenCalledWith(
				expect.objectContaining({
					from: 'user@example.com',
					to: ['to@example.com'],
					subject: 'Hello',
				}),
			);
		});

		it('closes transport even on error', async () => {
			mockTransport.sendMail.mockRejectedValue(new Error('SMTP failed'));
			mockTransport.close.mockResolvedValue(undefined);

			await expect(
				provider.sendEmail({ to: ['to@example.com'], subject: 'Hello', body: 'World' }),
			).rejects.toThrow('SMTP failed');

			expect(mockTransport.close).toHaveBeenCalled();
		});
	});

	describe('replyToEmail', () => {
		const originalMessageFixture = {
			uid: 5,
			envelope: {
				date: new Date('2024-03-01'),
				from: [{ address: 'sender@example.com' }],
				to: [{ address: 'user@example.com' }, { address: 'other@example.com' }],
				cc: [],
				subject: 'Original Subject',
			},
			source: Buffer.from('Message-ID: <orig-id>\r\n\r\nOriginal body'),
			bodyStructure: {},
		};

		it('sends with threading headers and filters self from reply-all recipients', async () => {
			mockClient.fetchOne.mockResolvedValue(originalMessageFixture);
			mockTransport.sendMail.mockResolvedValue({
				messageId: '<reply-id@example.com>',
				accepted: ['sender@example.com'],
				rejected: [],
			});
			mockTransport.close.mockResolvedValue(undefined);

			const result = await provider.replyToEmail({
				folder: 'INBOX',
				uid: 5,
				body: 'My reply',
				replyAll: true,
			});

			expect(result.messageId).toBe('<reply-id@example.com>');
			expect(mockTransport.sendMail).toHaveBeenCalledWith(
				expect.objectContaining({
					inReplyTo: '<orig-id>',
					references: '<orig-id>',
					// reply-all: self (user@example.com) is filtered out; other@example.com kept
					to: expect.arrayContaining(['sender@example.com', 'other@example.com']),
				}),
			);
			expect(mockLock.release).toHaveBeenCalled();
		});

		it('closes transport on error', async () => {
			mockClient.fetchOne.mockResolvedValue(originalMessageFixture);
			mockTransport.sendMail.mockRejectedValue(new Error('SMTP error'));
			mockTransport.close.mockResolvedValue(undefined);

			await expect(
				provider.replyToEmail({ folder: 'INBOX', uid: 5, body: 'My reply', replyAll: false }),
			).rejects.toThrow('SMTP error');

			expect(mockTransport.close).toHaveBeenCalled();
		});
	});

	describe('markEmailAsSeen', () => {
		it('calls messageFlagsAdd with Seen flag', async () => {
			mockClient.messageFlagsAdd.mockResolvedValue(undefined);

			await provider.markEmailAsSeen('INBOX', 42);

			expect(mockClient.messageFlagsAdd).toHaveBeenCalledWith(42, ['\\Seen'], { uid: true });
			expect(mockClient.logout).toHaveBeenCalled();
		});

		it('releases lock and re-throws on error', async () => {
			mockClient.messageFlagsAdd.mockRejectedValue(new Error('flag error'));

			await expect(provider.markEmailAsSeen('INBOX', 42)).rejects.toThrow('flag error');
			expect(mockLock.release).toHaveBeenCalled();
		});
	});
});
