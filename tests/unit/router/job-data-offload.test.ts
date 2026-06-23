import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockSet = vi.fn();
const mockGet = vi.fn();
const mockDel = vi.fn();

vi.mock('ioredis', () => ({
	Redis: vi.fn().mockImplementation(() => ({
		set: mockSet,
		get: mockGet,
		del: mockDel,
	})),
}));

vi.mock('../../../src/router/config.js', () => ({
	routerConfig: { redisUrl: 'redis://localhost:6379' },
}));

vi.mock('../../../src/sentry.js', () => ({
	captureException: vi.fn(),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
	buildJobDataRedisKey,
	JOB_DATA_OFFLOAD_TTL_SEC,
	offloadJobData,
	readOffloadedJobData,
} from '../../../src/router/job-data-offload.js';
import { captureException } from '../../../src/sentry.js';

beforeEach(() => {
	mockSet.mockReset().mockResolvedValue('OK');
	mockGet.mockReset();
	mockDel.mockReset().mockResolvedValue(1);
	vi.mocked(captureException).mockClear();
});

describe('buildJobDataRedisKey', () => {
	it('namespaces the jobId under cascade:jobdata:', () => {
		expect(buildJobDataRedisKey('coalesce_ucho_MNG-1660_123_abc')).toBe(
			'cascade:jobdata:coalesce_ucho_MNG-1660_123_abc',
		);
	});
});

describe('offloadJobData', () => {
	it('SETs the serialized payload under the namespaced key with the TTL', async () => {
		await offloadJobData('job-1', '{"big":"payload"}');
		expect(mockSet).toHaveBeenCalledWith(
			'cascade:jobdata:job-1',
			'{"big":"payload"}',
			'EX',
			JOB_DATA_OFFLOAD_TTL_SEC,
		);
	});

	it('throws a descriptive error and captures on Redis failure', async () => {
		mockSet.mockRejectedValueOnce(new Error('ECONNREFUSED'));
		await expect(offloadJobData('job-x', '{}')).rejects.toThrow(
			/Failed to offload JOB_DATA to Redis for job job-x/,
		);
		expect(captureException).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ tags: { source: 'job_data_offload_write' } }),
		);
	});
});

describe('readOffloadedJobData', () => {
	it('GETs the payload, deletes the key, and returns the value', async () => {
		mockGet.mockResolvedValueOnce('{"restored":true}');
		const value = await readOffloadedJobData('cascade:jobdata:job-1');
		expect(mockGet).toHaveBeenCalledWith('cascade:jobdata:job-1');
		expect(value).toBe('{"restored":true}');
		expect(mockDel).toHaveBeenCalledWith('cascade:jobdata:job-1');
	});

	it('throws a "not found" error when the key is missing/expired (GET returns null)', async () => {
		mockGet.mockResolvedValueOnce(null);
		await expect(readOffloadedJobData('cascade:jobdata:gone')).rejects.toThrow(
			/not found in Redis \(expired or never written\)/,
		);
		expect(mockDel).not.toHaveBeenCalled();
	});

	it('throws when Redis GET fails', async () => {
		mockGet.mockRejectedValueOnce(new Error('ECONNRESET'));
		await expect(readOffloadedJobData('cascade:jobdata:job-1')).rejects.toThrow(
			/Failed to read offloaded JOB_DATA from Redis/,
		);
	});

	it('still returns the value when the best-effort DEL fails (TTL reaps it)', async () => {
		mockGet.mockResolvedValueOnce('{"restored":true}');
		mockDel.mockRejectedValueOnce(new Error('DEL failed'));
		const value = await readOffloadedJobData('cascade:jobdata:job-1');
		expect(value).toBe('{"restored":true}');
	});
});
