import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockIsTriggerEnabled, mockGetResolvedTriggerConfig, mockLogger } = vi.hoisted(() => ({
	mockIsTriggerEnabled: vi.fn(),
	mockGetResolvedTriggerConfig: vi.fn(),
	mockLogger: {
		info: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock('../../../../src/triggers/config-resolver.js', () => ({
	isTriggerEnabled: mockIsTriggerEnabled,
	getResolvedTriggerConfig: mockGetResolvedTriggerConfig,
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: mockLogger,
}));

import {
	checkTriggerEnabled,
	checkTriggerEnabledWithParams,
} from '../../../../src/triggers/shared/trigger-check.js';

const PROJECT_ID = 'project-1';
const AGENT_TYPE = 'implementation';
const TRIGGER_EVENT = 'pm:status-changed';
const HANDLER_NAME = 'test-handler';

describe('checkTriggerEnabled', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('returns true when trigger is enabled', async () => {
		mockIsTriggerEnabled.mockResolvedValue(true);

		const result = await checkTriggerEnabled(PROJECT_ID, AGENT_TYPE, TRIGGER_EVENT, HANDLER_NAME);

		expect(result).toBe(true);
	});

	it('returns false when trigger is disabled', async () => {
		mockIsTriggerEnabled.mockResolvedValue(false);

		const result = await checkTriggerEnabled(PROJECT_ID, AGENT_TYPE, TRIGGER_EVENT, HANDLER_NAME);

		expect(result).toBe(false);
	});

	it('logs skip message when trigger is disabled', async () => {
		mockIsTriggerEnabled.mockResolvedValue(false);

		await checkTriggerEnabled(PROJECT_ID, AGENT_TYPE, TRIGGER_EVENT, HANDLER_NAME);

		expect(mockLogger.info).toHaveBeenCalledWith('Trigger disabled by config, skipping', {
			handler: HANDLER_NAME,
			agentType: AGENT_TYPE,
			triggerEvent: TRIGGER_EVENT,
			projectId: PROJECT_ID,
		});
	});

	it('does not log when trigger is enabled', async () => {
		mockIsTriggerEnabled.mockResolvedValue(true);

		await checkTriggerEnabled(PROJECT_ID, AGENT_TYPE, TRIGGER_EVENT, HANDLER_NAME);

		expect(mockLogger.info).not.toHaveBeenCalled();
	});

	it('passes all arguments to isTriggerEnabled', async () => {
		mockIsTriggerEnabled.mockResolvedValue(true);

		await checkTriggerEnabled(PROJECT_ID, AGENT_TYPE, TRIGGER_EVENT, HANDLER_NAME);

		expect(mockIsTriggerEnabled).toHaveBeenCalledWith(PROJECT_ID, AGENT_TYPE, TRIGGER_EVENT);
	});
});

describe('checkTriggerEnabledWithParams', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('returns enabled=true and parameters when config exists and is enabled', async () => {
		mockGetResolvedTriggerConfig.mockResolvedValue({
			event: TRIGGER_EVENT,
			enabled: true,
			parameters: { authorMode: 'own' },
			isCustomized: false,
		});

		const result = await checkTriggerEnabledWithParams(
			PROJECT_ID,
			AGENT_TYPE,
			TRIGGER_EVENT,
			HANDLER_NAME,
		);

		expect(result).toEqual({ enabled: true, parameters: { authorMode: 'own' } });
	});

	it('returns enabled=false and empty parameters when config is null', async () => {
		mockGetResolvedTriggerConfig.mockResolvedValue(null);

		const result = await checkTriggerEnabledWithParams(
			PROJECT_ID,
			AGENT_TYPE,
			TRIGGER_EVENT,
			HANDLER_NAME,
		);

		expect(result).toEqual({ enabled: false, parameters: {} });
	});

	it('returns enabled=false when config.enabled is false', async () => {
		mockGetResolvedTriggerConfig.mockResolvedValue({
			event: TRIGGER_EVENT,
			enabled: false,
			parameters: { authorMode: 'own' },
			isCustomized: true,
		});

		const result = await checkTriggerEnabledWithParams(
			PROJECT_ID,
			AGENT_TYPE,
			TRIGGER_EVENT,
			HANDLER_NAME,
		);

		expect(result).toEqual({ enabled: false, parameters: {} });
	});

	it('logs skip message when trigger is disabled', async () => {
		mockGetResolvedTriggerConfig.mockResolvedValue(null);

		await checkTriggerEnabledWithParams(PROJECT_ID, AGENT_TYPE, TRIGGER_EVENT, HANDLER_NAME);

		expect(mockLogger.info).toHaveBeenCalledWith('Trigger disabled by config, skipping', {
			handler: HANDLER_NAME,
			agentType: AGENT_TYPE,
			triggerEvent: TRIGGER_EVENT,
			projectId: PROJECT_ID,
		});
	});

	it('does not log when trigger is enabled', async () => {
		mockGetResolvedTriggerConfig.mockResolvedValue({
			event: TRIGGER_EVENT,
			enabled: true,
			parameters: {},
			isCustomized: false,
		});

		await checkTriggerEnabledWithParams(PROJECT_ID, AGENT_TYPE, TRIGGER_EVENT, HANDLER_NAME);

		expect(mockLogger.info).not.toHaveBeenCalled();
	});
});
