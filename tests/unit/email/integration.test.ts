import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/config/provider.js', () => ({
	getIntegrationCredential: vi.fn(),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import { getIntegrationCredential } from '../../../src/config/provider.js';
import {
	hasEmailIntegration,
	resolveEmailCredentials,
	withEmailIntegration,
} from '../../../src/email/integration.js';
import { logger } from '../../../src/utils/logging.js';

describe('email integration', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('resolveEmailCredentials', () => {
		it('returns credentials when all fields are present', async () => {
			vi.mocked(getIntegrationCredential).mockImplementation(
				async (_projectId, _category, role) => {
					const creds: Record<string, string> = {
						imap_host: 'imap.example.com',
						imap_port: '993',
						smtp_host: 'smtp.example.com',
						smtp_port: '587',
						username: 'user@example.com',
						password: 'secret',
					};
					return creds[role] ?? null;
				},
			);

			const result = await resolveEmailCredentials('project-1');

			expect(result).toEqual({
				imapHost: 'imap.example.com',
				imapPort: 993,
				smtpHost: 'smtp.example.com',
				smtpPort: 587,
				username: 'user@example.com',
				password: 'secret',
			});
		});

		it('returns null when a credential is missing', async () => {
			vi.mocked(getIntegrationCredential).mockImplementation(
				async (_projectId, _category, role) => {
					if (role === 'password') return null; // Missing password
					const creds: Record<string, string> = {
						imap_host: 'imap.example.com',
						imap_port: '993',
						smtp_host: 'smtp.example.com',
						smtp_port: '587',
						username: 'user@example.com',
					};
					return creds[role] ?? null;
				},
			);

			const result = await resolveEmailCredentials('project-1');
			expect(result).toBeNull();
		});

		it('returns null when port is not a valid number', async () => {
			vi.mocked(getIntegrationCredential).mockImplementation(
				async (_projectId, _category, role) => {
					const creds: Record<string, string> = {
						imap_host: 'imap.example.com',
						imap_port: 'invalid',
						smtp_host: 'smtp.example.com',
						smtp_port: '587',
						username: 'user@example.com',
						password: 'secret',
					};
					return creds[role] ?? null;
				},
			);

			const result = await resolveEmailCredentials('project-1');
			expect(result).toBeNull();
		});

		it('logs warning and returns null on error', async () => {
			vi.mocked(getIntegrationCredential).mockRejectedValue(new Error('DB error'));

			const result = await resolveEmailCredentials('project-1');

			expect(result).toBeNull();
			expect(logger.warn).toHaveBeenCalledWith(
				'Failed to resolve email credentials',
				expect.objectContaining({
					projectId: 'project-1',
					error: 'DB error',
				}),
			);
		});
	});

	describe('withEmailIntegration', () => {
		it('runs function with credentials when available', async () => {
			vi.mocked(getIntegrationCredential).mockImplementation(
				async (_projectId, _category, role) => {
					const creds: Record<string, string> = {
						imap_host: 'imap.example.com',
						imap_port: '993',
						smtp_host: 'smtp.example.com',
						smtp_port: '587',
						username: 'user@example.com',
						password: 'secret',
					};
					return creds[role] ?? null;
				},
			);

			const fn = vi.fn().mockResolvedValue('result');
			const result = await withEmailIntegration('project-1', fn);

			expect(fn).toHaveBeenCalled();
			expect(result).toBe('result');
		});

		it('runs function without credentials when not configured', async () => {
			vi.mocked(getIntegrationCredential).mockResolvedValue(null);

			const fn = vi.fn().mockResolvedValue('result');
			const result = await withEmailIntegration('project-1', fn);

			expect(fn).toHaveBeenCalled();
			expect(result).toBe('result');
		});
	});

	describe('hasEmailIntegration', () => {
		it('returns true when credentials are configured', async () => {
			vi.mocked(getIntegrationCredential).mockImplementation(
				async (_projectId, _category, role) => {
					const creds: Record<string, string> = {
						imap_host: 'imap.example.com',
						imap_port: '993',
						smtp_host: 'smtp.example.com',
						smtp_port: '587',
						username: 'user@example.com',
						password: 'secret',
					};
					return creds[role] ?? null;
				},
			);

			const result = await hasEmailIntegration('project-1');
			expect(result).toBe(true);
		});

		it('returns false when credentials are not configured', async () => {
			vi.mocked(getIntegrationCredential).mockResolvedValue(null);

			const result = await hasEmailIntegration('project-1');
			expect(result).toBe(false);
		});
	});
});
