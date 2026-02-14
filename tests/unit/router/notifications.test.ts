import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock config before importing notifications
vi.mock('../../../src/router/config.js', () => ({
	routerConfig: {
		secrets: {
			trelloApiKey: 'test-trello-key',
			trelloToken: 'test-trello-token',
			githubToken: 'test-github-token',
		},
	},
}));

import { routerConfig } from '../../../src/router/config.js';
import {
	extractPRNumber,
	formatDuration,
	notifyTimeout,
} from '../../../src/router/notifications.js';
import type { CascadeJob, GitHubJob, TrelloJob } from '../../../src/router/queue.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('formatDuration', () => {
	it('formats minutes and seconds', () => {
		expect(formatDuration(90_000)).toBe('1m 30s');
	});

	it('formats exact minutes', () => {
		expect(formatDuration(1_800_000)).toBe('30m 0s');
	});

	it('formats hours, minutes, and seconds', () => {
		expect(formatDuration(3_661_000)).toBe('1h 1m 1s');
	});

	it('formats zero', () => {
		expect(formatDuration(0)).toBe('0m 0s');
	});

	it('formats sub-minute durations', () => {
		expect(formatDuration(45_000)).toBe('0m 45s');
	});
});

describe('extractPRNumber', () => {
	function makeGitHubJob(eventType: string, payload: unknown): GitHubJob {
		return {
			type: 'github',
			source: 'github',
			eventType,
			payload,
			repoFullName: 'owner/repo',
			receivedAt: new Date().toISOString(),
		};
	}

	it('extracts from pull_request event', () => {
		const job = makeGitHubJob('pull_request', { pull_request: { number: 42 } });
		expect(extractPRNumber(job)).toBe(42);
	});

	it('extracts from pull_request_review event', () => {
		const job = makeGitHubJob('pull_request_review', { pull_request: { number: 99 } });
		expect(extractPRNumber(job)).toBe(99);
	});

	it('extracts from pull_request_review_comment event', () => {
		const job = makeGitHubJob('pull_request_review_comment', { pull_request: { number: 7 } });
		expect(extractPRNumber(job)).toBe(7);
	});

	it('extracts from issue_comment event', () => {
		const job = makeGitHubJob('issue_comment', { issue: { number: 123 } });
		expect(extractPRNumber(job)).toBe(123);
	});

	it('extracts from check_suite event', () => {
		const job = makeGitHubJob('check_suite', {
			check_suite: { pull_requests: [{ number: 55 }] },
		});
		expect(extractPRNumber(job)).toBe(55);
	});

	it('returns null for check_suite with empty pull_requests', () => {
		const job = makeGitHubJob('check_suite', {
			check_suite: { pull_requests: [] },
		});
		expect(extractPRNumber(job)).toBeNull();
	});

	it('returns null for unrecognized event type', () => {
		const job = makeGitHubJob('push', { ref: 'refs/heads/main' });
		expect(extractPRNumber(job)).toBeNull();
	});

	it('returns null when payload is missing expected fields', () => {
		const job = makeGitHubJob('pull_request', {});
		expect(extractPRNumber(job)).toBeNull();
	});
});

describe('notifyTimeout', () => {
	const defaultInfo = {
		jobId: 'trello-1707900000000-abc123',
		startedAt: new Date('2026-02-14T10:00:00.000Z'),
		durationMs: 1_800_000,
	};

	beforeEach(() => {
		mockFetch.mockReset();
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('Trello jobs', () => {
		const trelloJob: TrelloJob = {
			type: 'trello',
			source: 'trello',
			payload: {},
			projectId: 'test',
			cardId: 'card123',
			actionType: 'updateCard',
			receivedAt: '2026-02-14T10:00:00.000Z',
		};

		it('posts a comment to the Trello card', async () => {
			mockFetch.mockResolvedValueOnce({ ok: true });

			await notifyTimeout(trelloJob, defaultInfo);

			expect(mockFetch).toHaveBeenCalledOnce();
			const [url, options] = mockFetch.mock.calls[0];
			expect(url).toContain('https://api.trello.com/1/cards/card123/actions/comments');
			expect(url).toContain('key=test-trello-key');
			expect(url).toContain('token=test-trello-token');
			expect(options.method).toBe('POST');
			const body = JSON.parse(options.body);
			expect(body.text).toContain('Agent Timeout');
			expect(body.text).toContain('30m 0s');
			expect(body.text).toContain('trello-1707900000000-abc123');
		});

		it('skips notification when Trello credentials are missing', async () => {
			const secrets = routerConfig.secrets as Record<string, string>;
			const origKey = secrets.trelloApiKey;
			secrets.trelloApiKey = '';

			await notifyTimeout(trelloJob, defaultInfo);

			expect(mockFetch).not.toHaveBeenCalled();
			expect(console.warn).toHaveBeenCalledWith(
				expect.stringContaining('Missing Trello credentials'),
			);

			secrets.trelloApiKey = origKey;
		});

		it('logs warning on Trello API error', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 401,
				text: async () => 'Unauthorized',
			});

			await notifyTimeout(trelloJob, defaultInfo);

			expect(console.warn).toHaveBeenCalledWith(
				expect.stringContaining('Trello comment failed'),
				401,
				'Unauthorized',
			);
		});
	});

	describe('GitHub jobs', () => {
		const githubJob: GitHubJob = {
			type: 'github',
			source: 'github',
			payload: { pull_request: { number: 42 } },
			eventType: 'pull_request_review',
			repoFullName: 'owner/repo',
			receivedAt: '2026-02-14T10:00:00.000Z',
		};

		it('posts a comment to the GitHub PR', async () => {
			mockFetch.mockResolvedValueOnce({ ok: true });

			await notifyTimeout(githubJob, defaultInfo);

			expect(mockFetch).toHaveBeenCalledOnce();
			const [url, options] = mockFetch.mock.calls[0];
			expect(url).toBe('https://api.github.com/repos/owner/repo/issues/42/comments');
			expect(options.method).toBe('POST');
			expect(options.headers.Authorization).toBe('Bearer test-github-token');
			const body = JSON.parse(options.body);
			expect(body.body).toContain('Agent Timeout');
			expect(body.body).toContain('30m 0s');
		});

		it('skips notification when GitHub token is missing', async () => {
			const secrets = routerConfig.secrets as Record<string, string>;
			const origToken = secrets.githubToken;
			secrets.githubToken = '';

			await notifyTimeout(githubJob, defaultInfo);

			expect(mockFetch).not.toHaveBeenCalled();
			expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Missing GitHub token'));

			secrets.githubToken = origToken;
		});

		it('skips notification when PR number cannot be extracted', async () => {
			const job: GitHubJob = {
				...githubJob,
				eventType: 'push',
				payload: { ref: 'refs/heads/main' },
			};

			await notifyTimeout(job, defaultInfo);

			expect(mockFetch).not.toHaveBeenCalled();
			expect(console.warn).toHaveBeenCalledWith(
				expect.stringContaining('Could not extract PR number'),
			);
		});

		it('logs warning on GitHub API error', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 403,
				text: async () => 'Forbidden',
			});

			await notifyTimeout(githubJob, defaultInfo);

			expect(console.warn).toHaveBeenCalledWith(
				expect.stringContaining('GitHub comment failed'),
				403,
				'Forbidden',
			);
		});
	});

	describe('error handling', () => {
		it('catches and logs errors without throwing', async () => {
			mockFetch.mockRejectedValueOnce(new Error('Network failure'));

			const trelloJob: TrelloJob = {
				type: 'trello',
				source: 'trello',
				payload: {},
				projectId: 'test',
				cardId: 'card123',
				actionType: 'updateCard',
				receivedAt: '2026-02-14T10:00:00.000Z',
			};

			// Should not throw
			await expect(notifyTimeout(trelloJob, defaultInfo)).resolves.toBeUndefined();

			expect(console.error).toHaveBeenCalledWith(
				expect.stringContaining('Failed to send timeout notification'),
				expect.stringContaining('Network failure'),
			);
		});

		it('handles unknown job type gracefully', async () => {
			const unknownJob = { type: 'unknown' } as unknown as CascadeJob;

			await expect(notifyTimeout(unknownJob, defaultInfo)).resolves.toBeUndefined();

			expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Unknown job type'));
		});
	});
});
