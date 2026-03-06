import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/db/repositories/credentialsRepository.js', () => ({
	getIntegrationProvider: vi.fn(),
}));

vi.mock('../../../src/email/registry.js', () => ({
	emailRegistry: {
		getOrNull: vi.fn(),
	},
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import { getIntegrationProvider } from '../../../src/db/repositories/credentialsRepository.js';
import { hasEmailIntegration, withEmailIntegration } from '../../../src/email/integration.js';
import { emailRegistry } from '../../../src/email/registry.js';
import { logger } from '../../../src/utils/logging.js';

describe('email integration', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('withEmailIntegration', () => {
		it('runs fn directly when no provider is configured', async () => {
			vi.mocked(getIntegrationProvider).mockResolvedValue(null);

			const fn = vi.fn().mockResolvedValue('result');
			const result = await withEmailIntegration('project-1', fn);

			expect(fn).toHaveBeenCalled();
			expect(result).toBe('result');
		});

		it('runs fn directly when provider is unknown in registry', async () => {
			vi.mocked(getIntegrationProvider).mockResolvedValue('unknown-provider');
			vi.mocked(emailRegistry.getOrNull).mockReturnValue(null);

			const fn = vi.fn().mockResolvedValue('result');
			const result = await withEmailIntegration('project-1', fn);

			expect(fn).toHaveBeenCalled();
			expect(result).toBe('result');
		});

		it('delegates to the registered integration when provider is known', async () => {
			const mockIntegration = {
				type: 'imap',
				withCredentials: vi
					.fn()
					.mockImplementation((_projectId: string, fn: () => Promise<unknown>) => fn()),
				hasCredentials: vi.fn(),
			};

			vi.mocked(getIntegrationProvider).mockResolvedValue('imap');
			vi.mocked(emailRegistry.getOrNull).mockReturnValue(mockIntegration);

			const fn = vi.fn().mockResolvedValue('scoped-result');
			const result = await withEmailIntegration('project-1', fn);

			expect(mockIntegration.withCredentials).toHaveBeenCalledWith('project-1', fn);
			expect(result).toBe('scoped-result');
		});

		it('falls back to fn() and warns when getIntegrationProvider throws', async () => {
			vi.mocked(getIntegrationProvider).mockRejectedValue(new Error('DB error'));

			const fn = vi.fn().mockResolvedValue('fallback-result');
			const result = await withEmailIntegration('project-1', fn);

			expect(fn).toHaveBeenCalled();
			expect(result).toBe('fallback-result');
			expect(logger.warn).toHaveBeenCalledWith(
				'Failed to resolve email integration, running without email credentials',
				expect.objectContaining({ projectId: 'project-1', error: 'DB error' }),
			);
		});
	});

	describe('hasEmailIntegration', () => {
		it('returns false when no provider is configured', async () => {
			vi.mocked(getIntegrationProvider).mockResolvedValue(null);

			const result = await hasEmailIntegration('project-1');
			expect(result).toBe(false);
		});

		it('returns false when provider is unknown in registry', async () => {
			vi.mocked(getIntegrationProvider).mockResolvedValue('unknown-provider');
			vi.mocked(emailRegistry.getOrNull).mockReturnValue(null);

			const result = await hasEmailIntegration('project-1');
			expect(result).toBe(false);
		});

		it('delegates to registered integration hasCredentials', async () => {
			const mockIntegration = {
				type: 'imap',
				withCredentials: vi.fn(),
				hasCredentials: vi.fn().mockResolvedValue(true),
			};

			vi.mocked(getIntegrationProvider).mockResolvedValue('imap');
			vi.mocked(emailRegistry.getOrNull).mockReturnValue(mockIntegration);

			const result = await hasEmailIntegration('project-1');

			expect(mockIntegration.hasCredentials).toHaveBeenCalledWith('project-1');
			expect(result).toBe(true);
		});

		it('returns false when registered integration has no credentials', async () => {
			const mockIntegration = {
				type: 'imap',
				withCredentials: vi.fn(),
				hasCredentials: vi.fn().mockResolvedValue(false),
			};

			vi.mocked(getIntegrationProvider).mockResolvedValue('imap');
			vi.mocked(emailRegistry.getOrNull).mockReturnValue(mockIntegration);

			const result = await hasEmailIntegration('project-1');
			expect(result).toBe(false);
		});

		it('returns false when getIntegrationProvider throws', async () => {
			vi.mocked(getIntegrationProvider).mockRejectedValue(new Error('DB error'));

			const result = await hasEmailIntegration('project-1');
			expect(result).toBe(false);
		});
	});
});
