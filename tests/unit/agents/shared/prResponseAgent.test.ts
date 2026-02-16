import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/github/client.js', () => ({
	githubClient: {
		getPR: vi.fn(),
		getPRReviewComments: vi.fn(),
		getPRReviews: vi.fn(),
		getPRIssueComments: vi.fn(),
		getPRDiff: vi.fn(),
		updatePRComment: vi.fn(),
		createPRComment: vi.fn(),
	},
}));

vi.mock('../../../../src/agents/shared/modelResolution.js', () => ({
	resolveModelConfig: vi.fn(),
}));

vi.mock('../../../../src/agents/shared/prFormatting.js', () => ({
	formatPRDetails: vi.fn((v) => `details:${v}`),
	formatPRComments: vi.fn((v) => `comments:${v}`),
	formatPRReviews: vi.fn((v) => `reviews:${v}`),
	formatPRIssueComments: vi.fn((v) => `issueComments:${v}`),
	formatPRDiff: vi.fn((v) => `diff:${v}`),
}));

vi.mock('../../../../src/agents/shared/syntheticCalls.js', () => ({
	injectDirectoryListing: vi.fn((_b, _tc) => 'builder-after-dir'),
	injectSyntheticCall: vi.fn((_b, _tc, name) => `builder-after-${name}`),
	injectContextFiles: vi.fn((_b, _tc, _cf) => 'builder-after-context-files'),
	injectSquintContext: vi.fn((_b, _tc, _rd) => 'builder-after-squint'),
}));

vi.mock('../../../../src/agents/shared/githubAgent.js', () => ({
	createInitialPRComment: vi.fn(),
}));

import { createInitialPRComment } from '../../../../src/agents/shared/githubAgent.js';
import { resolveModelConfig } from '../../../../src/agents/shared/modelResolution.js';
import {
	type InjectPRResponseSyntheticCallsParams,
	type PRResponseAgentInput,
	type PRResponseContextData,
	buildPRResponseContext,
	buildPRResponsePrompt,
	injectPRResponseSyntheticCalls,
	postInitialPRResponseComment,
} from '../../../../src/agents/shared/prResponseAgent.js';
import {
	injectContextFiles,
	injectDirectoryListing,
	injectSquintContext,
	injectSyntheticCall,
} from '../../../../src/agents/shared/syntheticCalls.js';
import { githubClient } from '../../../../src/github/client.js';

const mockGithub = vi.mocked(githubClient);
const mockResolveModelConfig = vi.mocked(resolveModelConfig);
const mockCreateInitialPRComment = vi.mocked(createInitialPRComment);
const mockInjectDirectoryListing = vi.mocked(injectDirectoryListing);
const mockInjectSyntheticCall = vi.mocked(injectSyntheticCall);
const mockInjectContextFiles = vi.mocked(injectContextFiles);
const mockInjectSquintContext = vi.mocked(injectSquintContext);

describe('prResponseAgent shared module', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ========================================================================
	// buildPRResponsePrompt
	// ========================================================================

	describe('buildPRResponsePrompt', () => {
		it('generates prompt with the correct template values', () => {
			const result = buildPRResponsePrompt(
				'feature/xyz',
				42,
				'myorg',
				'myrepo',
				'Address the review comments.',
				'GetPRComments, ReplyToReviewComment',
			);

			expect(result).toContain('`feature/xyz`');
			expect(result).toContain('PR #42');
			expect(result).toContain('Address the review comments.');
			expect(result).toContain('Owner: myorg');
			expect(result).toContain('Repo: myrepo');
			expect(result).toContain('PR Number: 42');
			expect(result).toContain('GetPRComments, ReplyToReviewComment');
		});

		it('uses the instruction line and gadget names provided', () => {
			const result = buildPRResponsePrompt(
				'fix/bug',
				7,
				'owner',
				'repo',
				'A user @mentioned you. Execute their request.',
				'PostPRComment, UpdatePRComment',
			);

			expect(result).toContain('A user @mentioned you. Execute their request.');
			expect(result).toContain('PostPRComment, UpdatePRComment');
		});
	});

	// ========================================================================
	// postInitialPRResponseComment
	// ========================================================================

	describe('postInitialPRResponseComment', () => {
		const id = { owner: 'org', repo: 'repo' };
		const baseInput = {
			prNumber: 10,
			prBranch: 'feat',
			repoFullName: 'org/repo',
			triggerCommentId: 1,
			triggerCommentBody: 'body',
			triggerCommentPath: 'path',
			triggerCommentUrl: 'url',
		} as PRResponseAgentInput;

		it('updates existing comment when acknowledgmentCommentId is set', async () => {
			const input = { ...baseInput, acknowledgmentCommentId: 555 };
			mockGithub.updatePRComment.mockResolvedValue({
				id: 555,
				htmlUrl: 'https://example.com/555',
			} as ReturnType<typeof mockGithub.updatePRComment> extends Promise<infer R> ? R : never);

			const result = await postInitialPRResponseComment(input, id, 'header');

			expect(mockGithub.updatePRComment).toHaveBeenCalledWith('org', 'repo', 555, 'header');
			expect(result).toEqual({
				id: 555,
				htmlUrl: 'https://example.com/555',
				gadgetName: 'UpdatePRComment',
			});
		});

		it('creates a new comment when no acknowledgmentCommentId', async () => {
			mockCreateInitialPRComment.mockResolvedValue({
				id: 999,
				htmlUrl: 'https://example.com/999',
				gadgetName: 'PostPRComment',
			});

			const result = await postInitialPRResponseComment(baseInput, id, 'header');

			expect(mockCreateInitialPRComment).toHaveBeenCalledWith(10, id, 'header');
			expect(result).toEqual({
				id: 999,
				htmlUrl: 'https://example.com/999',
				gadgetName: 'PostPRComment',
			});
		});
	});

	// ========================================================================
	// buildPRResponseContext
	// ========================================================================

	describe('buildPRResponseContext', () => {
		const mockLog = { info: vi.fn() };

		beforeEach(() => {
			mockResolveModelConfig.mockResolvedValue({
				systemPrompt: 'sys',
				model: 'gpt-4',
				maxIterations: 10,
				contextFiles: [{ path: 'CLAUDE.md', content: '# test' }],
			});

			mockGithub.getPR.mockResolvedValue('pr-raw' as never);
			mockGithub.getPRReviewComments.mockResolvedValue('comments-raw' as never);
			mockGithub.getPRReviews.mockResolvedValue('reviews-raw' as never);
			mockGithub.getPRIssueComments.mockResolvedValue('issue-comments-raw' as never);
			mockGithub.getPRDiff.mockResolvedValue('diff-raw' as never);
		});

		it('resolves model config with the correct agent type and configKey', async () => {
			const promptBuilder = vi.fn().mockReturnValue('prompt');

			await buildPRResponseContext(
				'org',
				'repo',
				42,
				'feat',
				'/tmp/repo',
				{ id: 'proj' } as never,
				{ defaults: {} } as never,
				mockLog,
				'respond-to-review',
				promptBuilder,
			);

			expect(mockResolveModelConfig).toHaveBeenCalledWith({
				agentType: 'respond-to-review',
				project: { id: 'proj' },
				config: { defaults: {} },
				repoDir: '/tmp/repo',
				modelOverride: undefined,
				configKey: 'review',
			});
		});

		it('fetches all 5 PR endpoints', async () => {
			const promptBuilder = vi.fn().mockReturnValue('prompt');

			await buildPRResponseContext(
				'org',
				'repo',
				42,
				'feat',
				'/tmp/repo',
				{ id: 'proj' } as never,
				{ defaults: {} } as never,
				mockLog,
				'respond-to-review',
				promptBuilder,
			);

			expect(mockGithub.getPR).toHaveBeenCalledWith('org', 'repo', 42);
			expect(mockGithub.getPRReviewComments).toHaveBeenCalledWith('org', 'repo', 42);
			expect(mockGithub.getPRReviews).toHaveBeenCalledWith('org', 'repo', 42);
			expect(mockGithub.getPRIssueComments).toHaveBeenCalledWith('org', 'repo', 42);
			expect(mockGithub.getPRDiff).toHaveBeenCalledWith('org', 'repo', 42);
		});

		it('returns combined context data with formatted values', async () => {
			const promptBuilder = vi.fn().mockReturnValue('my-prompt');

			const result = await buildPRResponseContext(
				'org',
				'repo',
				42,
				'feat',
				'/tmp/repo',
				{ id: 'proj' } as never,
				{ defaults: {} } as never,
				mockLog,
				'respond-to-review',
				promptBuilder,
			);

			expect(result).toEqual({
				systemPrompt: 'sys',
				model: 'gpt-4',
				maxIterations: 10,
				contextFiles: [{ path: 'CLAUDE.md', content: '# test' }],
				prDetailsFormatted: 'details:pr-raw',
				commentsFormatted: 'comments:comments-raw',
				reviewsFormatted: 'reviews:reviews-raw',
				issueCommentsFormatted: 'issueComments:issue-comments-raw',
				diffFormatted: 'diff:diff-raw',
				prompt: 'my-prompt',
			});
		});

		it('passes modelOverride through to resolveModelConfig', async () => {
			const promptBuilder = vi.fn().mockReturnValue('prompt');

			await buildPRResponseContext(
				'org',
				'repo',
				42,
				'feat',
				'/tmp/repo',
				{ id: 'proj' } as never,
				{ defaults: {} } as never,
				mockLog,
				'respond-to-pr-comment',
				promptBuilder,
				'custom-model',
			);

			expect(mockResolveModelConfig).toHaveBeenCalledWith(
				expect.objectContaining({
					modelOverride: 'custom-model',
					agentType: 'respond-to-pr-comment',
				}),
			);
		});
	});

	// ========================================================================
	// injectPRResponseSyntheticCalls
	// ========================================================================

	describe('injectPRResponseSyntheticCalls', () => {
		const baseParams: InjectPRResponseSyntheticCallsParams = {
			builder: 'initial-builder' as never,
			ctx: {
				prDetailsFormatted: 'pd',
				commentsFormatted: 'c',
				reviewsFormatted: 'r',
				issueCommentsFormatted: 'ic',
				diffFormatted: 'd',
				contextFiles: [],
				systemPrompt: 'sys',
				model: 'm',
				maxIterations: 5,
				prompt: 'p',
			},
			trackingContext: {} as never,
			repoDir: '/tmp/repo',
			id: { owner: 'org', repo: 'repo' },
			input: { prNumber: 42 } as PRResponseAgentInput,
		};

		it('injects calls in correct order: dir → PR details → comments → reviews → issue comments → diff → context files → squint', () => {
			injectPRResponseSyntheticCalls(baseParams);

			expect(mockInjectDirectoryListing).toHaveBeenCalledTimes(1);

			const syntheticNames = mockInjectSyntheticCall.mock.calls.map((c) => c[2]);
			expect(syntheticNames).toEqual([
				'GetPRDetails',
				'GetPRComments',
				'GetPRReviews',
				'GetPRIssueComments',
				'GetPRDiff',
			]);

			expect(mockInjectContextFiles).toHaveBeenCalledTimes(1);
			expect(mockInjectSquintContext).toHaveBeenCalledTimes(1);
		});

		it('uses default comment descriptions (respond-to-review style)', () => {
			injectPRResponseSyntheticCalls(baseParams);

			const commentsCall = mockInjectSyntheticCall.mock.calls.find((c) => c[2] === 'GetPRComments');
			expect(commentsCall?.[3]).toEqual(
				expect.objectContaining({
					comment: 'Pre-fetching line-specific review comments to address',
				}),
			);

			const reviewsCall = mockInjectSyntheticCall.mock.calls.find((c) => c[2] === 'GetPRReviews');
			expect(reviewsCall?.[3]).toEqual(
				expect.objectContaining({
					comment: 'Pre-fetching review submissions (approve/request changes with body text)',
				}),
			);

			const issueCommentsCall = mockInjectSyntheticCall.mock.calls.find(
				(c) => c[2] === 'GetPRIssueComments',
			);
			expect(issueCommentsCall?.[3]).toEqual(
				expect.objectContaining({
					comment: 'Pre-fetching general PR comments (issue-style conversation)',
				}),
			);
		});

		it('calls preSyntheticCalls callback before standard calls', () => {
			const preSyntheticCalls = vi.fn().mockReturnValue('builder-after-pre');

			injectPRResponseSyntheticCalls(baseParams, { preSyntheticCalls });

			expect(preSyntheticCalls).toHaveBeenCalledTimes(1);
			expect(preSyntheticCalls).toHaveBeenCalledWith(
				'builder-after-dir',
				baseParams.trackingContext,
				baseParams.input,
			);
		});

		it('overrides comment descriptions when provided', () => {
			injectPRResponseSyntheticCalls(baseParams, {
				commentDescriptions: {
					prComments: 'Pre-fetching line-specific review comments for context',
					prReviews: 'Pre-fetching review submissions for context',
					prIssueComments: 'Pre-fetching general PR comments for context',
				},
			});

			const commentsCall = mockInjectSyntheticCall.mock.calls.find((c) => c[2] === 'GetPRComments');
			expect(commentsCall?.[3]).toEqual(
				expect.objectContaining({
					comment: 'Pre-fetching line-specific review comments for context',
				}),
			);

			const reviewsCall = mockInjectSyntheticCall.mock.calls.find((c) => c[2] === 'GetPRReviews');
			expect(reviewsCall?.[3]).toEqual(
				expect.objectContaining({ comment: 'Pre-fetching review submissions for context' }),
			);

			const issueCommentsCall = mockInjectSyntheticCall.mock.calls.find(
				(c) => c[2] === 'GetPRIssueComments',
			);
			expect(issueCommentsCall?.[3]).toEqual(
				expect.objectContaining({ comment: 'Pre-fetching general PR comments for context' }),
			);
		});
	});
});
