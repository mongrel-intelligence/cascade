import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted to the top of the file, so variables used
// inside them must be created with vi.hoisted().
const { mockSend, mockCreateTransport } = vi.hoisted(() => {
	const mockSend = vi.fn().mockResolvedValue({ data: { id: 'gmail-msg-id-1' } });

	const rawBuf = Buffer.from('raw-email-content');
	async function* makeStream() {
		yield rawBuf;
	}
	const mockSendMail = vi.fn().mockResolvedValue({ message: makeStream() });
	const mockCreateTransport = vi.fn().mockReturnValue({ sendMail: mockSendMail });

	return { mockSend, mockCreateTransport };
});

vi.mock('nodemailer', () => ({
	default: { createTransport: mockCreateTransport },
	__esModule: true,
}));

vi.mock('@googleapis/gmail', () => ({
	gmail: vi.fn().mockReturnValue({
		users: { messages: { send: mockSend } },
	}),
	__esModule: true,
}));

vi.mock('google-auth-library', () => ({
	OAuth2Client: vi.fn().mockImplementation(() => ({
		setCredentials: vi.fn(),
	})),
	__esModule: true,
}));

// --- imports -----------------------------------------------------------------

import { replyViaGmailApi, sendViaGmailApi } from '../../../../src/email/gmail/send.js';
import type {
	EmailMessage,
	ReplyEmailOptions,
	SendEmailOptions,
} from '../../../../src/email/types.js';

// --- helpers -----------------------------------------------------------------

function makeSendOptions(overrides: Partial<SendEmailOptions> = {}): SendEmailOptions {
	return {
		to: ['recipient@example.com'],
		subject: 'Test subject',
		body: 'Test body',
		...overrides,
	};
}

function makeOriginal(overrides: Partial<EmailMessage> = {}): EmailMessage {
	return {
		uid: 42,
		messageId: 'original-msg-id',
		date: new Date('2024-01-01'),
		from: 'sender@example.com',
		to: ['me@example.com', 'other@example.com'],
		cc: ['cc@example.com'],
		subject: 'Hello',
		textBody: 'Original body',
		attachments: [],
		references: ['ref-id-1'],
		...overrides,
	};
}

function makeReplyOptions(overrides: Partial<ReplyEmailOptions> = {}): ReplyEmailOptions {
	return {
		folder: 'INBOX',
		uid: 42,
		body: 'Reply body',
		replyAll: false,
		...overrides,
	};
}

/** Helper: get the mail options passed to the most recent nodemailer sendMail call */
function getLastMailOptions(): Record<string, unknown> {
	const transport = mockCreateTransport.mock.results.at(-1)?.value as {
		sendMail: ReturnType<typeof vi.fn>;
	};
	return (transport?.sendMail.mock.calls.at(-1)?.[0] ?? {}) as Record<string, unknown>;
}

// --- tests -------------------------------------------------------------------

describe('sendViaGmailApi', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSend.mockResolvedValue({ data: { id: 'gmail-msg-id-1' } });

		// Re-configure nodemailer mock with a fresh stream each test
		const rawBuf = Buffer.from('raw-email-content');
		async function* makeStream() {
			yield rawBuf;
		}
		const mockSendMail = vi.fn().mockResolvedValue({ message: makeStream() });
		mockCreateTransport.mockReturnValue({ sendMail: mockSendMail });
	});

	it('returns correct accepted array and messageId on success', async () => {
		const options = makeSendOptions({ to: ['a@b.com', 'c@d.com'] });
		const result = await sendViaGmailApi(options, 'access-token-123', 'from@example.com');

		expect(result.messageId).toBe('<gmail-msg-id-1@mail.gmail.com>');
		expect(result.accepted).toEqual(['a@b.com', 'c@d.com']);
		expect(result.rejected).toEqual([]);
	});

	it('passes raw base64url message to Gmail API', async () => {
		const options = makeSendOptions();
		await sendViaGmailApi(options, 'tok', 'me@gmail.com');

		expect(mockSend).toHaveBeenCalledWith({
			userId: 'me',
			requestBody: { raw: expect.stringMatching(/^[A-Za-z0-9_-]+$/) },
		});
	});

	it('propagates Gmail API errors', async () => {
		mockSend.mockRejectedValue(new Error('API quota exceeded'));
		await expect(sendViaGmailApi(makeSendOptions(), 'tok', 'me@gmail.com')).rejects.toThrow(
			'API quota exceeded',
		);
	});
});

describe('replyViaGmailApi', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSend.mockResolvedValue({ data: { id: 'reply-msg-id-2' } });

		const rawBuf = Buffer.from('raw-reply-content');
		async function* makeStream() {
			yield rawBuf;
		}
		const mockSendMail = vi.fn().mockResolvedValue({ message: makeStream() });
		mockCreateTransport.mockReturnValue({ sendMail: mockSendMail });
	});

	it('reply-to-sender: single recipient, messageId from API response', async () => {
		const original = makeOriginal({ subject: 'Hello', messageId: 'orig-id' });
		const result = await replyViaGmailApi(
			makeReplyOptions({ replyAll: false }),
			original,
			'access-tok',
			'me@example.com',
		);

		expect(result.messageId).toBe('<reply-msg-id-2@mail.gmail.com>');
		expect(result.accepted).toEqual(['sender@example.com']);
		expect(result.rejected).toEqual([]);
	});

	it('reply-all: excludes self, includes original To and CC', async () => {
		const original = makeOriginal({
			from: 'sender@example.com',
			to: ['me@example.com', 'other@example.com'],
			cc: ['cc@example.com', 'me@example.com'],
		});
		const result = await replyViaGmailApi(
			makeReplyOptions({ replyAll: true }),
			original,
			'access-tok',
			'me@example.com',
		);

		expect(result.accepted).toContain('sender@example.com');
		expect(result.accepted).toContain('other@example.com');
		expect(result.accepted).toContain('cc@example.com');
		// self should be excluded
		expect(result.accepted.filter((a) => a.includes('me@example.com'))).toHaveLength(0);
	});

	it('does not double Re: prefix when subject already starts with Re:', async () => {
		const original = makeOriginal({ subject: 'Re: Already a reply' });
		await replyViaGmailApi(makeReplyOptions(), original, 'tok', 'me@example.com');

		const mailOpts = getLastMailOptions();
		expect(mailOpts.subject).toBe('Re: Already a reply');
	});

	it('adds Re: prefix when subject does not start with Re:', async () => {
		const original = makeOriginal({ subject: 'Plain subject' });
		await replyViaGmailApi(makeReplyOptions(), original, 'tok', 'me@example.com');

		const mailOpts = getLastMailOptions();
		expect(mailOpts.subject).toBe('Re: Plain subject');
	});

	it('propagates Gmail API errors on reply', async () => {
		mockSend.mockRejectedValue(new Error('Unauthorized'));
		await expect(
			replyViaGmailApi(makeReplyOptions(), makeOriginal(), 'bad-tok', 'me@example.com'),
		).rejects.toThrow('Unauthorized');
	});
});
