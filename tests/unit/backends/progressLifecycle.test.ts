import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/config/customModels.js', () => ({
	CUSTOM_MODELS: [],
}));

vi.mock('../../../src/utils/runLink.js', () => ({
	getDashboardUrl: vi.fn(),
}));

import type { LogWriter } from '../../../src/agents/shared/executionPipeline.js';
import {
	buildProgressMonitorConfig,
	isGitHubAckComment,
} from '../../../src/backends/progressLifecycle.js';
import type { AgentInput, CascadeConfig, ProjectConfig } from '../../../src/types/index.js';
import { getDashboardUrl } from '../../../src/utils/runLink.js';

const mockGetDashboardUrl = vi.mocked(getDashboardUrl);

function makeProject(overrides?: Partial<ProjectConfig>): ProjectConfig {
	return {
		id: 'test-project',
		name: 'Test',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		trello: { boardId: 'b1', lists: {}, labels: {} },
		...overrides,
	};
}

function makeConfig(): CascadeConfig {
	return { projects: [] };
}

function makeInput(
	overrides?: Partial<AgentInput>,
): AgentInput & { config: CascadeConfig; project: ProjectConfig } {
	return {
		workItemId: 'card123',
		project: makeProject(),
		config: makeConfig(),
		...overrides,
	} as AgentInput & { config: CascadeConfig; project: ProjectConfig };
}

const mockLogWriter = {} as LogWriter;

beforeEach(() => {
	mockGetDashboardUrl.mockReturnValue(undefined);
});

describe('isGitHubAckComment', () => {
	it('returns true when prNumber, repoFullName, and numeric ackCommentId are present', () => {
		const input = makeInput({ prNumber: 42, repoFullName: 'acme/widgets', ackCommentId: 12345 });
		expect(isGitHubAckComment(input)).toBe(true);
	});

	it('returns false when ackCommentId is a string (PM comment)', () => {
		const input = makeInput({
			prNumber: 42,
			repoFullName: 'acme/widgets',
			ackCommentId: 'trello-comment',
		});
		expect(isGitHubAckComment(input)).toBe(false);
	});

	it('returns false when prNumber is absent', () => {
		const input = makeInput({ repoFullName: 'acme/widgets', ackCommentId: 12345 });
		expect(isGitHubAckComment(input)).toBe(false);
	});

	it('returns false when repoFullName is absent', () => {
		const input = makeInput({ prNumber: 42, ackCommentId: 12345 });
		expect(isGitHubAckComment(input)).toBe(false);
	});

	it('returns false when ackCommentId is absent', () => {
		const input = makeInput({ prNumber: 42, repoFullName: 'acme/widgets' });
		expect(isGitHubAckComment(input)).toBe(false);
	});

	it('returns true when ackCommentId is zero (typeof 0 === "number")', () => {
		// Note: ackCommentId of 0 still passes typeof check, so returns true
		const input = makeInput({ prNumber: 42, repoFullName: 'acme/widgets', ackCommentId: 0 });
		expect(isGitHubAckComment(input)).toBe(true);
	});
});

describe('buildProgressMonitorConfig', () => {
	it('sets taskDescription from workItemId', () => {
		const input = makeInput({ workItemId: 'card-abc' });
		const config = buildProgressMonitorConfig(
			input,
			'implementation',
			mockLogWriter,
			'/repo',
			false,
			'test-engine',
			'model-x',
		);
		expect(config.taskDescription).toBe('Work item card-abc');
	});

	it('falls back to "Unknown task" when workItemId is absent', () => {
		const input = makeInput({ workItemId: undefined });
		const config = buildProgressMonitorConfig(
			input,
			'implementation',
			mockLogWriter,
			'/repo',
			false,
			'test-engine',
			'model-x',
		);
		expect(config.taskDescription).toBe('Unknown task');
	});

	it('sets trello config when workItemId is present', () => {
		const input = makeInput({ workItemId: 'card-abc' });
		const config = buildProgressMonitorConfig(
			input,
			'implementation',
			mockLogWriter,
			'/repo',
			false,
			'test-engine',
			'model-x',
		);
		expect(config.trello).toEqual({ workItemId: 'card-abc' });
	});

	it('sets trello to undefined when workItemId is absent', () => {
		const input = makeInput({ workItemId: undefined });
		const config = buildProgressMonitorConfig(
			input,
			'implementation',
			mockLogWriter,
			'/repo',
			false,
			'test-engine',
			'model-x',
		);
		expect(config.trello).toBeUndefined();
	});

	it('sets preSeededCommentId when isGitHubAck is false and ackCommentId is a string', () => {
		const input = makeInput({ ackCommentId: 'trello-comment-abc' });
		const config = buildProgressMonitorConfig(
			input,
			'implementation',
			mockLogWriter,
			'/repo',
			false,
			'test-engine',
			'model-x',
		);
		expect(config.preSeededCommentId).toBe('trello-comment-abc');
	});

	it('sets preSeededCommentId to undefined when isGitHubAck is true', () => {
		const input = makeInput({ ackCommentId: 12345 });
		const config = buildProgressMonitorConfig(
			input,
			'review',
			mockLogWriter,
			'/repo',
			true,
			'test-engine',
			'model-x',
		);
		expect(config.preSeededCommentId).toBeUndefined();
	});

	it('includes github config when prNumber and repoFullName are present', () => {
		const input = makeInput({ prNumber: 42, repoFullName: 'acme/widgets' });
		const config = buildProgressMonitorConfig(
			input,
			'review',
			mockLogWriter,
			'/repo',
			true,
			'test-engine',
			'model-x',
		);
		expect(config.github).toEqual({ owner: 'acme', repo: 'widgets' });
	});

	it('does not include github config when prNumber is absent', () => {
		const input = makeInput({ repoFullName: 'acme/widgets' });
		const config = buildProgressMonitorConfig(
			input,
			'implementation',
			mockLogWriter,
			'/repo',
			false,
			'test-engine',
			'model-x',
		);
		expect(config.github).toBeUndefined();
	});

	it('does not include runLink when runLinksEnabled is false', () => {
		mockGetDashboardUrl.mockReturnValue('https://dashboard.example.com');
		const input = makeInput({ project: makeProject({ runLinksEnabled: false }) });
		const config = buildProgressMonitorConfig(
			input,
			'implementation',
			mockLogWriter,
			'/repo',
			false,
			'test-engine',
			'model-x',
		);
		expect(config.runLink).toBeUndefined();
	});

	it('does not include runLink when dashboardUrl is absent', () => {
		mockGetDashboardUrl.mockReturnValue(undefined);
		const input = makeInput({ project: makeProject({ runLinksEnabled: true }) });
		const config = buildProgressMonitorConfig(
			input,
			'implementation',
			mockLogWriter,
			'/repo',
			false,
			'test-engine',
			'model-x',
		);
		expect(config.runLink).toBeUndefined();
	});

	it('includes runLink when runLinksEnabled and dashboardUrl are both set', () => {
		mockGetDashboardUrl.mockReturnValue('https://dashboard.example.com');
		const input = makeInput({
			workItemId: 'card-abc',
			project: makeProject({ runLinksEnabled: true }),
		});
		const config = buildProgressMonitorConfig(
			input,
			'implementation',
			mockLogWriter,
			'/repo',
			false,
			'my-engine',
			'some-model',
		);
		expect(config.runLink).toEqual({
			engineLabel: 'my-engine',
			model: 'some-model',
			projectId: 'test-project',
			workItemId: 'card-abc',
		});
	});

	it('passes through repoDir to config', () => {
		const input = makeInput();
		const config = buildProgressMonitorConfig(
			input,
			'implementation',
			mockLogWriter,
			'/my/repo',
			false,
			'test-engine',
			'model-x',
		);
		expect(config.repoDir).toBe('/my/repo');
	});

	it('converts null repoDir to undefined', () => {
		const input = makeInput();
		const config = buildProgressMonitorConfig(
			input,
			'implementation',
			mockLogWriter,
			null,
			false,
			'test-engine',
			'model-x',
		);
		expect(config.repoDir).toBeUndefined();
	});
});
