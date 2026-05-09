import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetResolvedTriggerConfig, mockLogger } = vi.hoisted(() => ({
	mockGetResolvedTriggerConfig: vi.fn(),
	mockLogger: {
		info: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock('../../../../src/triggers/config-resolver.js', () => ({
	getResolvedTriggerConfig: mockGetResolvedTriggerConfig,
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: mockLogger,
}));

import {
	checkTriggerEnabled,
	checkTriggerEnabledWithParams,
	checkTriggerEnablement,
} from '../../../../src/triggers/shared/trigger-check.js';

const PROJECT_ID = 'project-1';
const AGENT_TYPE = 'implementation';
const TRIGGER_EVENT = 'pm:status-changed';
const HANDLER_NAME = 'test-handler';

describe('checkTriggerEnablement', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('returns enabled=true, merged parameters, and no skip when trigger is enabled', async () => {
		mockGetResolvedTriggerConfig.mockResolvedValue({
			event: TRIGGER_EVENT,
			enabled: true,
			parameters: { authorMode: 'own' },
			isCustomized: false,
		});

		const result = await checkTriggerEnablement(
			PROJECT_ID,
			AGENT_TYPE,
			TRIGGER_EVENT,
			HANDLER_NAME,
		);

		expect(result).toEqual({
			enabled: true,
			parameters: { authorMode: 'own' },
			skipResult: null,
		});
	});

	it('returns enabled=false, default parameters, and structured skip when config is disabled', async () => {
		mockGetResolvedTriggerConfig.mockResolvedValue({
			event: TRIGGER_EVENT,
			enabled: false,
			parameters: { authorMode: 'own' },
			isCustomized: true,
		});

		const result = await checkTriggerEnablement(
			PROJECT_ID,
			AGENT_TYPE,
			TRIGGER_EVENT,
			HANDLER_NAME,
		);

		expect(result.enabled).toBe(false);
		expect(result.parameters).toEqual({ authorMode: 'own' });
		expect(result.skipResult?.agentType).toBeNull();
		expect(result.skipResult?.skipReason).toEqual({
			handler: HANDLER_NAME,
			message: `${AGENT_TYPE} trigger is disabled for this project`,
		});
	});

	it('returns enabled=false, empty parameters, and structured skip when config is missing', async () => {
		mockGetResolvedTriggerConfig.mockResolvedValue(null);

		const result = await checkTriggerEnablement(
			PROJECT_ID,
			AGENT_TYPE,
			TRIGGER_EVENT,
			HANDLER_NAME,
		);

		expect(result.enabled).toBe(false);
		expect(result.parameters).toEqual({});
		expect(result.skipResult?.skipReason?.message).toBe(
			`${AGENT_TYPE} trigger is disabled for this project`,
		);
	});

	it('logs skip message when trigger is disabled', async () => {
		mockGetResolvedTriggerConfig.mockResolvedValue(null);

		await checkTriggerEnablement(PROJECT_ID, AGENT_TYPE, TRIGGER_EVENT, HANDLER_NAME);

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

		await checkTriggerEnablement(PROJECT_ID, AGENT_TYPE, TRIGGER_EVENT, HANDLER_NAME);

		expect(mockLogger.info).not.toHaveBeenCalled();
	});

	it('performs one resolved config lookup', async () => {
		mockGetResolvedTriggerConfig.mockResolvedValue({
			event: TRIGGER_EVENT,
			enabled: true,
			parameters: {},
			isCustomized: false,
		});

		await checkTriggerEnablement(PROJECT_ID, AGENT_TYPE, TRIGGER_EVENT, HANDLER_NAME);

		expect(mockGetResolvedTriggerConfig).toHaveBeenCalledTimes(1);
		expect(mockGetResolvedTriggerConfig).toHaveBeenCalledWith(
			PROJECT_ID,
			AGENT_TYPE,
			TRIGGER_EVENT,
		);
	});
});

describe('checkTriggerEnabled', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('returns true when trigger is enabled', async () => {
		mockGetResolvedTriggerConfig.mockResolvedValue({
			event: TRIGGER_EVENT,
			enabled: true,
			parameters: {},
			isCustomized: false,
		});

		const result = await checkTriggerEnabled(PROJECT_ID, AGENT_TYPE, TRIGGER_EVENT, HANDLER_NAME);

		expect(result).toBe(true);
	});

	it('returns false when trigger is disabled', async () => {
		mockGetResolvedTriggerConfig.mockResolvedValue(null);

		const result = await checkTriggerEnabled(PROJECT_ID, AGENT_TYPE, TRIGGER_EVENT, HANDLER_NAME);

		expect(result).toBe(false);
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
