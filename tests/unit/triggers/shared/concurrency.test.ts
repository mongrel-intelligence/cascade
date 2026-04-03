import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — declared before imports so module-level singletons are mocked
// ---------------------------------------------------------------------------

const {
	mockCheckAgentTypeConcurrency,
	mockMarkAgentTypeEnqueued,
	mockClearAgentTypeEnqueued,
	mockMarkRecentlyDispatched,
} = vi.hoisted(() => ({
	mockCheckAgentTypeConcurrency: vi.fn(),
	mockMarkAgentTypeEnqueued: vi.fn(),
	mockClearAgentTypeEnqueued: vi.fn(),
	mockMarkRecentlyDispatched: vi.fn(),
}));

vi.mock('../../../../src/router/agent-type-lock.js', () => ({
	checkAgentTypeConcurrency: mockCheckAgentTypeConcurrency,
	markAgentTypeEnqueued: mockMarkAgentTypeEnqueued,
	clearAgentTypeEnqueued: mockClearAgentTypeEnqueued,
	markRecentlyDispatched: mockMarkRecentlyDispatched,
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

import { withAgentTypeConcurrency } from '../../../../src/triggers/shared/concurrency.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = 'project-1';
const AGENT_TYPE = 'implementation';

beforeEach(() => {
	vi.clearAllMocks();
	// Default: no limit, not blocked
	mockCheckAgentTypeConcurrency.mockResolvedValue({ maxConcurrency: null, blocked: false });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('withAgentTypeConcurrency', () => {
	it('calls fn and returns true when not blocked and no limit', async () => {
		const fn = vi.fn().mockResolvedValue(undefined);
		mockCheckAgentTypeConcurrency.mockResolvedValue({ maxConcurrency: null, blocked: false });

		const result = await withAgentTypeConcurrency(PROJECT_ID, AGENT_TYPE, fn);

		expect(result).toBe(true);
		expect(fn).toHaveBeenCalledOnce();
	});

	it('returns false and does not call fn when blocked', async () => {
		const fn = vi.fn().mockResolvedValue(undefined);
		mockCheckAgentTypeConcurrency.mockResolvedValue({ maxConcurrency: 1, blocked: true });

		const result = await withAgentTypeConcurrency(PROJECT_ID, AGENT_TYPE, fn);

		expect(result).toBe(false);
		expect(fn).not.toHaveBeenCalled();
	});

	it('marks enqueued and dispatched when limit is set (not null)', async () => {
		const fn = vi.fn().mockResolvedValue(undefined);
		mockCheckAgentTypeConcurrency.mockResolvedValue({ maxConcurrency: 2, blocked: false });

		await withAgentTypeConcurrency(PROJECT_ID, AGENT_TYPE, fn);

		expect(mockMarkRecentlyDispatched).toHaveBeenCalledWith(PROJECT_ID, AGENT_TYPE);
		expect(mockMarkAgentTypeEnqueued).toHaveBeenCalledWith(PROJECT_ID, AGENT_TYPE);
	});

	it('does not mark enqueued when no limit (maxConcurrency null)', async () => {
		const fn = vi.fn().mockResolvedValue(undefined);
		mockCheckAgentTypeConcurrency.mockResolvedValue({ maxConcurrency: null, blocked: false });

		await withAgentTypeConcurrency(PROJECT_ID, AGENT_TYPE, fn);

		expect(mockMarkRecentlyDispatched).not.toHaveBeenCalled();
		expect(mockMarkAgentTypeEnqueued).not.toHaveBeenCalled();
	});

	it('clears enqueued slot in finally block when limit is set', async () => {
		const fn = vi.fn().mockResolvedValue(undefined);
		mockCheckAgentTypeConcurrency.mockResolvedValue({ maxConcurrency: 1, blocked: false });

		await withAgentTypeConcurrency(PROJECT_ID, AGENT_TYPE, fn);

		expect(mockClearAgentTypeEnqueued).toHaveBeenCalledWith(PROJECT_ID, AGENT_TYPE);
	});

	it('does not clear enqueued slot when no limit', async () => {
		const fn = vi.fn().mockResolvedValue(undefined);
		mockCheckAgentTypeConcurrency.mockResolvedValue({ maxConcurrency: null, blocked: false });

		await withAgentTypeConcurrency(PROJECT_ID, AGENT_TYPE, fn);

		expect(mockClearAgentTypeEnqueued).not.toHaveBeenCalled();
	});

	it('clears enqueued slot even when fn throws', async () => {
		const fn = vi.fn().mockRejectedValue(new Error('agent crashed'));
		mockCheckAgentTypeConcurrency.mockResolvedValue({ maxConcurrency: 1, blocked: false });

		await expect(withAgentTypeConcurrency(PROJECT_ID, AGENT_TYPE, fn)).rejects.toThrow(
			'agent crashed',
		);

		expect(mockClearAgentTypeEnqueued).toHaveBeenCalledWith(PROJECT_ID, AGENT_TYPE);
	});

	it('does not clear enqueued slot when blocked (fn never ran)', async () => {
		const fn = vi.fn();
		mockCheckAgentTypeConcurrency.mockResolvedValue({ maxConcurrency: 1, blocked: true });

		await withAgentTypeConcurrency(PROJECT_ID, AGENT_TYPE, fn);

		expect(mockClearAgentTypeEnqueued).not.toHaveBeenCalled();
	});

	it('passes logLabel to checkAgentTypeConcurrency', async () => {
		const fn = vi.fn().mockResolvedValue(undefined);
		mockCheckAgentTypeConcurrency.mockResolvedValue({ maxConcurrency: null, blocked: false });

		await withAgentTypeConcurrency(PROJECT_ID, AGENT_TYPE, fn, 'My handler');

		expect(mockCheckAgentTypeConcurrency).toHaveBeenCalledWith(
			PROJECT_ID,
			AGENT_TYPE,
			'My handler',
		);
	});
});
