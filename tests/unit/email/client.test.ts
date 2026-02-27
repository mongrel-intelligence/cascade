import { describe, expect, it } from 'vitest';
import { getEmailCredentials, withEmailCredentials } from '../../../src/email/client.js';

describe('email client credential scoping', () => {
	describe('withEmailCredentials', () => {
		it('makes credentials available inside the callback', async () => {
			const creds = {
				imapHost: 'imap.test.com',
				imapPort: 993,
				smtpHost: 'smtp.test.com',
				smtpPort: 587,
				username: 'test@test.com',
				password: 'password123',
			};

			let capturedCreds: typeof creds | undefined;
			await withEmailCredentials(creds, async () => {
				capturedCreds = getEmailCredentials();
			});

			expect(capturedCreds).toEqual(creds);
		});

		it('returns the result of the callback', async () => {
			const creds = {
				imapHost: 'imap.test.com',
				imapPort: 993,
				smtpHost: 'smtp.test.com',
				smtpPort: 587,
				username: 'test@test.com',
				password: 'password123',
			};

			const result = await withEmailCredentials(creds, async () => 'test-result');
			expect(result).toBe('test-result');
		});

		it('credentials are not available outside the callback', async () => {
			const creds = {
				imapHost: 'imap.test.com',
				imapPort: 993,
				smtpHost: 'smtp.test.com',
				smtpPort: 587,
				username: 'test@test.com',
				password: 'password123',
			};

			await withEmailCredentials(creds, async () => {});

			expect(() => getEmailCredentials()).toThrow(
				'No email credentials in scope. Wrap the call with withEmailCredentials()',
			);
		});
	});

	describe('getEmailCredentials', () => {
		it('throws when no credentials are in scope', () => {
			expect(() => getEmailCredentials()).toThrow(
				'No email credentials in scope. Wrap the call with withEmailCredentials()',
			);
		});
	});
});
