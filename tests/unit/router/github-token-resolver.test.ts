import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock config provider for DB secret resolution
vi.mock('../../../src/config/provider.js', () => ({
	getIntegrationCredential: vi.fn(),
	findProjectByRepo: vi.fn(),
}));

// Mock getProjectGitHubToken
vi.mock('../../../src/config/projects.js', () => ({
	getProjectGitHubToken: vi.fn(),
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

import { getProjectGitHubToken } from '../../../src/config/projects.js';
import { findProjectByRepo, getIntegrationCredential } from '../../../src/config/provider.js';
import {
	resolveGitHubTokenForAck,
	resolveGitHubTokenForAckByAgent,
} from '../../../src/router/github-token-resolver.js';

const mockGetIntegrationCredential = vi.mocked(getIntegrationCredential);
const mockGetProjectGitHubToken = vi.mocked(getProjectGitHubToken);
const mockFindProjectByRepo = vi.mocked(findProjectByRepo);

const MOCK_CREDENTIALS: Record<string, string> = {
	'pm/api_key': 'test-trello-key',
	'pm/token': 'test-trello-token',
	'pm/email': 'bot@example.com',
	'pm/api_token': 'test-jira-token',
};

beforeEach(() => {
	mockGetIntegrationCredential.mockImplementation(async (_projectId, category, role) => {
		const value = MOCK_CREDENTIALS[`${category}/${role}`];
		if (value) return value;
		throw new Error(`Credential '${category}/${role}' not found`);
	});
	mockGetProjectGitHubToken.mockResolvedValue('test-github-token');
	mockFindProjectByRepo.mockResolvedValue({
		id: 'test',
		name: 'Test',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		trello: { boardId: 'b1', lists: {}, labels: {} },
	});
});

describe('resolveGitHubTokenForAck', () => {
	it('returns token and project when both are found', async () => {
		const result = await resolveGitHubTokenForAck('owner/repo');

		expect(result).not.toBeNull();
		expect(result?.token).toBe('test-github-token');
		expect(result?.project.id).toBe('test');
	});

	it('returns null when project is not found', async () => {
		mockFindProjectByRepo.mockResolvedValue(undefined);

		const result = await resolveGitHubTokenForAck('unknown/repo');

		expect(result).toBeNull();
	});

	it('returns null when GitHub token is missing', async () => {
		mockGetProjectGitHubToken.mockRejectedValue(new Error('Missing token'));

		const result = await resolveGitHubTokenForAck('owner/repo');

		expect(result).toBeNull();
	});
});

describe('resolveGitHubTokenForAckByAgent', () => {
	it('returns reviewer token for review agent type', async () => {
		mockGetIntegrationCredential.mockImplementation(async (_projectId, category, role) => {
			if (category === 'scm' && role === 'reviewer_token') return 'test-reviewer-token';
			const value = MOCK_CREDENTIALS[`${category}/${role}`];
			if (value) return value;
			throw new Error(`Credential '${category}/${role}' not found`);
		});

		const result = await resolveGitHubTokenForAckByAgent('owner/repo', 'review');

		expect(result).not.toBeNull();
		expect(result?.token).toBe('test-reviewer-token');
		expect(result?.project.id).toBe('test');
		expect(mockGetProjectGitHubToken).not.toHaveBeenCalled();
	});

	it('returns implementer token for non-review agent types', async () => {
		const result = await resolveGitHubTokenForAckByAgent('owner/repo', 'implementation');

		expect(result).not.toBeNull();
		expect(result?.token).toBe('test-github-token');
		expect(result?.project.id).toBe('test');
		expect(mockGetProjectGitHubToken).toHaveBeenCalled();
	});

	it('returns null when project is not found', async () => {
		mockFindProjectByRepo.mockResolvedValue(undefined);

		const result = await resolveGitHubTokenForAckByAgent('unknown/repo', 'review');

		expect(result).toBeNull();
	});

	it('returns null when reviewer token is missing', async () => {
		mockGetIntegrationCredential.mockRejectedValue(new Error('not found'));

		const result = await resolveGitHubTokenForAckByAgent('owner/repo', 'review');

		expect(result).toBeNull();
	});
});
