import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/db/repositories/integrationsRepository.js', () => ({
	getIntegrationByProjectAndCategory: vi.fn(),
}));

import { getIntegrationByProjectAndCategory } from '../../../src/db/repositories/integrationsRepository.js';
import { getSentryIntegrationConfig } from '../../../src/sentry/integration.js';

const mockGetIntegrationByProjectAndCategory = vi.mocked(getIntegrationByProjectAndCategory);

describe('sentry/integration', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	describe('getSentryIntegrationConfig', () => {
		it('returns null when no integration exists for the project', async () => {
			mockGetIntegrationByProjectAndCategory.mockResolvedValueOnce(null);

			const result = await getSentryIntegrationConfig('proj-1');

			expect(result).toBeNull();
			expect(mockGetIntegrationByProjectAndCategory).toHaveBeenCalledWith('proj-1', 'alerting');
		});

		it('returns null when integration has wrong provider (not sentry)', async () => {
			mockGetIntegrationByProjectAndCategory.mockResolvedValueOnce({
				id: 'int-1',
				provider: 'pagerduty',
				config: { organizationSlug: 'my-org' },
			});

			const result = await getSentryIntegrationConfig('proj-1');

			expect(result).toBeNull();
		});

		it('returns null when config is missing organizationSlug', async () => {
			mockGetIntegrationByProjectAndCategory.mockResolvedValueOnce({
				id: 'int-1',
				provider: 'sentry',
				config: { someOtherField: 'value' },
			});

			const result = await getSentryIntegrationConfig('proj-1');

			expect(result).toBeNull();
		});

		it('returns null when organizationSlug is not a string', async () => {
			mockGetIntegrationByProjectAndCategory.mockResolvedValueOnce({
				id: 'int-1',
				provider: 'sentry',
				config: { organizationSlug: 12345 },
			});

			const result = await getSentryIntegrationConfig('proj-1');

			expect(result).toBeNull();
		});

		it('returns null when config is null', async () => {
			mockGetIntegrationByProjectAndCategory.mockResolvedValueOnce({
				id: 'int-1',
				provider: 'sentry',
				config: null,
			});

			const result = await getSentryIntegrationConfig('proj-1');

			expect(result).toBeNull();
		});

		it('returns SentryIntegrationConfig when valid sentry integration exists', async () => {
			mockGetIntegrationByProjectAndCategory.mockResolvedValueOnce({
				id: 'int-1',
				provider: 'sentry',
				config: { organizationSlug: 'my-company' },
			});

			const result = await getSentryIntegrationConfig('proj-1');

			expect(result).toEqual({ organizationSlug: 'my-company' });
		});

		it('returns correct organizationSlug from config', async () => {
			mockGetIntegrationByProjectAndCategory.mockResolvedValueOnce({
				id: 'int-2',
				provider: 'sentry',
				config: { organizationSlug: 'acme-corp', extraField: 'ignored' },
			});

			const result = await getSentryIntegrationConfig('proj-2');

			expect(result).toEqual({ organizationSlug: 'acme-corp' });
		});

		it('queries using projectId and alerting category', async () => {
			mockGetIntegrationByProjectAndCategory.mockResolvedValueOnce(null);

			await getSentryIntegrationConfig('specific-proj-id');

			expect(mockGetIntegrationByProjectAndCategory).toHaveBeenCalledWith(
				'specific-proj-id',
				'alerting',
			);
		});
	});
});
