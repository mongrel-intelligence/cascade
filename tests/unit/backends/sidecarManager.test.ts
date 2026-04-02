import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/gadgets/sessionState.js', () => ({
	REVIEW_SIDECAR_ENV_VAR: 'CASCADE_REVIEW_SIDECAR_PATH',
	PR_SIDECAR_ENV_VAR: 'CASCADE_PR_SIDECAR_PATH',
	PUSHED_CHANGES_SIDECAR_ENV_VAR: 'CASCADE_PUSHED_CHANGES_SIDECAR_PATH',
	PM_WRITE_SIDECAR_ENV_VAR: 'CASCADE_PM_WRITE_SIDECAR_PATH',
	clearInitialComment: vi.fn(),
	recordPRCreation: vi.fn(),
	recordReviewSubmission: vi.fn(),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import type { AgentProfile } from '../../../src/agents/definitions/profiles.js';
import {
	cleanupTempFile,
	createCompletionArtifacts,
	hydrateNativeToolSidecars,
	hydratePrSidecar,
	hydrateReviewSidecar,
} from '../../../src/backends/sidecarManager.js';
import {
	clearInitialComment,
	recordPRCreation,
	recordReviewSubmission,
} from '../../../src/gadgets/sessionState.js';
import type { AgentInput } from '../../../src/types/index.js';

const mockRecordPRCreation = vi.mocked(recordPRCreation);
const mockRecordReviewSubmission = vi.mocked(recordReviewSubmission);
const mockClearInitialComment = vi.mocked(clearInitialComment);

function makeProfile(overrides?: Partial<AgentProfile>): AgentProfile {
	return {
		filterTools: (tools) => tools,
		allCapabilities: ['fs:read'],
		needsGitHubToken: false,
		finishHooks: {},
		fetchContext: vi.fn().mockResolvedValue([]),
		buildTaskPrompt: () => 'Process the work item',
		capabilities: { required: ['fs:read'], optional: [] },
		...overrides,
	};
}

function makeSidecarPath(name: string): string {
	return join(tmpdir(), `test-${name}-${process.pid}-${Date.now()}.json`);
}

describe('createCompletionArtifacts', () => {
	it('creates a review sidecar path for review agent type', () => {
		const profile = makeProfile();
		const projectSecrets: Record<string, string> = {};

		const result = createCompletionArtifacts(
			profile,
			'review',
			false,
			{} as AgentInput,
			projectSecrets,
		);

		expect(result.reviewSidecarPath).toMatch(/cascade-review-sidecar-\d+-\d+\.json$/);
		expect(projectSecrets.CASCADE_REVIEW_SIDECAR_PATH).toBe(result.reviewSidecarPath);
	});

	it('does not create review sidecar for non-review agents', () => {
		const profile = makeProfile();
		const projectSecrets: Record<string, string> = {};

		const result = createCompletionArtifacts(
			profile,
			'implementation',
			false,
			{} as AgentInput,
			projectSecrets,
		);

		expect(result.reviewSidecarPath).toBeUndefined();
		expect(projectSecrets.CASCADE_REVIEW_SIDECAR_PATH).toBeUndefined();
	});

	it('creates a PR sidecar path when requiresPR and needsNativeToolRuntime', () => {
		const profile = makeProfile({ finishHooks: { requiresPR: true } });
		const projectSecrets: Record<string, string> = {};

		const result = createCompletionArtifacts(
			profile,
			'implementation',
			true,
			{} as AgentInput,
			projectSecrets,
		);

		expect(result.prSidecarPath).toMatch(/cascade-pr-sidecar-\d+-\d+\.json$/);
		expect(projectSecrets.CASCADE_PR_SIDECAR_PATH).toBe(result.prSidecarPath);
	});

	it('does not create PR sidecar when needsNativeToolRuntime is false', () => {
		const profile = makeProfile({ finishHooks: { requiresPR: true } });
		const projectSecrets: Record<string, string> = {};

		const result = createCompletionArtifacts(
			profile,
			'implementation',
			false,
			{} as AgentInput,
			projectSecrets,
		);

		expect(result.prSidecarPath).toBeUndefined();
		expect(projectSecrets.CASCADE_PR_SIDECAR_PATH).toBeUndefined();
	});

	it('creates a pushed-changes sidecar when requiresPushedChanges and needsNativeToolRuntime', () => {
		const profile = makeProfile({ finishHooks: { requiresPushedChanges: true } });
		const projectSecrets: Record<string, string> = {};

		const result = createCompletionArtifacts(
			profile,
			'respond-to-review',
			true,
			{} as AgentInput,
			projectSecrets,
		);

		expect(result.pushedChangesSidecarPath).toMatch(
			/cascade-pushed-changes-sidecar-\d+-\d+\.json$/,
		);
		expect(projectSecrets.CASCADE_PUSHED_CHANGES_SIDECAR_PATH).toBe(
			result.pushedChangesSidecarPath,
		);
	});

	it('creates a PM write sidecar when requiresPMWrite and needsNativeToolRuntime', () => {
		const profile = makeProfile({ finishHooks: { requiresPMWrite: true } });
		const projectSecrets: Record<string, string> = {};

		const result = createCompletionArtifacts(
			profile,
			'splitting',
			true,
			{} as AgentInput,
			projectSecrets,
		);

		expect(result.pmWriteSidecarPath).toMatch(/cascade-pm-write-sidecar-\d+-\d+\.json$/);
		expect(projectSecrets.CASCADE_PM_WRITE_SIDECAR_PATH).toBe(result.pmWriteSidecarPath);
	});

	it('injects CASCADE_FINISH_HOOKS when finishHooks has entries', () => {
		const finishHooks = { requiresPR: true, requiresReview: true };
		const profile = makeProfile({ finishHooks });
		const projectSecrets: Record<string, string> = {};

		createCompletionArtifacts(profile, 'implementation', true, {} as AgentInput, projectSecrets);

		expect(projectSecrets.CASCADE_FINISH_HOOKS).toBe(JSON.stringify(finishHooks));
	});

	it('does not inject CASCADE_FINISH_HOOKS when finishHooks is empty', () => {
		const profile = makeProfile({ finishHooks: {} });
		const projectSecrets: Record<string, string> = {};

		createCompletionArtifacts(profile, 'implementation', true, {} as AgentInput, projectSecrets);

		expect(projectSecrets.CASCADE_FINISH_HOOKS).toBeUndefined();
	});

	it('injects CASCADE_INITIAL_HEAD_SHA when input.headSha is set', () => {
		const profile = makeProfile();
		const projectSecrets: Record<string, string> = {};
		const input = { headSha: 'abc123' } as AgentInput;

		createCompletionArtifacts(profile, 'review', false, input, projectSecrets);

		expect(projectSecrets.CASCADE_INITIAL_HEAD_SHA).toBe('abc123');
	});

	it('does not inject CASCADE_INITIAL_HEAD_SHA when headSha is absent', () => {
		const profile = makeProfile();
		const projectSecrets: Record<string, string> = {};

		createCompletionArtifacts(profile, 'review', false, {} as AgentInput, projectSecrets);

		expect(projectSecrets.CASCADE_INITIAL_HEAD_SHA).toBeUndefined();
	});
});

describe('hydrateReviewSidecar', () => {
	it('calls recordReviewSubmission when sidecar has reviewUrl and reviewBody', async () => {
		const sidecarPath = makeSidecarPath('review');
		writeFileSync(
			sidecarPath,
			JSON.stringify({
				reviewUrl: 'https://github.com/o/r/pull/1#pullrequestreview-99',
				event: 'REQUEST_CHANGES',
				body: 'Please fix the null check',
			}),
		);

		await hydrateReviewSidecar(sidecarPath);

		expect(mockRecordReviewSubmission).toHaveBeenCalledWith(
			'https://github.com/o/r/pull/1#pullrequestreview-99',
			'Please fix the null check',
			'REQUEST_CHANGES',
		);
	});

	it('calls clearInitialComment when sidecar has ackCommentDeleted: true', async () => {
		const sidecarPath = makeSidecarPath('review-ack');
		writeFileSync(
			sidecarPath,
			JSON.stringify({
				reviewUrl: 'https://github.com/o/r/pull/1#pullrequestreview-42',
				event: 'APPROVE',
				body: 'LGTM',
				ackCommentDeleted: true,
			}),
		);

		await hydrateReviewSidecar(sidecarPath);

		expect(mockClearInitialComment).toHaveBeenCalled();
	});

	it('does not call clearInitialComment when ackCommentDeleted is absent', async () => {
		const sidecarPath = makeSidecarPath('review-no-ack');
		writeFileSync(
			sidecarPath,
			JSON.stringify({
				reviewUrl: 'https://github.com/o/r/pull/1#pullrequestreview-42',
				event: 'APPROVE',
				body: 'LGTM',
			}),
		);

		await hydrateReviewSidecar(sidecarPath);

		expect(mockClearInitialComment).not.toHaveBeenCalled();
	});

	it('does not throw when sidecar file does not exist', async () => {
		await expect(hydrateReviewSidecar('/nonexistent/path.json')).resolves.not.toThrow();
	});

	it('does not call recordReviewSubmission when sidecar has no body', async () => {
		const sidecarPath = makeSidecarPath('review-missing-body');
		writeFileSync(
			sidecarPath,
			JSON.stringify({
				reviewUrl: 'https://github.com/o/r/pull/1#pullrequestreview-99',
				event: 'APPROVE',
			}),
		);

		await hydrateReviewSidecar(sidecarPath);

		expect(mockRecordReviewSubmission).not.toHaveBeenCalled();
	});
});

describe('hydratePrSidecar', () => {
	it('calls recordPRCreation and returns prUrl when sidecar has prUrl', async () => {
		const sidecarPath = makeSidecarPath('pr');
		writeFileSync(
			sidecarPath,
			JSON.stringify({
				source: 'cascade-tools scm create-pr',
				prUrl: 'https://github.com/o/r/pull/88',
				prNumber: 88,
			}),
		);

		const result = await hydratePrSidecar(sidecarPath);

		expect(mockRecordPRCreation).toHaveBeenCalledWith('https://github.com/o/r/pull/88');
		expect(result.prUrl).toBe('https://github.com/o/r/pull/88');
		expect(result.prEvidence?.source).toBe('native-tool-sidecar');
		expect(result.prEvidence?.authoritative).toBe(true);
	});

	it('returns empty object when sidecar file does not exist', async () => {
		const result = await hydratePrSidecar('/nonexistent/path.json');

		expect(result).toEqual({});
		expect(mockRecordPRCreation).not.toHaveBeenCalled();
	});

	it('returns empty object when sidecar has no prUrl', async () => {
		const sidecarPath = makeSidecarPath('pr-no-url');
		writeFileSync(sidecarPath, JSON.stringify({ prNumber: 5 }));

		const result = await hydratePrSidecar(sidecarPath);

		expect(result).toEqual({});
		expect(mockRecordPRCreation).not.toHaveBeenCalled();
	});
});

describe('hydrateNativeToolSidecars', () => {
	it('hydrates PR sidecar and updates result.prUrl', async () => {
		const sidecarPath = makeSidecarPath('nt-pr');
		writeFileSync(
			sidecarPath,
			JSON.stringify({
				prUrl: 'https://github.com/o/r/pull/77',
			}),
		);
		const result = { success: true, output: 'Done' } as ReturnType<typeof Object.assign>;

		await hydrateNativeToolSidecars(result, sidecarPath, undefined);

		expect(result.prUrl).toBe('https://github.com/o/r/pull/77');
	});

	it('hydrates review sidecar and calls recordReviewSubmission', async () => {
		const sidecarPath = makeSidecarPath('nt-review');
		writeFileSync(
			sidecarPath,
			JSON.stringify({
				reviewUrl: 'https://github.com/o/r/pull/1#pullrequestreview-55',
				event: 'APPROVE',
				body: 'Looks good!',
			}),
		);
		const result = { success: true, output: 'Done' };

		await hydrateNativeToolSidecars(result, undefined, sidecarPath);

		expect(mockRecordReviewSubmission).toHaveBeenCalledWith(
			'https://github.com/o/r/pull/1#pullrequestreview-55',
			'Looks good!',
			'APPROVE',
		);
	});

	it('does nothing when both sidecar paths are undefined', async () => {
		const result = { success: true, output: 'Done', prUrl: 'existing-url' };

		await hydrateNativeToolSidecars(result, undefined, undefined);

		expect(result.prUrl).toBe('existing-url');
		expect(mockRecordPRCreation).not.toHaveBeenCalled();
		expect(mockRecordReviewSubmission).not.toHaveBeenCalled();
	});
});

describe('cleanupTempFile', () => {
	it('deletes the file when it exists', () => {
		const filePath = makeSidecarPath('cleanup');
		writeFileSync(filePath, '{}');
		expect(existsSync(filePath)).toBe(true);

		cleanupTempFile(filePath);

		expect(existsSync(filePath)).toBe(false);
	});

	it('does nothing when path is undefined', () => {
		// Should not throw
		expect(() => cleanupTempFile(undefined)).not.toThrow();
	});

	it('does not throw when file does not exist', () => {
		expect(() => cleanupTempFile('/nonexistent/path.json')).not.toThrow();
	});
});
