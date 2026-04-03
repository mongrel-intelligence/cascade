import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockWithPMCredentials, mockWithPMProvider, mockCreatePMProvider, mockGetOrNull } =
	vi.hoisted(() => {
		return {
			mockWithPMCredentials: vi.fn().mockImplementation((_id, _type, _getter, fn) => fn()),
			mockWithPMProvider: vi.fn().mockImplementation((_provider, fn) => fn()),
			mockCreatePMProvider: vi.fn().mockReturnValue({ type: 'trello' }),
			mockGetOrNull: vi.fn().mockReturnValue(null),
		};
	});

vi.mock('../../../../src/pm/context.js', () => ({
	withPMCredentials: mockWithPMCredentials,
	withPMProvider: mockWithPMProvider,
}));

vi.mock('../../../../src/pm/index.js', () => ({
	createPMProvider: mockCreatePMProvider,
	pmRegistry: { getOrNull: mockGetOrNull },
}));

import { withPMScope } from '../../../../src/triggers/shared/credential-scope.js';
import type { ProjectConfig } from '../../../../src/types/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockProject = {
	id: 'project-1',
	name: 'Test',
	repo: 'owner/repo',
	baseBranch: 'main',
	pm: { type: 'trello' },
} as ProjectConfig;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('withPMScope', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockWithPMCredentials.mockImplementation(
			(_id: unknown, _type: unknown, _getter: unknown, fn: () => Promise<unknown>) => fn(),
		);
		mockWithPMProvider.mockImplementation((_provider: unknown, fn: () => Promise<unknown>) => fn());
		mockCreatePMProvider.mockReturnValue({ type: 'trello' });
	});

	it('calls fn and returns its result', async () => {
		const fn = vi.fn().mockResolvedValue('result');

		const result = await withPMScope(mockProject, fn);

		expect(result).toBe('result');
		expect(fn).toHaveBeenCalledOnce();
	});

	it('creates a PM provider using the project', async () => {
		const fn = vi.fn().mockResolvedValue(undefined);

		await withPMScope(mockProject, fn);

		expect(mockCreatePMProvider).toHaveBeenCalledWith(mockProject);
	});

	it('calls withPMCredentials with project id and pm type', async () => {
		const fn = vi.fn().mockResolvedValue(undefined);

		await withPMScope(mockProject, fn);

		expect(mockWithPMCredentials).toHaveBeenCalledWith(
			'project-1',
			'trello',
			expect.any(Function),
			expect.any(Function),
		);
	});

	it('calls withPMProvider with the created PM provider', async () => {
		const fn = vi.fn().mockResolvedValue(undefined);
		const mockProvider = { type: 'trello' };
		mockCreatePMProvider.mockReturnValue(mockProvider);

		await withPMScope(mockProject, fn);

		expect(mockWithPMProvider).toHaveBeenCalledWith(mockProvider, expect.any(Function));
	});

	it('works when project has no PM type', async () => {
		const projectWithoutPM = { ...mockProject, pm: undefined } as ProjectConfig;
		const fn = vi.fn().mockResolvedValue('value');

		const result = await withPMScope(projectWithoutPM, fn);

		expect(result).toBe('value');
		// withPMCredentials is still called (falls through to fn() when pmType is undefined)
		expect(mockWithPMCredentials).toHaveBeenCalledWith(
			'project-1',
			undefined,
			expect.any(Function),
			expect.any(Function),
		);
	});

	it('uses pmRegistry.getOrNull as the integration getter', async () => {
		const fn = vi.fn().mockResolvedValue(undefined);

		await withPMScope(mockProject, fn);

		// The getter function passed to withPMCredentials calls pmRegistry.getOrNull
		const getter = mockWithPMCredentials.mock.calls[0][2];
		getter('trello');
		expect(mockGetOrNull).toHaveBeenCalledWith('trello');
	});
});
