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
				config: { organizationSlug: 'my-org', projectSlug: 'api' },
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
				config: { organizationSlug: 12345, projectSlug: 'api' },
			});

			const result = await getSentryIntegrationConfig('proj-1');

			expect(result).toBeNull();
		});

		it('returns null when config is missing projectSlug', async () => {
			mockGetIntegrationByProjectAndCategory.mockResolvedValueOnce({
				id: 'int-1',
				provider: 'sentry',
				config: { organizationSlug: 'my-org' },
			});

			const result = await getSentryIntegrationConfig('proj-1');

			expect(result).toBeNull();
		});

		it('returns null when projectSlug is not a string', async () => {
			mockGetIntegrationByProjectAndCategory.mockResolvedValueOnce({
				id: 'int-1',
				provider: 'sentry',
				config: { organizationSlug: 'my-org', projectSlug: 12345 },
			});

			const result = await getSentryIntegrationConfig('proj-1');

			expect(result).toBeNull();
		});

		it('returns null when required slugs are blank strings', async () => {
			mockGetIntegrationByProjectAndCategory.mockResolvedValueOnce({
				id: 'int-1',
				provider: 'sentry',
				config: { organizationSlug: '  ', projectSlug: '\t' },
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
				config: { organizationSlug: 'my-company', projectSlug: 'api' },
			});

			const result = await getSentryIntegrationConfig('proj-1');

			expect(result).toEqual({ organizationSlug: 'my-company', projectSlug: 'api' });
		});

		it('returns normalized slugs from config', async () => {
			mockGetIntegrationByProjectAndCategory.mockResolvedValueOnce({
				id: 'int-2',
				provider: 'sentry',
				config: { organizationSlug: ' acme-corp ', projectSlug: ' web ', extraField: 'ignored' },
			});

			const result = await getSentryIntegrationConfig('proj-2');

			expect(result).toEqual({ organizationSlug: 'acme-corp', projectSlug: 'web' });
		});

		it('returns resultsContainerId when present in config', async () => {
			mockGetIntegrationByProjectAndCategory.mockResolvedValueOnce({
				id: 'int-3',
				provider: 'sentry',
				config: {
					organizationSlug: 'my-org',
					projectSlug: 'api',
					resultsContainerId: 'list-backlog-123',
				},
			});

			const result = await getSentryIntegrationConfig('proj-3');

			expect(result).toEqual({
				organizationSlug: 'my-org',
				projectSlug: 'api',
				resultsContainerId: 'list-backlog-123',
			});
		});

		it('omits resultsContainerId when absent from config', async () => {
			mockGetIntegrationByProjectAndCategory.mockResolvedValueOnce({
				id: 'int-4',
				provider: 'sentry',
				config: { organizationSlug: 'my-org', projectSlug: 'api' },
			});

			const result = await getSentryIntegrationConfig('proj-4');

			expect(result).toEqual({ organizationSlug: 'my-org', projectSlug: 'api' });
			expect(result?.resultsContainerId).toBeUndefined();
		});

		it('omits resultsContainerId when it is not a string', async () => {
			mockGetIntegrationByProjectAndCategory.mockResolvedValueOnce({
				id: 'int-5',
				provider: 'sentry',
				config: { organizationSlug: 'my-org', projectSlug: 'api', resultsContainerId: 42 },
			});

			const result = await getSentryIntegrationConfig('proj-5');

			expect(result?.resultsContainerId).toBeUndefined();
		});

		it('omits resultsContainerId when it is blank', async () => {
			mockGetIntegrationByProjectAndCategory.mockResolvedValueOnce({
				id: 'int-6',
				provider: 'sentry',
				config: { organizationSlug: 'my-org', projectSlug: 'api', resultsContainerId: '  ' },
			});

			const result = await getSentryIntegrationConfig('proj-6');

			expect(result).toEqual({ organizationSlug: 'my-org', projectSlug: 'api' });
			expect(result?.resultsContainerId).toBeUndefined();
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
