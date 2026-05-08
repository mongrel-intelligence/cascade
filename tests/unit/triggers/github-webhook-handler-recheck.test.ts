import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Static mocks (hoisted before imports) ─────────────────────────────────────

vi.mock('../../../src/sentry.js', () => ({
	captureException: vi.fn(),
	flush: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/triggers/github/integration.js', () => {
	const mockIntegration = {
		type: 'github',
		parseWebhookPayload: vi.fn().mockReturnValue({
			eventType: 'pull_request',
			projectIdentifier: 'owner/repo',
			workItemId: undefined,
			raw: {},
		}),
		lookupProject: vi.fn().mockResolvedValue({
			project: {
				id: 'project-1',
				name: 'Test',
				repo: 'owner/repo',
				baseBranch: 'main',
				watchdogTimeoutMs: 120000,
			},
			config: { projects: [] },
		}),
		withCredentials: vi.fn().mockImplementation((_projectId: unknown, fn: () => unknown) => fn()),
		resolveExecutionConfig: vi.fn().mockReturnValue({
			skipPrepareForAgent: true,
			skipHandleFailure: true,
			handleSuccessOnlyForAgentType: 'implementation',
			logLabel: 'GitHub agent',
		}),
	};
	return { GitHubWebhookIntegration: vi.fn().mockImplementation(() => mockIntegration) };
});

vi.mock('../../../src/github/personas.js', () => ({
	getPersonaToken: vi.fn().mockResolvedValue('gh-token-xxx'),
	resolvePersonaIdentities: vi
		.fn()
		.mockResolvedValue({ implementer: 'bot', reviewer: 'reviewer-bot' }),
}));

vi.mock('../../../src/github/client.js', () => ({
	githubClient: { deletePRComment: vi.fn().mockResolvedValue(undefined) },
	withGitHubToken: vi.fn().mockImplementation((_token: unknown, fn: () => unknown) => fn()),
}));

vi.mock('../../../src/utils/repo.js', () => ({
	parseRepoFullName: vi.fn().mockReturnValue({ owner: 'owner', repo: 'repo' }),
	getWorkspaceDir: vi.fn().mockReturnValue('/tmp/workspace'),
}));

vi.mock('../../../src/agents/definitions/loader.js', () => ({
	isPMFocusedAgent: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../../src/router/ackMessageGenerator.js', () => ({
	extractGitHubContext: vi.fn().mockReturnValue('PR context'),
	generateAckMessage: vi.fn().mockResolvedValue('Starting...'),
}));

vi.mock('../../../src/utils/safeOperation.js', () => ({
	safeOperation: vi.fn().mockImplementation((fn: () => unknown) => fn()),
}));

vi.mock('../../../src/triggers/shared/concurrency.js', () => ({
	withAgentTypeConcurrency: vi
		.fn()
		.mockImplementation((_id: unknown, _type: unknown, fn: () => unknown) => fn()),
}));

vi.mock('../../../src/triggers/shared/credential-scope.js', () => ({
	withPMScope: vi.fn().mockImplementation((_project: unknown, fn: () => unknown) => fn()),
}));

vi.mock('../../../src/triggers/shared/pm-ack.js', () => ({
	postPMAckComment: vi.fn().mockResolvedValue('pm-comment-id'),
}));

vi.mock('../../../src/triggers/shared/webhook-execution.js', () => ({
	runAgentWithCredentials: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/triggers/github/ack-comments.js', () => ({
	postAcknowledgmentComment: vi.fn().mockResolvedValue(undefined),
	updateInitialCommentWithError: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/utils/index.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
	startWatchdog: vi.fn(),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { captureException } from '../../../src/sentry.js';
import { processGitHubWebhook } from '../../../src/triggers/github/webhook-handler.js';
import type { TriggerResult } from '../../../src/types/index.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const deferredRecheckResult: TriggerResult = {
	agentType: null,
	agentInput: {},
	deferredRecheck: { delayMs: 45_000, coalesceKey: 'project-1:pr-conflict-recheck:42' },
};

const normalResult: TriggerResult = {
	agentType: 'resolve-conflicts',
	agentInput: { prNumber: 42 },
};

function makeRegistry(result: TriggerResult | null) {
	return { dispatch: vi.fn().mockResolvedValue(result) } as never;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('processGitHubWebhook — re-check exhaustion detection', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('emits Sentry capture when isRecheckJob=true and trigger returns deferredRecheck', async () => {
		const registry = makeRegistry(deferredRecheckResult);
		await processGitHubWebhook({}, 'pull_request', registry, undefined, undefined, undefined, true);
		expect(captureException).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining('mergeability_recheck_exhausted'),
			}),
			expect.objectContaining({ tags: { source: 'mergeability_recheck_exhausted' } }),
		);
	});

	it('does NOT capture Sentry when isRecheckJob=false and trigger returns deferredRecheck', async () => {
		const registry = makeRegistry(deferredRecheckResult);
		await processGitHubWebhook(
			{},
			'pull_request',
			registry,
			undefined,
			undefined,
			undefined,
			false,
		);
		expect(captureException).not.toHaveBeenCalled();
	});

	it('does NOT capture Sentry when isRecheckJob=true but trigger returns non-deferredRecheck result', async () => {
		const registry = makeRegistry(normalResult);
		await processGitHubWebhook({}, 'pull_request', registry, undefined, undefined, undefined, true);
		expect(captureException).not.toHaveBeenCalled();
	});

	it('does NOT capture Sentry when triggerResult is pre-resolved (no re-dispatch)', async () => {
		const registry = makeRegistry(null);
		await processGitHubWebhook(
			{},
			'pull_request',
			registry,
			undefined,
			undefined,
			normalResult,
			true,
		);
		expect(captureException).not.toHaveBeenCalled();
		expect(registry.dispatch).not.toHaveBeenCalled();
	});
});
