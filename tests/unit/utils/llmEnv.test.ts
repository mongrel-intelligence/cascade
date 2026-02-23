import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/config/provider.js', () => ({
	getOrgCredential: vi.fn(),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import { getOrgCredential } from '../../../src/config/provider.js';
import { injectLlmApiKeys } from '../../../src/utils/llmEnv.js';

const mockGetOrgCredential = vi.mocked(getOrgCredential);

beforeEach(() => {
	vi.clearAllMocks();
	// Clean up the env var before each test
	Reflect.deleteProperty(process.env, 'OPENROUTER_API_KEY');
});

afterEach(() => {
	Reflect.deleteProperty(process.env, 'OPENROUTER_API_KEY');
});

describe('injectLlmApiKeys', () => {
	it('injects OPENROUTER_API_KEY from DB into process.env', async () => {
		mockGetOrgCredential.mockResolvedValue('sk-or-test-key');

		await injectLlmApiKeys('project-1');

		expect(process.env.OPENROUTER_API_KEY).toBe('sk-or-test-key');
	});

	it('returns a restore function that removes injected key', async () => {
		mockGetOrgCredential.mockResolvedValue('sk-or-test-key');

		const restore = await injectLlmApiKeys('project-1');

		expect(process.env.OPENROUTER_API_KEY).toBe('sk-or-test-key');
		restore();
		expect(process.env.OPENROUTER_API_KEY).toBeUndefined();
	});

	it('restores previously set env var value on restore', async () => {
		process.env.OPENROUTER_API_KEY = 'original-key';
		mockGetOrgCredential.mockResolvedValue('new-key-from-db');

		const restore = await injectLlmApiKeys('project-1');

		expect(process.env.OPENROUTER_API_KEY).toBe('new-key-from-db');
		restore();
		expect(process.env.OPENROUTER_API_KEY).toBe('original-key');
	});

	it('does not set env var when DB returns null', async () => {
		mockGetOrgCredential.mockResolvedValue(null);

		await injectLlmApiKeys('project-1');

		expect(process.env.OPENROUTER_API_KEY).toBeUndefined();
	});

	it('restores original undefined when DB returns null', async () => {
		mockGetOrgCredential.mockResolvedValue(null);

		const restore = await injectLlmApiKeys('project-1');
		restore();

		expect(process.env.OPENROUTER_API_KEY).toBeUndefined();
	});

	it('calls getOrgCredential with the given projectId and key name', async () => {
		mockGetOrgCredential.mockResolvedValue(null);

		await injectLlmApiKeys('my-project');

		expect(mockGetOrgCredential).toHaveBeenCalledWith('my-project', 'OPENROUTER_API_KEY');
	});
});
