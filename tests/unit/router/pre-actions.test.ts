import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock config provider for DB secret resolution
vi.mock('../../../src/config/provider.js', () => ({
	getIntegrationCredential: vi.fn(),
	findProjectByRepo: vi.fn(),
}));

// Mock config cache (imported transitively)
vi.mock('../../../src/config/configCache.js', () => ({
	configCache: {
		getConfig: vi.fn().mockReturnValue(null),
		getProjectByBoardId: vi.fn().mockReturnValue(null),
		getProjectByRepo: vi.fn().mockReturnValue(null),
		setConfig: vi.fn(),
		setProjectByBoardId: vi.fn(),
		setProjectByRepo: vi.fn(),
		invalidate: vi.fn(),
	},
}));

// Mock logger
vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

import { findProjectByRepo, getIntegrationCredential } from '../../../src/config/provider.js';
import {
	_clearReviewerUsernameCache,
	addEyesReactionToPR,
} from '../../../src/router/pre-actions.js';
import type { GitHubJob } from '../../../src/router/queue.js';
import { logger } from '../../../src/utils/logging.js';

const mockGetIntegrationCredential = vi.mocked(getIntegrationCredential);
const mockFindProjectByRepo = vi.mocked(findProjectByRepo);
const mockLogger = vi.mocked(logger);

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeCheckSuiteJob(overrides?: Partial<Record<string, unknown>>): GitHubJob {
	return {
		type: 'github',
		source: 'github',
		eventType: 'check_suite',
		repoFullName: 'owner/repo',
		receivedAt: new Date().toISOString(),
		payload: {
			action: 'completed',
			check_suite: {
				conclusion: 'success',
				pull_requests: [{ number: 42 }],
			},
			repository: { full_name: 'owner/repo' },
			...overrides,
		},
	};
}

describe('addEyesReactionToPR', () => {
	const mockProject = {
		id: 'test-project',
		name: 'Test',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		trello: { boardId: 'b1', lists: {}, labels: {} },
	};

	beforeEach(() => {
		// Reset username cache between tests
		_clearReviewerUsernameCache();
		mockFetch.mockReset();
		mockLogger.info.mockReset();
		mockLogger.warn.mockReset();
		mockLogger.error.mockReset();

		mockFindProjectByRepo.mockResolvedValue(mockProject);
		mockGetIntegrationCredential.mockResolvedValue('test-reviewer-token');

		// Default fetch responses:
		// 1. GET /user -> reviewer username
		// 2. GET .../reviews -> empty array (no prior reviews)
		// 3. POST .../reactions -> success
		mockFetch
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ login: 'reviewer-bot' }),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => [],
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ id: 1, content: 'eyes' }),
			});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('adds eyes reaction when reviewer has no prior reviews (happy path)', async () => {
		const job = makeCheckSuiteJob();
		await addEyesReactionToPR(job);

		// Should have made 3 fetch calls: /user, /reviews, /reactions
		expect(mockFetch).toHaveBeenCalledTimes(3);

		// Verify /user call
		const [userUrl, userOptions] = mockFetch.mock.calls[0];
		expect(userUrl).toBe('https://api.github.com/user');
		expect(userOptions.headers.Authorization).toBe('Bearer test-reviewer-token');

		// Verify /reviews call
		const [reviewsUrl] = mockFetch.mock.calls[1];
		expect(reviewsUrl).toBe('https://api.github.com/repos/owner/repo/pulls/42/reviews');

		// Verify /reactions call (POST)
		const [reactUrl, reactOptions] = mockFetch.mock.calls[2];
		expect(reactUrl).toBe('https://api.github.com/repos/owner/repo/issues/42/reactions');
		expect(reactOptions.method).toBe('POST');
		const body = JSON.parse(reactOptions.body);
		expect(body.content).toBe('eyes');

		expect(mockLogger.info).toHaveBeenCalledWith(
			expect.stringContaining('Added eyes reaction to PR:'),
			42,
		);
	});

	it('skips reaction when reviewer has prior APPROVED review', async () => {
		mockFetch
			.mockReset()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ login: 'reviewer-bot' }),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => [
					{
						id: 1,
						user: { login: 'reviewer-bot' },
						state: 'APPROVED',
					},
				],
			});

		const job = makeCheckSuiteJob();
		await addEyesReactionToPR(job);

		// Only 2 calls: /user and /reviews — no /reactions
		expect(mockFetch).toHaveBeenCalledTimes(2);
		expect(mockLogger.info).toHaveBeenCalledWith(
			expect.stringContaining('Reviewer has prior reviews on PR, skipping eyes reaction'),
			42,
		);
	});

	it('skips reaction when reviewer has prior CHANGES_REQUESTED review', async () => {
		mockFetch
			.mockReset()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ login: 'reviewer-bot' }),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => [
					{
						id: 1,
						user: { login: 'reviewer-bot' },
						state: 'CHANGES_REQUESTED',
					},
				],
			});

		const job = makeCheckSuiteJob();
		await addEyesReactionToPR(job);

		expect(mockFetch).toHaveBeenCalledTimes(2);
		expect(mockLogger.info).toHaveBeenCalledWith(
			expect.stringContaining('Reviewer has prior reviews on PR, skipping eyes reaction'),
			42,
		);
	});

	it('does NOT skip reaction for COMMENTED reviews (not a real review)', async () => {
		mockFetch
			.mockReset()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ login: 'reviewer-bot' }),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => [
					{
						id: 1,
						user: { login: 'reviewer-bot' },
						state: 'COMMENTED',
					},
				],
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ id: 1, content: 'eyes' }),
			});

		const job = makeCheckSuiteJob();
		await addEyesReactionToPR(job);

		// Should still add reaction since COMMENTED doesn't count
		expect(mockFetch).toHaveBeenCalledTimes(3);
		const [reactUrl, reactOptions] = mockFetch.mock.calls[2];
		expect(reactUrl).toContain('/reactions');
		expect(JSON.parse(reactOptions.body).content).toBe('eyes');
	});

	it('skips when payload has no PRs', async () => {
		const job: GitHubJob = {
			...makeCheckSuiteJob(),
			payload: {
				action: 'completed',
				check_suite: {
					conclusion: 'success',
					pull_requests: [],
				},
				repository: { full_name: 'owner/repo' },
			},
		};

		await addEyesReactionToPR(job);
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('skips when project not found for repo', async () => {
		mockFindProjectByRepo.mockResolvedValue(undefined);

		const job = makeCheckSuiteJob();
		await addEyesReactionToPR(job);

		// No fetch calls since project not found
		expect(mockFetch).not.toHaveBeenCalled();
		expect(mockLogger.warn).toHaveBeenCalledWith(
			expect.stringContaining('No project found for repo, skipping eyes reaction'),
			expect.objectContaining({ repoFullName: 'owner/repo' }),
		);
	});

	it('skips when reviewer token is missing', async () => {
		mockGetIntegrationCredential.mockRejectedValue(new Error('Credential not found'));

		const job = makeCheckSuiteJob();
		await addEyesReactionToPR(job);

		expect(mockFetch).not.toHaveBeenCalled();
		expect(mockLogger.warn).toHaveBeenCalledWith(
			expect.stringContaining('Missing GITHUB_TOKEN_REVIEWER, skipping eyes reaction'),
		);
	});

	it('handles /user API error gracefully', async () => {
		mockFetch.mockReset().mockResolvedValueOnce({
			ok: false,
			status: 401,
		});

		const job = makeCheckSuiteJob();
		await addEyesReactionToPR(job);

		expect(mockFetch).toHaveBeenCalledTimes(1);
		expect(mockLogger.warn).toHaveBeenCalledWith(
			expect.stringContaining('Failed to resolve reviewer username:'),
			401,
		);
	});

	it('handles /reviews API error gracefully', async () => {
		mockFetch
			.mockReset()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ login: 'reviewer-bot' }),
			})
			.mockResolvedValueOnce({
				ok: false,
				status: 403,
				text: async () => 'Forbidden',
			});

		const job = makeCheckSuiteJob();
		await addEyesReactionToPR(job);

		expect(mockFetch).toHaveBeenCalledTimes(2);
		expect(mockLogger.warn).toHaveBeenCalledWith(
			expect.stringContaining('Failed to fetch PR reviews:'),
			403,
			'Forbidden',
		);
	});

	it('handles /reactions API error gracefully', async () => {
		mockFetch
			.mockReset()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ login: 'reviewer-bot' }),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => [],
			})
			.mockResolvedValueOnce({
				ok: false,
				status: 422,
				text: async () => 'Validation Failed',
			});

		const job = makeCheckSuiteJob();
		await addEyesReactionToPR(job);

		expect(mockFetch).toHaveBeenCalledTimes(3);
		expect(mockLogger.warn).toHaveBeenCalledWith(
			expect.stringContaining('Failed to add eyes reaction:'),
			422,
			'Validation Failed',
		);
	});

	it('caches reviewer username across multiple calls', async () => {
		// First call uses cached /user response from beforeEach setup (3 calls: user, reviews, reactions)
		const job = makeCheckSuiteJob();
		await addEyesReactionToPR(job);
		expect(mockFetch).toHaveBeenCalledTimes(3);

		// Second call: username should be cached, so only 2 calls: reviews, reactions
		mockFetch
			.mockResolvedValueOnce({
				ok: true,
				json: async () => [],
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ id: 2, content: 'eyes' }),
			});

		const job2 = makeCheckSuiteJob();
		await addEyesReactionToPR(job2);

		// Total: 3 (first call) + 2 (second call, no /user) = 5
		expect(mockFetch).toHaveBeenCalledTimes(5);

		// The 4th call should be /reviews, NOT /user
		const [fourthUrl] = mockFetch.mock.calls[3];
		expect(fourthUrl).toContain('/reviews');
	});
});
