import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockProvider = {
	type: 'imap',
	sendEmail: vi.fn(),
	searchEmails: vi.fn(),
	readEmail: vi.fn(),
	replyToEmail: vi.fn(),
	markEmailAsSeen: vi.fn(),
};

vi.mock('../../../../src/email/context.js', () => ({
	getEmailProvider: vi.fn(() => mockProvider),
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import { markEmailAsSeen } from '../../../../src/gadgets/email/core/markEmailAsSeen.js';
import { readEmail } from '../../../../src/gadgets/email/core/readEmail.js';
import { replyToEmail } from '../../../../src/gadgets/email/core/replyToEmail.js';
import { searchEmails } from '../../../../src/gadgets/email/core/searchEmails.js';
import { sendEmail } from '../../../../src/gadgets/email/core/sendEmail.js';
import { logger } from '../../../../src/utils/logging.js';

describe('email gadget core functions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('sendEmail', () => {
		it('returns success message when email is sent', async () => {
			mockProvider.sendEmail.mockResolvedValue({
				messageId: '<abc123@example.com>',
				accepted: ['user@example.com'],
				rejected: [],
			});

			const result = await sendEmail({
				to: ['user@example.com'],
				subject: 'Test',
				body: 'Hello',
			});

			expect(result).toBe(
				'Email sent successfully to user@example.com (Message-ID: <abc123@example.com>)',
			);
		});

		it('includes rejected recipients in output', async () => {
			mockProvider.sendEmail.mockResolvedValue({
				messageId: '<abc123@example.com>',
				accepted: ['user@example.com'],
				rejected: ['bad@example.com'],
			});

			const result = await sendEmail({
				to: ['user@example.com', 'bad@example.com'],
				subject: 'Test',
				body: 'Hello',
			});

			expect(result).toContain('rejected: bad@example.com');
		});

		it('does not show empty rejected list', async () => {
			mockProvider.sendEmail.mockResolvedValue({
				messageId: '<abc123@example.com>',
				accepted: ['user@example.com'],
				rejected: [],
			});

			const result = await sendEmail({
				to: ['user@example.com'],
				subject: 'Test',
				body: 'Hello',
			});

			expect(result).not.toContain('rejected');
		});

		it('returns error message and logs on failure', async () => {
			mockProvider.sendEmail.mockRejectedValue(new Error('SMTP connection failed'));

			const result = await sendEmail({
				to: ['user@example.com'],
				subject: 'Test',
				body: 'Hello',
			});

			expect(result).toBe('Error sending email: SMTP connection failed');
			expect(logger.error).toHaveBeenCalledWith(
				'Email send failed',
				expect.objectContaining({ error: 'SMTP connection failed' }),
			);
		});
	});

	describe('searchEmails', () => {
		it('returns formatted results when emails found', async () => {
			mockProvider.searchEmails.mockResolvedValue([
				{
					uid: 123,
					date: new Date('2024-01-15'),
					from: 'sender@example.com',
					to: ['recipient@example.com'],
					subject: 'Important message',
					snippet: 'Hello...',
				},
				{
					uid: 124,
					date: new Date('2024-01-16'),
					from: 'another@example.com',
					to: ['recipient@example.com'],
					subject: 'Follow up',
					snippet: 'Regarding...',
				},
			]);

			const result = await searchEmails('INBOX', {}, 10);

			expect(result).toContain('Found 2 email(s)');
			expect(result).toContain('1. [UID:123]');
			expect(result).toContain('2. [UID:124]');
			expect(result).toContain('Important message');
			expect(result).toContain('sender@example.com');
		});

		it('returns message when no emails found', async () => {
			mockProvider.searchEmails.mockResolvedValue([]);

			const result = await searchEmails('INBOX', { from: 'nobody@example.com' }, 10);

			expect(result).toBe('No emails found matching the search criteria.');
		});

		it('returns error message and logs on failure', async () => {
			mockProvider.searchEmails.mockRejectedValue(new Error('IMAP timeout'));

			const result = await searchEmails('INBOX', {}, 10);

			expect(result).toBe('Error searching emails: IMAP timeout');
			expect(logger.error).toHaveBeenCalledWith(
				'Email search failed',
				expect.objectContaining({ error: 'IMAP timeout' }),
			);
		});
	});

	describe('readEmail', () => {
		it('returns formatted email content', async () => {
			mockProvider.readEmail.mockResolvedValue({
				uid: 123,
				messageId: '<msg@example.com>',
				date: new Date('2024-01-15T10:30:00Z'),
				from: 'sender@example.com',
				to: ['recipient@example.com'],
				cc: [],
				subject: 'Test Subject',
				textBody: 'This is the body text.',
				attachments: [],
				references: [],
			});

			const result = await readEmail('INBOX', 123);

			expect(result).toContain('From: sender@example.com');
			expect(result).toContain('To: recipient@example.com');
			expect(result).toContain('Subject: Test Subject');
			expect(result).toContain('This is the body text.');
		});

		it('shows CC when present', async () => {
			mockProvider.readEmail.mockResolvedValue({
				uid: 123,
				messageId: '<msg@example.com>',
				date: new Date('2024-01-15'),
				from: 'sender@example.com',
				to: ['recipient@example.com'],
				cc: ['cc@example.com'],
				subject: 'Test',
				textBody: 'Body',
				attachments: [],
				references: [],
			});

			const result = await readEmail('INBOX', 123);

			expect(result).toContain('CC: cc@example.com');
		});

		it('shows HTML body when text body is empty', async () => {
			mockProvider.readEmail.mockResolvedValue({
				uid: 123,
				messageId: '<msg@example.com>',
				date: new Date('2024-01-15'),
				from: 'sender@example.com',
				to: ['recipient@example.com'],
				cc: [],
				subject: 'Test',
				textBody: '',
				htmlBody: '<p>HTML content</p>',
				attachments: [],
				references: [],
			});

			const result = await readEmail('INBOX', 123);

			expect(result).toContain('--- Body (HTML) ---');
			expect(result).toContain('<p>HTML content</p>');
		});

		it('shows attachments when present', async () => {
			mockProvider.readEmail.mockResolvedValue({
				uid: 123,
				messageId: '<msg@example.com>',
				date: new Date('2024-01-15'),
				from: 'sender@example.com',
				to: ['recipient@example.com'],
				cc: [],
				subject: 'Test',
				textBody: 'Body',
				attachments: [{ filename: 'doc.pdf', contentType: 'application/pdf', size: 1024 }],
				references: [],
			});

			const result = await readEmail('INBOX', 123);

			expect(result).toContain('Attachments: doc.pdf');
			expect(result).toContain('application/pdf');
		});

		it('returns error message and logs on failure', async () => {
			mockProvider.readEmail.mockRejectedValue(new Error('Email not found'));

			const result = await readEmail('INBOX', 999);

			expect(result).toBe('Error reading email: Email not found');
			expect(logger.error).toHaveBeenCalledWith(
				'Email read failed',
				expect.objectContaining({ uid: 999, error: 'Email not found' }),
			);
		});
	});

	describe('replyToEmail', () => {
		it('returns success message when reply is sent', async () => {
			mockProvider.replyToEmail.mockResolvedValue({
				messageId: '<reply@example.com>',
				accepted: ['sender@example.com'],
				rejected: [],
			});

			const result = await replyToEmail('INBOX', 123, 'Thanks!', false);

			expect(result).toBe('Reply sent to sender@example.com (Message-ID: <reply@example.com>)');
		});

		it('includes rejected recipients in output', async () => {
			mockProvider.replyToEmail.mockResolvedValue({
				messageId: '<reply@example.com>',
				accepted: ['sender@example.com'],
				rejected: ['bad@example.com'],
			});

			const result = await replyToEmail('INBOX', 123, 'Thanks!', true);

			expect(result).toContain('rejected: bad@example.com');
		});

		it('returns error message and logs on failure', async () => {
			mockProvider.replyToEmail.mockRejectedValue(new Error('Connection refused'));

			const result = await replyToEmail('INBOX', 123, 'Reply body', false);

			expect(result).toBe('Error sending reply: Connection refused');
			expect(logger.error).toHaveBeenCalledWith(
				'Email reply failed',
				expect.objectContaining({
					uid: 123,
					replyAll: false,
					error: 'Connection refused',
				}),
			);
		});
	});

	describe('markEmailAsSeen', () => {
		it('returns success message when email is marked as seen', async () => {
			mockProvider.markEmailAsSeen.mockResolvedValue(undefined);

			const result = await markEmailAsSeen('INBOX', 456);

			expect(result).toBe('Email (UID: 456) in folder "INBOX" has been marked as seen/read.');
			expect(mockProvider.markEmailAsSeen).toHaveBeenCalledWith('INBOX', 456);
		});

		it('returns error message and logs on failure', async () => {
			mockProvider.markEmailAsSeen.mockRejectedValue(new Error('IMAP flag error'));

			const result = await markEmailAsSeen('INBOX', 789);

			expect(result).toBe('Error marking email as seen: IMAP flag error');
			expect(logger.error).toHaveBeenCalledWith(
				'Mark email as seen failed',
				expect.objectContaining({
					folder: 'INBOX',
					uid: 789,
					error: 'IMAP flag error',
				}),
			);
		});
	});
});
