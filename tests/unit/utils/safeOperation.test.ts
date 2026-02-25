import { beforeEach, describe, expect, it, vi } from 'vitest';
import { safeOperation, silentOperation } from '../../../src/utils/safeOperation.js';

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		warn: vi.fn(),
	},
}));

import { logger } from '../../../src/utils/logging.js';

describe('safeOperation', () => {
	describe('safeOperation', () => {
		it('returns result on success', async () => {
			const result = await safeOperation(() => Promise.resolve('hello'), {
				action: 'test operation',
			});

			expect(result).toBe('hello');
		});

		it('returns undefined on failure', async () => {
			const result = await safeOperation(() => Promise.reject(new Error('fail')), {
				action: 'test operation',
			});

			expect(result).toBeUndefined();
		});

		it('logs warning on failure with context', async () => {
			await safeOperation(() => Promise.reject(new Error('something broke')), {
				action: 'fetch data',
				prNumber: 42,
			});

			expect(logger.warn).toHaveBeenCalledWith(
				'Failed to fetch data',
				expect.objectContaining({
					error: 'Error: something broke',
					action: 'fetch data',
					prNumber: 42,
				}),
			);
		});

		it('handles non-Error thrown values', async () => {
			await safeOperation(() => Promise.reject('string error'), { action: 'do thing' });

			expect(logger.warn).toHaveBeenCalledWith(
				'Failed to do thing',
				expect.objectContaining({
					error: 'string error',
				}),
			);
		});
	});

	describe('silentOperation', () => {
		it('returns result on success', async () => {
			const result = await silentOperation(() => Promise.resolve(42));

			expect(result).toBe(42);
		});

		it('returns undefined on failure', async () => {
			const result = await silentOperation(() => Promise.reject(new Error('fail')));

			expect(result).toBeUndefined();
		});

		it('does not log on failure', async () => {
			await silentOperation(() => Promise.reject(new Error('fail')));

			expect(logger.warn).not.toHaveBeenCalled();
		});
	});
});
