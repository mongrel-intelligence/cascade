import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/db/repositories/prWorkItemsRepository.js', () => ({
	lookupWorkItemForPR: vi.fn(),
}));

import { lookupWorkItemForPR } from '../../../src/db/repositories/prWorkItemsRepository.js';
import {
	extractJiraIssueKey,
	extractTrelloCardId,
	extractWorkItemId,
	hasTrelloCardUrl,
	requireWorkItemId,
	resolveWorkItemId,
} from '../../../src/triggers/github/utils.js';
import type { ProjectConfig } from '../../../src/types/index.js';

const mockTrelloProject: ProjectConfig = {
	id: 'test',
	name: 'Test',
	repo: 'owner/repo',
	baseBranch: 'main',
	branchPrefix: 'feature/',
	trello: {
		boardId: 'board123',
		lists: {},
		labels: {},
	},
};

const mockJiraProject: ProjectConfig = {
	id: 'test',
	name: 'Test',
	repo: 'owner/repo',
	baseBranch: 'main',
	branchPrefix: 'feature/',
	pm: { type: 'jira' },
	jira: {
		host: 'example.atlassian.net',
		projectKey: 'TEST',
	},
};

describe('extractTrelloCardId', () => {
	it('returns null for null input', () => {
		expect(extractTrelloCardId(null)).toBeNull();
	});

	it('returns null for text with no URL', () => {
		expect(extractTrelloCardId('Just some regular text')).toBeNull();
	});

	it('extracts card ID from valid Trello URL', () => {
		const text = 'Implements https://trello.com/c/abc123/card-name';
		expect(extractTrelloCardId(text)).toBe('abc123');
	});

	it('extracts card ID from URL without slug', () => {
		const text = 'See https://trello.com/c/xyz789';
		expect(extractTrelloCardId(text)).toBe('xyz789');
	});

	it('returns first card ID when multiple URLs present', () => {
		const text =
			'https://trello.com/c/first123/card-one and https://trello.com/c/second456/card-two';
		expect(extractTrelloCardId(text)).toBe('first123');
	});

	it('handles URLs with alphanumeric IDs', () => {
		const text = 'https://trello.com/c/AbC123DeF/my-card';
		expect(extractTrelloCardId(text)).toBe('AbC123DeF');
	});
});

describe('hasTrelloCardUrl', () => {
	it('returns false for null input', () => {
		expect(hasTrelloCardUrl(null)).toBe(false);
	});

	it('returns false for text without URL', () => {
		expect(hasTrelloCardUrl('No URL here')).toBe(false);
	});

	it('returns true for text with Trello URL', () => {
		expect(hasTrelloCardUrl('https://trello.com/c/abc123/card')).toBe(true);
	});

	it('returns true for partial match in longer text', () => {
		expect(hasTrelloCardUrl('Check out this card: https://trello.com/c/xyz789')).toBe(true);
	});
});

describe('extractJiraIssueKey', () => {
	it('returns null for null input', () => {
		expect(extractJiraIssueKey(null)).toBeNull();
	});

	it('returns null when no key found', () => {
		expect(extractJiraIssueKey('Just some text without a key')).toBeNull();
	});

	it('extracts valid JIRA key', () => {
		expect(extractJiraIssueKey('PROJ-123')).toBe('PROJ-123');
	});

	it('extracts key embedded in longer text', () => {
		const text = 'This fixes PROJ-456 by updating the logic';
		expect(extractJiraIssueKey(text)).toBe('PROJ-456');
	});

	it('extracts key with multiple characters in project code', () => {
		expect(extractJiraIssueKey('TEST-999')).toBe('TEST-999');
	});

	it('extracts key with alphanumeric project code', () => {
		expect(extractJiraIssueKey('AB12-345')).toBe('AB12-345');
	});

	it('requires word boundaries around key', () => {
		// Should not match partial strings
		expect(extractJiraIssueKey('NOTAKEY-123-MORE')).toBe('NOTAKEY-123');
	});

	it('returns first key when multiple present', () => {
		const text = 'Relates to PROJ-111 and PROJ-222';
		expect(extractJiraIssueKey(text)).toBe('PROJ-111');
	});
});

describe('extractWorkItemId', () => {
	it('returns null for null input', () => {
		expect(extractWorkItemId(null, mockTrelloProject)).toBeNull();
	});

	it('delegates to Trello extraction for Trello projects', () => {
		const text = 'https://trello.com/c/abc123/card';
		expect(extractWorkItemId(text, mockTrelloProject)).toBe('abc123');
	});

	it('delegates to JIRA extraction for JIRA projects', () => {
		const text = 'Fixes PROJ-456';
		expect(extractWorkItemId(text, mockJiraProject)).toBe('PROJ-456');
	});

	it('returns null for Trello project without Trello URL', () => {
		const text = 'Just regular text';
		expect(extractWorkItemId(text, mockTrelloProject)).toBeNull();
	});

	it('returns null for JIRA project without JIRA key', () => {
		const text = 'Just regular text';
		expect(extractWorkItemId(text, mockJiraProject)).toBeNull();
	});
});

describe('requireWorkItemId', () => {
	const context = { prNumber: 42, triggerName: 'test-trigger' };

	it('returns null when no ID found', () => {
		const result = requireWorkItemId('No work item reference', mockTrelloProject, context);
		expect(result).toBeNull();
	});

	it('returns ID when present in Trello project', () => {
		const text = 'Implements https://trello.com/c/abc123/card';
		const result = requireWorkItemId(text, mockTrelloProject, context);
		expect(result).toBe('abc123');
	});

	it('returns ID when present in JIRA project', () => {
		const text = 'Fixes PROJ-789';
		const result = requireWorkItemId(text, mockJiraProject, context);
		expect(result).toBe('PROJ-789');
	});

	it('returns null for null input', () => {
		const result = requireWorkItemId(null, mockTrelloProject, context);
		expect(result).toBeNull();
	});
});

describe('resolveWorkItemId', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(lookupWorkItemForPR).mockResolvedValue(null);
	});

	it('returns DB result when available', async () => {
		vi.mocked(lookupWorkItemForPR).mockResolvedValue('db-item-123');

		const result = await resolveWorkItemId(
			'proj',
			42,
			'https://trello.com/c/abc123',
			mockTrelloProject,
		);

		expect(result).toBe('db-item-123');
		expect(lookupWorkItemForPR).toHaveBeenCalledWith('proj', 42);
	});

	it('falls back to PR body extraction when DB returns null', async () => {
		const result = await resolveWorkItemId(
			'proj',
			42,
			'https://trello.com/c/abc123',
			mockTrelloProject,
		);

		expect(result).toBe('abc123');
	});

	it('falls back to JIRA extraction for JIRA projects', async () => {
		const result = await resolveWorkItemId('proj', 42, 'Fixes PROJ-456', mockJiraProject);

		expect(result).toBe('PROJ-456');
	});

	it('returns undefined when neither DB nor body has work item', async () => {
		const result = await resolveWorkItemId('proj', 42, 'No work item here', mockTrelloProject);

		expect(result).toBeUndefined();
	});

	it('returns undefined for null body with no DB result', async () => {
		const result = await resolveWorkItemId('proj', 42, null, mockTrelloProject);

		expect(result).toBeUndefined();
	});

	it('falls back to body extraction when DB throws', async () => {
		vi.mocked(lookupWorkItemForPR).mockRejectedValue(new Error('DB connection failed'));

		const result = await resolveWorkItemId(
			'proj',
			42,
			'https://trello.com/c/abc123',
			mockTrelloProject,
		);

		expect(result).toBe('abc123');
	});
});
