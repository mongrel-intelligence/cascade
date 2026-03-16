import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetIntegrationByProjectAndCategory, mockLogger } = vi.hoisted(() => ({
	mockGetIntegrationByProjectAndCategory: vi.fn(),
	mockLogger: {
		info: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock('../../../../src/db/repositories/integrationsRepository.js', () => ({
	getIntegrationByProjectAndCategory: mockGetIntegrationByProjectAndCategory,
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: mockLogger,
}));

import { isLifecycleTriggerEnabled } from '../../../../src/triggers/shared/lifecycle-check.js';

const PROJECT_ID = 'project-1';
const HANDLER_NAME = 'test-handler';

describe('isLifecycleTriggerEnabled', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('returns true when lifecycle trigger is explicitly enabled in scm integration', async () => {
		mockGetIntegrationByProjectAndCategory.mockResolvedValue({
			id: 1,
			projectId: PROJECT_ID,
			category: 'scm',
			provider: 'github',
			config: {},
			triggers: { prReadyToMerge: true, prMerged: false },
		});

		const result = await isLifecycleTriggerEnabled(PROJECT_ID, 'prReadyToMerge', HANDLER_NAME);

		expect(result).toBe(true);
	});

	it('returns false when lifecycle trigger is explicitly disabled', async () => {
		mockGetIntegrationByProjectAndCategory.mockResolvedValue({
			id: 1,
			projectId: PROJECT_ID,
			category: 'scm',
			provider: 'github',
			config: {},
			triggers: { prReadyToMerge: false },
		});

		const result = await isLifecycleTriggerEnabled(PROJECT_ID, 'prReadyToMerge', HANDLER_NAME);

		expect(result).toBe(false);
	});

	it('returns false when trigger key is not present (default disabled)', async () => {
		mockGetIntegrationByProjectAndCategory.mockResolvedValue({
			id: 1,
			projectId: PROJECT_ID,
			category: 'scm',
			provider: 'github',
			config: {},
			triggers: {},
		});

		const result = await isLifecycleTriggerEnabled(PROJECT_ID, 'prReadyToMerge', HANDLER_NAME);

		expect(result).toBe(false);
	});

	it('returns false when no scm integration exists', async () => {
		mockGetIntegrationByProjectAndCategory.mockResolvedValue(null);

		const result = await isLifecycleTriggerEnabled(PROJECT_ID, 'prMerged', HANDLER_NAME);

		expect(result).toBe(false);
	});

	it('returns false when triggers column is null', async () => {
		mockGetIntegrationByProjectAndCategory.mockResolvedValue({
			id: 1,
			projectId: PROJECT_ID,
			category: 'scm',
			provider: 'github',
			config: {},
			triggers: null,
		});

		const result = await isLifecycleTriggerEnabled(PROJECT_ID, 'prMerged', HANDLER_NAME);

		expect(result).toBe(false);
	});

	it('logs skip message when trigger is disabled', async () => {
		mockGetIntegrationByProjectAndCategory.mockResolvedValue(null);

		await isLifecycleTriggerEnabled(PROJECT_ID, 'prReadyToMerge', HANDLER_NAME);

		expect(mockLogger.info).toHaveBeenCalledWith('Lifecycle trigger disabled by config, skipping', {
			handler: HANDLER_NAME,
			triggerKey: 'prReadyToMerge',
			projectId: PROJECT_ID,
		});
	});

	it('does not log when trigger is enabled', async () => {
		mockGetIntegrationByProjectAndCategory.mockResolvedValue({
			id: 1,
			projectId: PROJECT_ID,
			category: 'scm',
			provider: 'github',
			config: {},
			triggers: { prReadyToMerge: true },
		});

		await isLifecycleTriggerEnabled(PROJECT_ID, 'prReadyToMerge', HANDLER_NAME);

		expect(mockLogger.info).not.toHaveBeenCalled();
	});

	it('queries the scm integration category', async () => {
		mockGetIntegrationByProjectAndCategory.mockResolvedValue(null);

		await isLifecycleTriggerEnabled(PROJECT_ID, 'prMerged', HANDLER_NAME);

		expect(mockGetIntegrationByProjectAndCategory).toHaveBeenCalledWith(PROJECT_ID, 'scm');
	});
});
