import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockOraInstance = {
	start: vi.fn().mockReturnThis(),
	stop: vi.fn().mockReturnThis(),
};

const mockOra = vi.fn().mockReturnValue(mockOraInstance);

vi.mock('ora', () => ({
	default: (...args: unknown[]) => mockOra(...args),
}));

import { isSilentMode, withSpinner } from '../../../../src/cli/dashboard/_shared/spinner.js';

describe('isSilentMode', () => {
	beforeEach(() => {
		vi.unstubAllEnvs();
	});

	it('returns false when no env vars set and no option', () => {
		vi.stubEnv('NO_COLOR', '');
		vi.stubEnv('CI', '');
		expect(isSilentMode()).toBe(false);
	});

	it('returns true when silent option is true', () => {
		vi.stubEnv('NO_COLOR', '');
		vi.stubEnv('CI', '');
		expect(isSilentMode({ silent: true })).toBe(true);
	});

	it('returns false when silent option is false', () => {
		vi.stubEnv('NO_COLOR', '');
		vi.stubEnv('CI', '');
		expect(isSilentMode({ silent: false })).toBe(false);
	});

	it('returns true when NO_COLOR is set', () => {
		vi.stubEnv('NO_COLOR', '1');
		expect(isSilentMode()).toBe(true);
	});

	it('returns true when CI is set', () => {
		vi.stubEnv('CI', '1');
		expect(isSilentMode()).toBe(true);
	});

	it('returns true when CI=true', () => {
		vi.stubEnv('CI', 'true');
		expect(isSilentMode()).toBe(true);
	});
});

describe('withSpinner', () => {
	beforeEach(() => {
		vi.unstubAllEnvs();
		mockOraInstance.start.mockClear();
		mockOraInstance.stop.mockClear();
		mockOra.mockClear();
	});

	it('returns the result of fn on success', async () => {
		const result = await withSpinner('Loading...', async () => 42, { silent: true });
		expect(result).toBe(42);
	});

	it('propagates errors from fn', async () => {
		await expect(
			withSpinner(
				'Loading...',
				async () => {
					throw new Error('oops');
				},
				{ silent: true },
			),
		).rejects.toThrow('oops');
	});

	it('shows spinner when not silent', async () => {
		vi.stubEnv('NO_COLOR', '');
		vi.stubEnv('CI', '');
		await withSpinner('Loading...', async () => 'done');

		expect(mockOra).toHaveBeenCalledWith('Loading...');
		expect(mockOraInstance.start).toHaveBeenCalled();
		expect(mockOraInstance.stop).toHaveBeenCalled();
	});

	it('stops spinner even when fn throws', async () => {
		vi.stubEnv('NO_COLOR', '');
		vi.stubEnv('CI', '');
		await expect(
			withSpinner('Loading...', async () => {
				throw new Error('fail');
			}),
		).rejects.toThrow('fail');

		expect(mockOraInstance.stop).toHaveBeenCalled();
	});

	it('does not create spinner in silent mode (silent option)', async () => {
		await withSpinner('Loading...', async () => 'done', { silent: true });

		expect(mockOra).not.toHaveBeenCalled();
	});

	it('does not create spinner when NO_COLOR is set', async () => {
		vi.stubEnv('NO_COLOR', '1');

		await withSpinner('Loading...', async () => 'done');

		expect(mockOra).not.toHaveBeenCalled();
	});

	it('does not create spinner when CI is set', async () => {
		vi.stubEnv('CI', '1');

		await withSpinner('Loading...', async () => 'done');

		expect(mockOra).not.toHaveBeenCalled();
	});

	it('passes the message to ora', async () => {
		vi.stubEnv('NO_COLOR', '');
		vi.stubEnv('CI', '');
		await withSpinner('Fetching data...', async () => null);

		expect(mockOra).toHaveBeenCalledWith('Fetching data...');
	});
});
